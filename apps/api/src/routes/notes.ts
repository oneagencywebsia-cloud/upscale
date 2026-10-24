import type { FastifyInstance, FastifyReply } from "fastify";
import { query, one } from "../db.js";
import { requireUser, principalOf } from "../auth.js";
import { signedUrl } from "../storage.js";
import { sanitizarDoc, docDeTexto, NotaInvalida, DOC_VACIO } from "../notes/doc.js";
import { normalizarEstilo, normalizarEtiquetas, EstiloInvalido } from "../notes/style.js";
import { ocrDeAsset, OcrNoDisponible, OcrNoSePuede } from "../ocr.js";
import type { Note, NoteListItem, NoteAttachment } from "@upscale/shared";

const MAX_NOTAS = 5000;
const MAX_ADJUNTOS = 30;
const DIAS_PAPELERA = 30;
const DERIV_TTL = 21 * 24 * 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIM_OCR = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } } as const;

interface FilaNota {
  id: string; title: string; body_text: string; style: Note["style"]; tags: string[]; pinned: boolean;
  archived_at: Date | null; deleted_at: Date | null; created_at: Date; updated_at: Date;
  attachment_count: string; cover_key: string | null; body?: Note["body"];
}

const COLS = `n.id, n.title, left(n.body_text, 240) as body_text, n.style, n.tags, n.pinned, n.archived_at, n.deleted_at,
  n.created_at, n.updated_at,
  (select count(*) from note_assets na where na.note_id = n.id) as attachment_count,
  (select a.thumb_key from note_assets na join assets a on a.id = na.asset_id
     where na.note_id = n.id and a.deleted_at is null order by na.position, na.added_at limit 1) as cover_key`;

async function aItem(r: FilaNota): Promise<NoteListItem> {
  return {
    id: r.id, title: r.title, preview: r.body_text.replace(/\s+/g, " ").trim().slice(0, 160),
    style: r.style, tags: r.tags, pinned: r.pinned,
    archivedAt: r.archived_at?.toISOString() ?? null, deletedAt: r.deleted_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
    attachmentCount: Number(r.attachment_count),
    coverUrl: r.cover_key ? await signedUrl(r.cover_key, { expiresIn: DERIV_TTL }) : null,
  };
}

async function adjuntos(noteId: string): Promise<NoteAttachment[]> {
  const { rows } = await query<{
    id: string; filename: string; width: number | null; height: number | null;
    thumb_key: string; poster_key: string | null; ocr_at: Date | null;
  }>(
    `select a.id, a.filename, a.width, a.height, a.thumb_key, a.poster_key, na.ocr_at
       from note_assets na join assets a on a.id = na.asset_id
      where na.note_id = $1 and a.deleted_at is null order by na.position, na.added_at`,
    [noteId],
  );
  return Promise.all(rows.map(async (a) => ({
    assetId: a.id, filename: a.filename, width: a.width, height: a.height,
    thumbUrl: await signedUrl(a.thumb_key, { expiresIn: DERIV_TTL }),
    posterUrl: a.poster_key ? await signedUrl(a.poster_key, { expiresIn: DERIV_TTL }) : null,
    ocrDone: Boolean(a.ocr_at),
  })));
}

async function notaCompleta(userId: string, id: string): Promise<Note | null> {
  const r = await one<FilaNota>(`select ${COLS}, n.body from notes n where n.id = $1 and n.user_id = $2`, [id, userId]);
  if (!r) return null;
  return { ...(await aItem(r)), body: r.body!, attachments: await adjuntos(id) };
}

function error(reply: FastifyReply, e: unknown) {
  if (e instanceof NotaInvalida || e instanceof EstiloInvalido) return reply.code(400).send({ error: e.message });
  if (e instanceof OcrNoDisponible) return reply.code(503).send({ error: e.message });
  if (e instanceof OcrNoSePuede) return reply.code(422).send({ error: e.message });
  throw e;
}

const idOk = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const texto = (v: unknown, max: number): string | null => (typeof v === "string" ? v.trim().slice(0, max) : null);

export async function noteRoutes(app: FastifyInstance): Promise<void> {

  // Lista: ?view=active|archived|trash  ?q=  ?tag=  ?pinned=1  ?cursor=
  app.get("/v1/notes", { preHandler: requireUser }, async (req) => {
    const { userId } = principalOf(req);
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = ["n.user_id = $1"];
    const p: unknown[] = [userId];
    const view = q.view === "trash" || q.view === "archived" ? q.view : "active";
    where.push(view === "trash" ? "n.deleted_at is not null"
      : view === "archived" ? "n.deleted_at is null and n.archived_at is not null"
      : "n.deleted_at is null and n.archived_at is null");
    if (q.tag) { p.push(q.tag.slice(0, 30).toLowerCase()); where.push(`exists (select 1 from unnest(n.tags) t where lower(t) = $${p.length})`); }
    if (q.pinned === "1") where.push("n.pinned");
    const orden = "n.pinned desc, n.updated_at desc, n.id desc";
    const busca = q.q?.trim().slice(0, 100);
    if (busca) {
      p.push(busca);
      where.push(`(n.search @@ websearch_to_tsquery('spanish', $${p.length}) or n.title ilike '%' || $${p.length} || '%'
        or exists (select 1 from note_assets na where na.note_id = n.id and na.ocr_text ilike '%' || $${p.length} || '%'))`);
    }
    const offset = Math.max(0, Number(q.cursor) || 0);
    const LIM = 60;
    const { rows } = await query<FilaNota>(
      `select ${COLS} from notes n where ${where.join(" and ")} order by ${orden} limit ${LIM + 1} offset ${offset}`, p);
    const pagina = rows.slice(0, LIM);
    return { items: await Promise.all(pagina.map(aItem)), nextCursor: rows.length > LIM ? String(offset + LIM) : null };
  });

  // Etiquetas con su recuento (para el filtro).
  app.get("/v1/notes/tags", { preHandler: requireUser }, async (req) => {
    const { userId } = principalOf(req);
    const { rows } = await query<{ tag: string; n: string }>(
      `select lower(t) as tag, count(*) as n from notes, unnest(tags) t
        where user_id = $1 and deleted_at is null group by 1 order by 2 desc, 1 limit 100`, [userId]);
    return { tags: rows.map((r) => ({ tag: r.tag, count: Number(r.n) })) };
  });

  app.post("/v1/notes", { preHandler: requireUser, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { userId } = principalOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      const { n } = (await one<{ n: string }>("select count(*) as n from notes where user_id = $1", [userId]))!;
      if (Number(n) >= MAX_NOTAS) return reply.code(409).send({ error: `Has llegado al máximo de ${MAX_NOTAS} notas` });
      const { doc, texto: plano } = b.text != null ? docDeTexto(String(b.text)) : b.body != null ? sanitizarDoc(b.body) : { doc: DOC_VACIO, texto: "" };
      const id = (await one<{ id: string }>(
        `insert into notes (user_id, title, body, body_text, style, tags) values ($1,$2,$3,$4,$5,$6) returning id`,
        [userId, texto(b.title, 200) ?? "", JSON.stringify(doc), plano,
         JSON.stringify(b.style ? normalizarEstilo(b.style) : {}), b.tags ? normalizarEtiquetas(b.tags) : []],
      ))!.id;
      return reply.code(201).send(await notaCompleta(userId, id));
    } catch (e) { return error(reply, e); }
  });

  app.get<{ Params: { id: string } }>("/v1/notes/:id", { preHandler: requireUser }, async (req, reply) => {
    if (!idOk(req.params.id)) return reply.code(404).send({ error: "no existe" });
    const n = await notaCompleta(principalOf(req).userId, req.params.id);
    return n ?? reply.code(404).send({ error: "no existe" });
  });

  // Edición parcial. `baseUpdatedAt` = la versión que tenía el editor: si otra pestaña ya la cambió, 409.
  app.patch<{ Params: { id: string } }>("/v1/notes/:id", { preHandler: requireUser, config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { userId } = principalOf(req);
    if (!idOk(req.params.id)) return reply.code(404).send({ error: "no existe" });
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      const sets: string[] = []; const p: unknown[] = [req.params.id, userId];
      const set = (col: string, v: unknown) => { p.push(v); sets.push(`${col} = $${p.length}`); };
      if (b.title !== undefined) set("title", texto(b.title, 200) ?? "");
      if (b.body !== undefined) { const { doc, texto: plano } = sanitizarDoc(b.body); set("body", JSON.stringify(doc)); set("body_text", plano); }
      if (b.style !== undefined) set("style", JSON.stringify(normalizarEstilo(b.style)));
      if (b.tags !== undefined) set("tags", normalizarEtiquetas(b.tags));
      if (b.pinned !== undefined) set("pinned", Boolean(b.pinned));
      if (b.archived !== undefined) sets.push(b.archived ? "archived_at = now()" : "archived_at = null");
      if (!sets.length) return reply.code(400).send({ error: "nada que cambiar" });
      let cond = "id = $1 and user_id = $2 and deleted_at is null";
      if (typeof b.baseUpdatedAt === "string") { p.push(b.baseUpdatedAt); cond += ` and date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${p.length}::timestamptz)`; }
      const r = await query(`update notes set ${sets.join(", ")}, updated_at = now() where ${cond}`, p);
      if (!r.rowCount) {
        const existe = await one("select 1 from notes where id = $1 and user_id = $2 and deleted_at is null", [req.params.id, userId]);
        if (!existe) return reply.code(404).send({ error: "no existe" });
        return reply.code(409).send({ error: "La nota cambió en otra pestaña", note: await notaCompleta(userId, req.params.id) });
      }
      return await notaCompleta(userId, req.params.id);
    } catch (e) { return error(reply, e); }
  });

  // A la papelera (se purga a los 30 días).
  app.delete<{ Params: { id: string }; Querystring: { permanent?: string } }>("/v1/notes/:id", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    if (!idOk(req.params.id)) return reply.code(404).send({ error: "no existe" });
    const r = req.query.permanent === "1"
      ? await query("delete from notes where id = $1 and user_id = $2 and deleted_at is not null", [req.params.id, userId])
      : await query("update notes set deleted_at = now() where id = $1 and user_id = $2 and deleted_at is null", [req.params.id, userId]);
    return r.rowCount ? { ok: true } : reply.code(404).send({ error: "no existe" });
  });

  app.post<{ Params: { id: string } }>("/v1/notes/:id/restore", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    if (!idOk(req.params.id)) return reply.code(404).send({ error: "no existe" });
    const r = await query("update notes set deleted_at = null, updated_at = now() where id = $1 and user_id = $2 and deleted_at is not null", [req.params.id, userId]);
    return r.rowCount ? await notaCompleta(userId, req.params.id) : reply.code(404).send({ error: "no existe" });
  });

  app.delete("/v1/notes-trash", { preHandler: requireUser }, async (req) => {
    const r = await query("delete from notes where user_id = $1 and deleted_at is not null", [principalOf(req).userId]);
    return { ok: true, deleted: r.rowCount };
  });

  // Adjuntar una captura de la biblioteca.
  app.post<{ Params: { id: string } }>("/v1/notes/:id/attachments", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const assetId = (req.body as { assetId?: unknown } | undefined)?.assetId;
    if (!idOk(req.params.id) || !idOk(assetId)) return reply.code(400).send({ error: "datos no válidos" });
    const nota = await one("select 1 from notes where id = $1 and user_id = $2 and deleted_at is null", [req.params.id, userId]);
    const foto = await one<{ kind: string }>("select kind from assets where id = $1 and user_id = $2 and deleted_at is null", [assetId, userId]);
    if (!nota || !foto) return reply.code(404).send({ error: "no existe" });
    if (foto.kind !== "photo") return reply.code(422).send({ error: "solo se pueden adjuntar imágenes" });
    const { n } = (await one<{ n: string }>("select count(*) as n from note_assets where note_id = $1", [req.params.id]))!;
    if (Number(n) >= MAX_ADJUNTOS) return reply.code(409).send({ error: `Máximo ${MAX_ADJUNTOS} capturas por nota` });
    await query(
      `insert into note_assets (note_id, asset_id, position) values ($1,$2,$3) on conflict do nothing`,
      [req.params.id, assetId, Number(n)]);
    await query("update notes set updated_at = now() where id = $1", [req.params.id]);
    return reply.code(201).send({ attachments: await adjuntos(req.params.id) });
  });

  app.delete<{ Params: { id: string; assetId: string } }>("/v1/notes/:id/attachments/:assetId", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    if (!idOk(req.params.id) || !idOk(req.params.assetId)) return reply.code(404).send({ error: "no existe" });
    const r = await query(
      `delete from note_assets na using notes n where na.note_id = n.id and n.id = $1 and n.user_id = $2 and na.asset_id = $3`,
      [req.params.id, userId, req.params.assetId]);
    if (!r.rowCount) return reply.code(404).send({ error: "no existe" });
    await query("update notes set updated_at = now() where id = $1", [req.params.id]);
    return { attachments: await adjuntos(req.params.id) };
  });

  // OCR de una captura ya adjunta a la nota: devuelve el texto (editable) y lo guarda para la búsqueda.
  app.post<{ Params: { id: string; assetId: string } }>("/v1/notes/:id/attachments/:assetId/ocr", { preHandler: requireUser, ...LIM_OCR }, async (req, reply) => {
    const { userId } = principalOf(req);
    if (!idOk(req.params.id) || !idOk(req.params.assetId)) return reply.code(404).send({ error: "no existe" });
    const vinc = await one(
      `select 1 from note_assets na join notes n on n.id = na.note_id where n.id = $1 and n.user_id = $2 and na.asset_id = $3`,
      [req.params.id, userId, req.params.assetId]);
    if (!vinc) return reply.code(404).send({ error: "no existe" });
    try {
      const r = await ocrDeAsset(userId, req.params.assetId);
      await query("update note_assets set ocr_text = $3, ocr_at = now() where note_id = $1 and asset_id = $2", [req.params.id, req.params.assetId, r.texto.slice(0, 100_000)]);
      return { text: r.texto, ms: r.ms, empty: r.texto.length === 0 };
    } catch (e) { return error(reply, e); }
  });

  // Texto ya extraído de una captura (sin repetir el OCR).
  app.get<{ Params: { id: string; assetId: string } }>("/v1/notes/:id/attachments/:assetId/text", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    if (!idOk(req.params.id) || !idOk(req.params.assetId)) return reply.code(404).send({ error: "no existe" });
    const r = await one<{ ocr_text: string | null }>(
      `select na.ocr_text from note_assets na join notes n on n.id = na.note_id where n.id = $1 and n.user_id = $2 and na.asset_id = $3`,
      [req.params.id, userId, req.params.assetId]);
    return r ? { text: r.ocr_text ?? "" } : reply.code(404).send({ error: "no existe" });
  });

  // OCR suelto de cualquier foto de la biblioteca (sin guardar nada).
  app.post("/v1/ocr", { preHandler: requireUser, ...LIM_OCR }, async (req, reply) => {
    const assetId = (req.body as { assetId?: unknown } | undefined)?.assetId;
    if (!idOk(assetId)) return reply.code(400).send({ error: "datos no válidos" });
    try {
      const r = await ocrDeAsset(principalOf(req).userId, assetId);
      return { text: r.texto, ms: r.ms, empty: r.texto.length === 0 };
    } catch (e) { return error(reply, e); }
  });
}

/** Vacía las notas que llevan más de 30 días en la papelera. */
export function iniciarLimpiezaNotas(log: { warn: (o: object, m: string) => void }): void {
  const f = () => query(`delete from notes where deleted_at < now() - interval '${DIAS_PAPELERA} days'`).catch((err) => log.warn({ err }, "limpieza de notas"));
  setTimeout(f, 60_000).unref();
  setInterval(f, 6 * 3600_000).unref();
}
