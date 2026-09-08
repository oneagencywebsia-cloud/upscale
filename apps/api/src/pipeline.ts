import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { query, one } from "./db.js";
import { put } from "./storage.js";
import { probe, sharpThumb, extractFrame, placeholderThumb, extFor, mimeFor, safeIso } from "./media.js";
import { env } from "./env.js";

const VIDEO_EXTS = [".mov", ".mp4", ".m4v", ".webm", ".mkv", ".avi"];
const IMAGE_EXTS = [".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".tiff", ".dng", ".avif"];

export interface IngestResult {
  status: "saved" | "duplicate";
  id: string;
  kind: "photo" | "video";
  bytes: number;
}

/** SHA-256 de un archivo del disco. */
async function hashFile(p: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(
    createReadStream(p),
    new Transform({
      transform(c, _e, cb) {
        h.update(c);
        cb(null, c);
      },
    }),
  );
  return h.digest("hex");
}

/**
 * Mete un archivo YA presente en disco en la biblioteca del usuario:
 * hash + dedup + ffprobe + guardar original en el almacén + miniatura/póster.
 * Lo usan tanto la subida HTTP como la ingesta desde Telegram. Borra `filePath`.
 */
export async function ingestLocalFile(opts: {
  userId: string;
  filePath: string;
  filename: string;
  contentType?: string;
  capturedAtHint?: string;
  log?: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void };
}): Promise<IngestResult> {
  const { userId, filePath, contentType, capturedAtHint } = opts;
  const log = opts.log ?? { info: () => {}, warn: () => {} };
  let filename = opts.filename || "IMG";

  const { size } = await stat(filePath);
  if (size === 0) {
    await rm(filePath, { force: true });
    throw Object.assign(new Error("archivo vacío (0 bytes)"), { code: "EMPTY" });
  }

  const sha256 = await hashFile(filePath);

  const dup = await one<{ id: string; kind: "photo" | "video" }>(
    "select id, kind from assets where user_id = $1 and sha256 = $2 and deleted_at is null",
    [userId, sha256],
  );
  if (dup) {
    await rm(filePath, { force: true });
    return { status: "duplicate", id: dup.id, kind: dup.kind, bytes: size };
  }

  const info = await probe(filePath, filename, contentType);

  let ext = (extFor(filename, contentType).toLowerCase().match(/^\.[a-z0-9]{1,12}$/)?.[0]) ?? ".bin";
  if (info.kind === "video" && !VIDEO_EXTS.includes(ext)) ext = ".mov";
  if (info.kind === "photo" && !IMAGE_EXTS.includes(ext)) ext = ".jpg";

  const capturedAt = info.capturedAt ?? safeIso(capturedAtHint) ?? new Date().toISOString();
  const d = new Date(capturedAt);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");

  if (!/\.[a-z0-9]{2,5}$/i.test(filename)) {
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const min = String(d.getUTCMinutes()).padStart(2, "0");
    filename = `${info.kind === "video" ? "VID" : "IMG"}_${yyyy}${mm}${dd}_${hh}${min}${ext}`;
  }

  const base = `${userId}/${yyyy}/${mm}/${sha256}`;
  const originalKey = `orig/${base}${ext}`;
  const thumbKey = `copy/${base}/thumb.webp`;
  const posterKey = info.kind === "video" ? `copy/${base}/poster.jpg` : null;
  const mime = mimeFor(ext, contentType);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpThumb = join(env.TMP_DIR, `${stamp}.thumb.webp`);
  const tmpPoster = join(env.TMP_DIR, `${stamp}.poster.jpg`);

  await placeholderThumb(tmpThumb, info.kind).catch(() => {});
  await Promise.all([put(originalKey, filePath, mime), put(thumbKey, tmpThumb, "image/webp")]);

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
  log.info({ id, kind: info.kind, size, userId }, "asset guardado (miniatura en 2º plano)");

  // miniatura + póster reales en 2º plano; luego se borra el archivo de disco
  void (async () => {
    try {
      if (info.kind === "video") {
        await extractFrame(filePath, tmpPoster);
        await sharpThumb(tmpPoster, tmpThumb);
        await Promise.all([put(thumbKey, tmpThumb, "image/webp"), put(posterKey!, tmpPoster, "image/jpeg")]);
        await query("update assets set poster_key = $1 where id = $2", [posterKey, id]);
      } else {
        await sharpThumb(filePath, tmpThumb);
        await put(thumbKey, tmpThumb, "image/webp");
      }
    } catch (e) {
      log.warn(e, "no se pudo generar la miniatura real; se queda la de reserva");
    } finally {
      await Promise.allSettled([
        rm(filePath, { force: true }),
        rm(tmpThumb, { force: true }),
        rm(tmpPoster, { force: true }),
      ]);
    }
  })();

  return { status: "saved", id, kind: info.kind, bytes: size };
}
