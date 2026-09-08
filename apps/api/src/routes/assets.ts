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
import { put, signedUrl, remove } from "../storage.js";
import { probe, sharpThumb, extractFrame, placeholderThumb, extFor, mimeFor, safeIso } from "../media.js";
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

async function withUrls(r: Row): Promise<AssetListItem> {
  return {
    ...toAsset(r),
    thumbUrl: await signedUrl(r.thumb_key, { expiresIn: 3600 }),
    posterUrl: r.poster_key ? await signedUrl(r.poster_key, { expiresIn: 3600 }) : null,
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

      const ext = (extFor(filename, contentType).toLowerCase().match(/^\.[a-z0-9]{1,12}$/)?.[0]) ?? ".bin";
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tmpOrig = join(env.TMP_DIR, `${stamp}${ext}`);
      const tmpThumb = join(env.TMP_DIR, `${stamp}.thumb.webp`);
      const tmpPoster = join(env.TMP_DIR, `${stamp}.poster.jpg`);
      const cleanup = () =>
        Promise.allSettled([rm(tmpOrig, { force: true }), rm(tmpThumb, { force: true }), rm(tmpPoster, { force: true })]);

      try {
        const hash = createHash("sha256");
        const hasher = new Transform({
          transform(chunk, _enc, cb) {
            hash.update(chunk);
            cb(null, chunk);
          },
        });
        try {
          await pipeline(req.body as Readable, sizeLimiter(MAX_UPLOAD_BYTES), hasher, createWriteStream(tmpOrig));
        } catch (e) {
          await cleanup();
          if ((e as { code?: string })?.code === "PAYLOAD_TOO_LARGE") {
            return reply.code(413).send({ error: "el archivo supera el límite de 2 GB" });
          }
          throw e;
        }
        const sha256 = hash.digest("hex");
        const { size } = await stat(tmpOrig);
        if (size === 0) {
          await cleanup();
          return reply.code(400).send({ error: "archivo vacío" });
        }

        const dup = await one<{ id: string }>(
          "select id from assets where user_id = $1 and sha256 = $2 and deleted_at is null",
          [userId, sha256],
        );
        if (dup) {
          await cleanup();
          return { status: "duplicate", id: dup.id };
        }

        const info = await probe(tmpOrig, filename, contentType);
        const capturedAt = info.capturedAt ?? safeIso(capturedHeader) ?? new Date().toISOString();

        const d = new Date(capturedAt);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");

        // Si no vino un nombre real (el Atajo no manda X-Filename), fabricamos uno legible.
        if (!/\.[a-z0-9]{2,5}$/i.test(filename)) {
          const dd = String(d.getUTCDate()).padStart(2, "0");
          const hh = String(d.getUTCHours()).padStart(2, "0");
          const min = String(d.getUTCMinutes()).padStart(2, "0");
          filename = `${info.kind === "video" ? "VID" : "IMG"}_${yyyy}${mm}${dd}_${hh}${min}${ext}`;
        }

        const base = `${userId}/${yyyy}/${mm}/${sha256}`;
        const originalKey = `orig/${base}${ext}`;
        const thumbKey = `copy/${base}/thumb.webp`;
        const mime = mimeFor(ext, contentType);

        const posterKey = info.kind === "video" ? `copy/${base}/poster.jpg` : null;

        // 1) el original va a Telegram YA (es lo único que no se puede aplazar sin
        //    arriesgar el archivo). En paralelo, sube una miniatura de reserva mínima
        //    para que la galería no dé 404 mientras se genera la de verdad.
        await placeholderThumb(tmpThumb, info.kind).catch(() => {});
        await Promise.all([
          put(originalKey, tmpOrig, mime),
          put(thumbKey, tmpThumb, "image/webp"),
        ]);

        const inserted = await one<{ id: string }>(
          `insert into assets
             (user_id, kind, filename, mime, bytes, sha256, width, height, duration_s, fps, video_bitrate,
              codec, captured_at, camera_make, camera_model, lens, lat, lon, is_live,
              original_key, thumb_key, poster_key)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           returning id`,
          [
            userId, info.kind, filename, mime, size, sha256, info.width, info.height, info.durationS, info.fps,
            info.videoBitrate, info.codec, capturedAt, info.cameraMake, info.cameraModel, info.lens,
            info.lat, info.lon, false, originalKey, thumbKey, null,
          ],
        );
        const id = inserted!.id;

        query("update upload_tokens set last_used = now() where token = $1", [h["x-upload-token"]]).catch(() => {});
        req.log.info({ id, kind: info.kind, size, userId }, "asset guardado (miniatura en 2º plano)");

        // 2) miniatura + póster reales en segundo plano — la respuesta ya sale
        void (async () => {
          try {
            if (info.kind === "video") {
              await extractFrame(tmpOrig, tmpPoster);
              await sharpThumb(tmpPoster, tmpThumb);
              await Promise.all([
                put(thumbKey, tmpThumb, "image/webp"),
                put(posterKey!, tmpPoster, "image/jpeg"),
              ]);
              await query("update assets set poster_key = $1 where id = $2", [posterKey, id]);
            } else {
              await sharpThumb(tmpOrig, tmpThumb);
              await put(thumbKey, tmpThumb, "image/webp");
            }
          } catch (e) {
            req.log.warn(e, "no se pudo generar la miniatura real; se queda la de reserva");
          } finally {
            await cleanup();
          }
        })();

        return { status: "saved", id };
      } catch (err) {
        await cleanup();
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
        "select a.* from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null",
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
        await pipeline(createReadStream(tmp), new Transform({ transform(c, _e, cb) { sha.update(c); cb(null, c); } }));
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

  // ---------- listar ----------
  app.get("/v1/assets", { preHandler: requireUser }, async (req) => {
    const { userId } = principalOf(req);
    const q = req.query as { limit?: string; cursor?: string; kind?: string; fav?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 80, 1), 200);
    const params: unknown[] = [userId];
    let sql = "select a.* from assets a where a.user_id = $1 and a.deleted_at is null";

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
    const r = await one<Row>("select a.* from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null", [id, userId]);
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
      "select a.* from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null",
      [id, userId],
    );
    if (!r) return reply.code(404).send({ error: "no existe" });
    return reply.redirect(await signedUrl(r.original_key, { expiresIn: 3600 }), 302);
  });

  // ---------- descargar original ----------
  app.get("/v1/assets/:id/original", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    const r = await one<Row>("select a.* from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null", [id, userId]);
    if (!r) return reply.code(404).send({ error: "no existe" });
    logAccess(userId, id, "download", req.headers["user-agent"]);
    return reply.redirect(await signedUrl(r.original_key, { expiresIn: 600, downloadName: r.filename }), 302);
  });

  // ---------- póster / miniatura grande ----------
  app.get("/v1/assets/:id/poster", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    const r = await one<Row>("select a.* from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null", [id, userId]);
    if (!r) return reply.code(404).send({ error: "no existe" });
    return reply.redirect(await signedUrl(r.poster_key ?? r.thumb_key, { expiresIn: 3600 }), 302);
  });

  // ---------- borrar (liberar espacio) ----------
  app.delete("/v1/assets/:id", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    const r = await one<Row>("select a.* from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null", [id, userId]);
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
