import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import { createHash } from "node:crypto";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB (tope de documento de Telegram)
const MAX_LIVE_BYTES = 512 * 1024 * 1024;

/** Transform que aborta el stream si se superan `limit` bytes (evita llenar el disco). */
function sizeLimiter(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > limit) {
        cb(Object.assign(new Error("PAYLOAD_TOO_LARGE"), { code: "PAYLOAD_TOO_LARGE" }));
        return;
      }
      cb(null, chunk);
    },
  });
}
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Asset, AssetListItem, AssetKind } from "../types.js";
import { env } from "../env.js";
import { query, one } from "../db.js";
import archiver from "archiver";
import { put, signedUrl, remove, blobToLocalFile } from "../storage.js";
import { ingestLocalFile } from "../pipeline.js";
import { requireUser, requireUploadToken, principalOf } from "../auth.js";

interface Row {
  id: string; user_id: string; kind: AssetKind; filename: string; mime: string; bytes: string;
  sha256: string; width: number | null; height: number | null; duration_s: string | null;
  fps: string | null; video_bitrate: string | null; codec: string | null;
  captured_at: Date; uploaded_at: Date; camera_make: string | null; camera_model: string | null;
  lens: string | null; lat: number | null; lon: number | null; is_live: boolean;
  thumb_key: string; poster_key: string | null; original_key: string;
  live_video_key: string | null; live_video_bytes: string | null;
  is_favorite: boolean;
}

// Todas las columnas de assets MENOS los blobs pesados (thumb_webp/poster_jpg),
// que se sirven por /v1/blob y no deben viajar en cada consulta.
const A =
  "a.id, a.user_id, a.kind, a.filename, a.mime, a.bytes, a.sha256, a.width, a.height, " +
  "a.duration_s, a.fps, a.video_bitrate, a.codec, a.captured_at, a.uploaded_at, a.camera_make, " +
  "a.camera_model, a.lens, a.lat, a.lon, a.is_live, a.original_key, a.thumb_key, a.poster_key, " +
  "a.live_video_key, a.live_video_bytes, a.is_favorite, a.deleted_at";

function toAsset(r: Row): Asset {
  return {
    id: r.id, kind: r.kind, filename: r.filename, mime: r.mime, bytes: Number(r.bytes),
    sha256: r.sha256, width: r.width, height: r.height,
    durationS: r.duration_s === null ? null : Number(r.duration_s),
    fps: r.fps === null ? null : Number(r.fps),
    videoBitrate: r.video_bitrate === null ? null : Number(r.video_bitrate),
    codec: r.codec,
    capturedAt: r.captured_at.toISOString(), uploadedAt: r.uploaded_at.toISOString(),
    cameraMake: r.camera_make, cameraModel: r.camera_model, lens: r.lens,
    lat: r.lat, lon: r.lon, isLive: r.is_live,
    liveVideoBytes: r.live_video_bytes === null ? null : Number(r.live_video_bytes),
    isFavorite: r.is_favorite,
  };
}

// miniatura/póster: URL estable ~3 semanas → el navegador la cachea de verdad
// entre sesiones (la key ya lleva el sha256, el contenido no cambia).
const DERIV_TTL = 21 * 24 * 3600;

async function withUrls(r: Row): Promise<AssetListItem> {
  return {
    ...toAsset(r),
    thumbUrl: await signedUrl(r.thumb_key, { expiresIn: DERIV_TTL }),
    posterUrl: r.poster_key ? await signedUrl(r.poster_key, { expiresIn: DERIV_TTL }) : null,
    liveVideoUrl: r.live_video_key
      ? await signedUrl(r.live_video_key, { expiresIn: 3600, downloadName: r.filename.replace(/\.[^.]+$/, "") + ".mov" })
      : null,
  };
}

function logAccess(userId: string, assetId: string | null, action: "view" | "download", ua?: string) {
  query("insert into access_log (user_id, asset_id, action, ua) values ($1,$2,$3,$4)", [
    userId, assetId, action, ua?.slice(0, 300) ?? null,
  ]).catch(() => {});
}

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  await mkdir(env.TMP_DIR, { recursive: true });

  // ---------- subir (Atajo iOS / navegador) ----------
  app.post(
    "/v1/assets",
    { preHandler: requireUploadToken },
    async (req: FastifyRequest, reply) => {
      const { userId } = principalOf(req);
      const h = req.headers;
      const rawName = typeof h["x-filename"] === "string" ? h["x-filename"] : "IMG.bin";
      let filename = rawName;
      try {
        filename = decodeURIComponent(rawName);
      } catch {
        /* nombre no codificado: se deja tal cual */
      }
      const contentType = typeof h["content-type"] === "string" ? h["content-type"] : undefined;
      const capturedHeader = typeof h["x-captured-at"] === "string" ? h["x-captured-at"] : undefined;

      req.log.info(
        {
          userId,
          filename: rawName,
          contentType,
          contentLength: h["content-length"] ?? null,
          via: h["x-upload-token"] ? "token" : "sesion",
        },
        "subida: petición recibida",
      );

      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tmpOrig = join(env.TMP_DIR, `${stamp}.upload`);

      try {
        try {
          await pipeline(req.body as Readable, sizeLimiter(MAX_UPLOAD_BYTES), createWriteStream(tmpOrig));
        } catch (e) {
          await rm(tmpOrig, { force: true });
          if ((e as { code?: string })?.code === "PAYLOAD_TOO_LARGE") {
            return reply.code(413).send({ error: "el archivo supera el límite de 2 GB" });
          }
          throw e;
        }
        req.log.info({ userId, filename: rawName, contentType }, "subida: cuerpo recibido");

        const res = await ingestLocalFile({
          userId,
          filePath: tmpOrig, // ingestLocalFile lo borra
          filename,
          contentType,
          capturedAtHint: capturedHeader,
          log: req.log,
        });

        query("update upload_tokens set last_used = now() where token = $1", [h["x-upload-token"]]).catch(() => {});
        return { status: res.status, id: res.id };
      } catch (err) {
        await rm(tmpOrig, { force: true }).catch(() => {});
        if ((err as { code?: string })?.code === "EMPTY") {
          return reply.code(400).send({ error: "el archivo llegó vacío (0 bytes)" });
        }
        req.log.error({ err: (err as Error)?.message, stack: (err as Error)?.stack, filename, userId }, "fallo al subir asset");
        return reply.code(500).send({ error: "no se pudo procesar el archivo", detalle: (err as Error)?.message });
      }
    },
  );

  // ---------- adjuntar el .MOV de un Live Photo ----------
  app.post(
    "/v1/assets/:id/live-video",
    { preHandler: requireUploadToken },
    async (req: FastifyRequest, reply) => {
      const { userId } = principalOf(req);
      const { id } = req.params as { id: string };
      const r = await one<Row>(
        `select ${A} from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null`,
        [id, userId],
      );
      if (!r) return reply.code(404).send({ error: "no existe" });

      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tmp = join(env.TMP_DIR, `${stamp}.live.mov`);
      try {
        try {
          await pipeline(req.body as Readable, sizeLimiter(MAX_LIVE_BYTES), createWriteStream(tmp));
        } catch (e) {
          await rm(tmp, { force: true });
          if ((e as { code?: string })?.code === "PAYLOAD_TOO_LARGE") {
            return reply.code(413).send({ error: "el vídeo supera el límite de 512 MB" });
          }
          throw e;
        }
        const { size } = await stat(tmp);
        if (size === 0) {
          await rm(tmp, { force: true });
          return reply.code(400).send({ error: "vídeo vacío" });
        }
        const sha = createHash("sha256");
        for await (const chunk of createReadStream(tmp, { highWaterMark: 1024 * 1024 })) sha.update(chunk as Buffer);
        const key = `live/${r.user_id}/${sha.digest("hex")}.mov`;

        await put(key, tmp, "video/quicktime");
        await query(
          "update assets set live_video_key = $1, live_video_bytes = $2, is_live = true where id = $3",
          [key, size, id],
        );
        await rm(tmp, { force: true });
        return { status: "saved", id };
      } catch (err) {
        await rm(tmp, { force: true });
        req.log.error(err, "fallo al adjuntar live video");
        return reply.code(500).send({ error: "no se pudo procesar el vídeo" });
      }
    },
  );

  // ---------- favorito on/off ----------
  app.post("/v1/assets/:id/favorite", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    const body = (req.body as { value?: boolean } | undefined) ?? {};
    const r = await one<{ is_favorite: boolean }>(
      "update assets set is_favorite = $1 where id = $2 and user_id = $3 and deleted_at is null returning is_favorite",
      [body.value ?? true, id, userId],
    );
    if (!r) return reply.code(404).send({ error: "no existe" });
    return { isFavorite: r.is_favorite };
  });

  // ---------- descargar TODO (o una selección) en un ZIP ----------
  // El nombre del ZIP lleva el rango de fechas: "Recuerdos del 2026-07-01 al 2026-09-08.zip".
  // Al descomprimir queda esa carpeta con todos los originales dentro.
  app.get("/v1/assets/zip", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const q = req.query as { ids?: string };
    const idList = q.ids
      ? q.ids.split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 20000)
      : null;

    const params: unknown[] = [userId];
    let sql = `select a.id, a.kind, a.filename, a.captured_at, a.original_key
                 from assets a where a.user_id = $1 and a.deleted_at is null`;
    if (idList) {
      params.push(idList);
      sql += ` and a.id = any($2::uuid[])`;
    }
    sql += " order by a.captured_at asc, a.id asc";
    const rows = (await query<{ id: string; kind: string; filename: string; captured_at: Date; original_key: string }>(sql, params)).rows;
    if (!rows.length) return reply.code(404).send({ error: "nada que descargar" });

    const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const d1 = ymd(rows[0]!.captured_at);
    const d2 = ymd(rows[rows.length - 1]!.captured_at);
    const name = (d1 === d2 ? `Recuerdos ${d1}` : `Recuerdos del ${d1} al ${d2}`).replace(/[^\w .\-]/g, "");

    reply.hijack(); // tomamos el socket: escribimos el ZIP a mano en reply.raw
    reply.raw.setHeader("Content-Type", "application/zip");
    reply.raw.setHeader(
      "Content-Disposition",
      `attachment; filename="${name}.zip"; filename*=UTF-8''${encodeURIComponent(name)}.zip`,
    );
    reply.raw.setHeader("Cache-Control", "no-store");

    const archive = archiver("zip", { store: true, forceZip64: true });
    archive.on("warning", (e) => req.log.warn({ err: e.message }, "zip: warning"));
    archive.on("error", (e) => {
      req.log.error({ err: e.message }, "zip: error");
      reply.raw.destroy();
    });
    archive.pipe(reply.raw);

    const used = new Set<string>();
    let added = 0;
    let failed = 0;

    // Ventana de prefetch: se bajan CONC archivos de Telegram a la vez mientras
    // el ZIP escribe el anterior. Nada de recompresión (store), copia byte a byte.
    const CONC = 4;
    const inflight = new Map<number, Promise<string | null>>();
    const kickoff = (i: number) => {
      if (i >= rows.length || inflight.has(i)) return;
      inflight.set(i, blobToLocalFile(rows[i]!.original_key).catch(() => null));
    };
    for (let i = 0; i < CONC; i++) kickoff(i);

    const nameFor = (r: { filename: string; kind: string; id: string }) => {
      let nm = r.filename || `${r.kind}_${r.id}`;
      if (!/\.[a-z0-9]{2,5}$/i.test(nm)) nm += r.kind === "video" ? ".mov" : ".jpg";
      if (used.has(nm)) {
        const dot = nm.lastIndexOf(".");
        const stem = dot > 0 ? nm.slice(0, dot) : nm;
        const ext = dot > 0 ? nm.slice(dot) : "";
        let k = 2;
        while (used.has(`${stem}_${k}${ext}`)) k++;
        nm = `${stem}_${k}${ext}`;
      }
      used.add(nm);
      return nm;
    };

    for (let i = 0; i < rows.length; i++) {
      if (reply.raw.destroyed) break;
      const r = rows[i]!;
      const local = await inflight.get(i)!;
      inflight.delete(i);
      kickoff(i + CONC); // mantener la ventana llena
      if (!local) {
        failed++;
        req.log.warn({ id: r.id }, "zip: archivo omitido");
        continue;
      }
      const nm = nameFor(r);
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(t);
          archive.off("entry", done);
          resolve();
        };
        const t = setTimeout(done, 120_000);
        archive.once("entry", done);
        archive.file(local, { name: nm, date: new Date(r.captured_at) });
      });
      added++;
    }
    req.log.info({ userId, added, failed }, "zip: finalizando");
    await archive.finalize();
  });

  // ---------- listar ----------
  app.get("/v1/assets", { preHandler: requireUser }, async (req) => {
    const { userId } = principalOf(req);
    const q = req.query as { limit?: string; cursor?: string; kind?: string; fav?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 80, 1), 500);
    const params: unknown[] = [userId];
    let sql = `select ${A} from assets a where a.user_id = $1 and a.deleted_at is null`;

    if (q.kind === "photo" || q.kind === "video") {
      params.push(q.kind);
      sql += ` and a.kind = $${params.length}`;
    }
    if (q.fav === "1") sql += " and a.is_favorite";
    if (q.cursor) {
      const [ts, id] = Buffer.from(q.cursor, "base64url").toString("utf8").split("|");
      params.push(ts, id);
      sql += ` and (a.captured_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(limit + 1);
    sql += ` order by a.captured_at desc, a.id desc limit $${params.length}`;

    const res = await query<Row>(sql, params);
    const rows = res.rows;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await Promise.all(page.map(withUrls));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(`${last.captured_at.toISOString()}|${last.id}`, "utf8").toString("base64url")
        : null;

    return { items, nextCursor };
  });

  // ---------- detalle ----------
  app.get("/v1/assets/:id", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    const r = await one<Row>(`select ${A} from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null`, [id, userId]);
    if (!r) return reply.code(404).send({ error: "no existe" });
    logAccess(userId, id, "view", req.headers["user-agent"]);
    return {
      ...(await withUrls(r)),
      originalUrl: await signedUrl(r.original_key, { expiresIn: 600, downloadName: r.filename }),
    };
  });

  // ---------- reproducir / ver el original en línea (sin forzar descarga) ----------
  app.get("/v1/assets/:id/stream", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    const r = await one<Row>(
      `select ${A} from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null`,
      [id, userId],
    );
    if (!r) return reply.code(404).send({ error: "no existe" });
    return reply.redirect(await signedUrl(r.original_key, { expiresIn: 3600 }), 302);
  });

  // ---------- descargar original ----------
  app.get("/v1/assets/:id/original", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    const r = await one<Row>(`select ${A} from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null`, [id, userId]);
    if (!r) return reply.code(404).send({ error: "no existe" });
    logAccess(userId, id, "download", req.headers["user-agent"]);
    return reply.redirect(await signedUrl(r.original_key, { expiresIn: 600, downloadName: r.filename }), 302);
  });

  // ---------- póster / miniatura grande ----------
  app.get("/v1/assets/:id/poster", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    const r = await one<Row>(`select ${A} from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null`, [id, userId]);
    if (!r) return reply.code(404).send({ error: "no existe" });
    return reply.redirect(await signedUrl(r.poster_key ?? r.thumb_key, { expiresIn: 3600 }), 302);
  });

  // ---------- borrar (liberar espacio) ----------
  app.delete("/v1/assets/:id", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    const r = await one<Row>(`select ${A} from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null`, [id, userId]);
    if (!r) return reply.code(404).send({ error: "no existe" });

    await query("update assets set deleted_at = now() where id = $1", [id]);
    await Promise.allSettled([
      remove(r.original_key),
      remove(r.thumb_key),
      r.poster_key ? remove(r.poster_key) : Promise.resolve(),
      r.live_video_key ? remove(r.live_video_key) : Promise.resolve(),
    ]);
    req.log.info({ id, userId, freed: Number(r.bytes) }, "asset borrado");
    return reply.code(204).send();
  });
}
