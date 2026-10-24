import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { query, one } from "../db.js";
import { requireUser, principalOf } from "../auth.js";
import { cuotaDe } from "../accounts.js";
import { validarConfig, nombrePorDefecto, WidgetInvalido, MAX_WIDGETS, type ConfigWidget, type Tipo } from "../widgets/config.js";
import { dibujarWidget, PRESETS, MIN_LADO, MAX_LADO, type FilaWidget, type Medidas } from "../widgets/render.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

interface Fila extends FilaWidget {
  token: string;
  position: number;
  created_at: Date;
  updated_at: Date;
  last_used: Date | null;
}

const COLS = "id, user_id, token, name, kind, config, position, created_at, updated_at, last_used";

const aItem = (r: Fila) => ({
  id: r.id,
  token: r.token,
  name: r.name,
  kind: r.kind,
  config: r.config,
  position: r.position,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  lastUsed: r.last_used?.toISOString() ?? null,
});

const nuevoToken = () => randomBytes(24).toString("base64url");

/** Mide el pedido: `s=small|medium|large|full` o `w`×`h` (acotado). */
function medidas(q: Record<string, string | undefined>): Medidas {
  const p = PRESETS[q.s ?? ""] ?? PRESETS.medium!;
  const num = (v: string | undefined, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(MAX_LADO, Math.max(MIN_LADO, Math.round(n))) : def;
  };
  const rot = q.rot === "vez" || q.rot === "hora" || q.rot === "dia" || q.rot === "fija" ? q.rot : undefined;
  return { w: num(q.w, p.w), h: num(q.h, p.h), fondoPantalla: q.wallpaper === "1", rot };
}

// pequeña caché: los widgets de las pantallas piden cada pocos minutos; así no se repinta cada vez
const cache = new Map<string, { buf: Buffer; tipo: string; exp: number }>();
function dePoner(k: string, v: { buf: Buffer; tipo: string }) {
  cache.set(k, { ...v, exp: Date.now() + 30_000 });
  while (cache.size > 150) cache.delete(cache.keys().next().value!);
}

async function enviarDibujo(reply: FastifyReply, w: Fila, m: Medidas, opts: { descargar?: string; ext?: "png" | "jpg" } = {}) {
  const cacheable = m.rot !== "vez" && w.config.rotar !== "vez";
  const k = `${w.id}|${w.updated_at.getTime()}|${m.w}x${m.h}|${m.fondoPantalla ? 1 : 0}|${m.rot ?? ""}`;
  const hit = cacheable ? cache.get(k) : undefined;
  let d = hit && hit.exp > Date.now() ? hit : undefined;
  if (!d) {
    const dib = await dibujarWidget(w, m);
    d = { buf: dib.buf, tipo: dib.tipo, exp: 0 };
    if (cacheable) dePoner(k, dib);
  }
  reply.header("content-type", d.tipo).header("cache-control", "private, max-age=20").header("x-content-type-options", "nosniff");
  if (opts.descargar) reply.header("content-disposition", `attachment; filename="${opts.descargar}.${d.tipo === "image/png" ? "png" : "jpg"}"`);
  return reply.send(d.buf);
}

function error(reply: FastifyReply, e: unknown) {
  if (e instanceof WidgetInvalido) return reply.code(400).send({ error: e.message });
  throw e;
}

export async function widgetRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------ pública: la «llave» va en la dirección */
  app.get<{ Params: { file: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/w/:file",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const m = /^([A-Za-z0-9_-]+)\.(png|jpg|jpeg|json)$/.exec(req.params.file);
      if (!m || !TOKEN.test(m[1]!)) return reply.code(404).send({ error: "no existe" });
      const w = await one<Fila>(`select ${COLS} from widgets where token = $1`, [m[1]]);
      if (!w) return reply.code(404).send({ error: "no existe" });
      // «último uso» a lo sumo una vez por minuto
      if (!w.last_used || Date.now() - w.last_used.getTime() > 60_000) query("update widgets set last_used = now() where id = $1", [w.id]).catch(() => {});

      if (m[2] === "json") {
        const base: Record<string, unknown> = { name: w.name, kind: w.kind, updatedAt: w.updated_at.toISOString() };
        if (w.kind === "nota") {
          const n = await one<{ title: string; body_text: string }>("select title, body_text from notes where id = $1 and user_id = $2 and deleted_at is null", [w.config.noteId, w.user_id]);
          Object.assign(base, n ? { title: n.title, text: n.body_text.slice(0, 4000) } : { missing: true });
        } else if (w.kind === "espacio") {
          const c = await cuotaDe({ userId: w.user_id, email: null });
          Object.assign(base, { usedBytes: c.usedBytes, limitBytes: c.unlimited ? null : c.limitBytes, plan: c.plan.name });
        } else if (w.kind === "album") {
          const a = await one<{ name: string; n: string }>(
            `select al.name, (select count(*) from album_assets aa join assets s on s.id = aa.asset_id where aa.album_id = al.id and s.deleted_at is null) as n
               from albums al where al.id = $1 and al.user_id = $2`,
            [w.config.albumId, w.user_id],
          );
          Object.assign(base, a ? { album: a.name, count: Number(a.n) } : { missing: true });
        }
        return reply.header("cache-control", "private, max-age=60").send(base);
      }
      return enviarDibujo(reply, w, medidas(req.query));
    },
  );

  /* ------------------------------------------------------------------ con sesión */
  app.get("/v1/widgets", { preHandler: requireUser }, async (req) => {
    const { userId } = principalOf(req);
    const { rows } = await query<Fila>(`select ${COLS} from widgets where user_id = $1 order by position, created_at`, [userId]);
    return { items: rows.map(aItem), max: MAX_WIDGETS };
  });

  app.post("/v1/widgets", { preHandler: requireUser, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { userId } = principalOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      const { n } = (await one<{ n: string }>("select count(*) as n from widgets where user_id = $1", [userId]))!;
      if (Number(n) >= MAX_WIDGETS) return reply.code(409).send({ error: `Puedes tener hasta ${MAX_WIDGETS} widgets` });
      const { kind, config } = await validarConfig(userId, b.kind, b.config);
      const nombre = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 60) : nombrePorDefecto(kind);
      const fila = await one<Fila>(
        `insert into widgets (user_id, token, name, kind, config, position)
         values ($1, $2, $3, $4, $5, (select coalesce(max(position), 0) + 1 from widgets where user_id = $1)) returning ${COLS}`,
        [userId, nuevoToken(), nombre, kind, JSON.stringify(config)],
      );
      return reply.code(201).send(aItem(fila!));
    } catch (e) {
      return error(reply, e);
    }
  });

  app.patch<{ Params: { id: string } }>("/v1/widgets/:id", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: "no existe" });
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      const actual = await one<Fila>(`select ${COLS} from widgets where id = $1 and user_id = $2`, [req.params.id, userId]);
      if (!actual) return reply.code(404).send({ error: "no existe" });
      const sets: string[] = [];
      const p: unknown[] = [req.params.id, userId];
      const set = (c: string, v: unknown) => { p.push(v); sets.push(`${c} = $${p.length}`); };
      if (typeof b.name === "string") set("name", b.name.trim().slice(0, 60) || actual.name);
      if (b.config !== undefined) set("config", JSON.stringify((await validarConfig(userId, actual.kind, b.config)).config));
      if (b.position !== undefined) set("position", Math.max(0, Math.min(1000, Math.round(Number(b.position)) || 0)));
      if (!sets.length) return reply.code(400).send({ error: "nada que cambiar" });
      const fila = await one<Fila>(`update widgets set ${sets.join(", ")}, updated_at = now() where id = $1 and user_id = $2 returning ${COLS}`, p);
      return aItem(fila!);
    } catch (e) {
      return error(reply, e);
    }
  });

  app.delete<{ Params: { id: string } }>("/v1/widgets/:id", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: "no existe" });
    const r = await query("delete from widgets where id = $1 and user_id = $2", [req.params.id, userId]);
    return r.rowCount ? { ok: true } : reply.code(404).send({ error: "no existe" });
  });

  // Nueva «llave»: la dirección anterior deja de funcionar al instante.
  app.post<{ Params: { id: string } }>("/v1/widgets/:id/regenerate", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: "no existe" });
    const fila = await one<Fila>(`update widgets set token = $3, updated_at = now() where id = $1 and user_id = $2 returning ${COLS}`, [req.params.id, userId, nuevoToken()]);
    return fila ? aItem(fila) : reply.code(404).send({ error: "no existe" });
  });

  // Vista previa del constructor: dibuja sin guardar.
  app.post<{ Querystring: Record<string, string | undefined> }>(
    "/v1/widgets/preview",
    { preHandler: requireUser, config: { rateLimit: { max: 90, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { userId } = principalOf(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      try {
        const { kind, config } = await validarConfig(userId, b.kind, b.config);
        const falso: Fila = { id: "preview", user_id: userId, token: "", name: "", kind: kind as Tipo, config: config as ConfigWidget, position: 0, created_at: new Date(), updated_at: new Date(0), last_used: null };
        const dib = await dibujarWidget(falso, medidas({ ...req.query, rot: req.query.rot ?? "fija" }));
        return reply.header("content-type", dib.tipo).header("cache-control", "no-store").send(dib.buf);
      } catch (e) {
        return error(reply, e);
      }
    },
  );

  // Imagen del widget con sesión (vista en la app y descarga como fondo de pantalla).
  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>("/v1/widgets/:id/image", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: "no existe" });
    const w = await one<Fila>(`select ${COLS} from widgets where id = $1 and user_id = $2`, [req.params.id, userId]);
    if (!w) return reply.code(404).send({ error: "no existe" });
    const nombre = (w.name || "widget").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 40) || "widget";
    return enviarDibujo(reply, w, medidas(req.query), { descargar: req.query.download === "1" ? `upscale-${nombre}` : undefined });
  });
}
