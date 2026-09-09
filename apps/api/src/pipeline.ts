import { createReadStream } from "node:fs";
import { rm, stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { query, one } from "./db.js";
import { put } from "./storage.js";
import { probe, sharpThumb, extractFrame, placeholderThumb, extFor, mimeFor, safeIso } from "./media.js";
import { env } from "./env.js";

const VIDEO_EXTS = [".mov", ".mp4", ".m4v", ".webm", ".mkv", ".avi"];
const IMAGE_EXTS = [".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".tiff", ".dng", ".avif"];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_r, rej) => {
      t = setTimeout(() => rej(new Error(`timeout ${Math.round(ms / 1000)}s: ${label}`)), ms);
    }),
  ]).finally(() => clearTimeout(t!)) as Promise<T>;
}

export interface IngestResult {
  status: "saved" | "duplicate";
  id: string;
  kind: "photo" | "video";
  bytes: number;
}

/** SHA-256 de un archivo del disco. Bucle simple: no puede bloquearse por backpressure. */
async function hashFile(p: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(p, { highWaterMark: 1024 * 1024 })) {
    h.update(chunk as Buffer);
  }
  return h.digest("hex");
}

/**
 * Guarda miniatura (y póster) EN LA BASE DE DATOS. Son pequeños y así el usuario
 * siempre los ve, pase lo que pase con Telegram o con la caché de disco efímera.
 */
async function saveDerivativeBytes(id: string, thumbPath: string, posterPath?: string | null): Promise<void> {
  const thumb = await readFile(thumbPath).catch(() => null);
  const poster = posterPath ? await readFile(posterPath).catch(() => null) : null;
  if (!thumb && !poster) return;
  if (thumb && poster) {
    await query("update assets set thumb_webp = $1, poster_jpg = $2 where id = $3", [thumb, poster, id]);
  } else if (thumb) {
    await query("update assets set thumb_webp = $1 where id = $2", [thumb, id]);
  } else if (poster) {
    await query("update assets set poster_jpg = $1 where id = $2", [poster, id]);
  }
}

/**
 * Regenera miniatura (y póster, si es vídeo) de un asset a partir de una copia
 * del original en disco, y las guarda en la BD. Lo usa el barrido de recuperación
 * cuando un asset se guarda tarde y su miniatura quedó vacía.
 */
export async function regenerateDerivatives(
  id: string,
  kind: "photo" | "video",
  filePath: string,
): Promise<void> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpThumb = join(env.TMP_DIR, `${stamp}.rt.webp`);
  const tmpPoster = join(env.TMP_DIR, `${stamp}.rp.jpg`);
  try {
    if (kind === "video") {
      await extractFrame(filePath, tmpPoster);
      await sharpThumb(tmpPoster, tmpThumb);
      await saveDerivativeBytes(id, tmpThumb, tmpPoster);
    } else {
      await sharpThumb(filePath, tmpThumb);
      await saveDerivativeBytes(id, tmpThumb, null);
    }
  } finally {
    await Promise.allSettled([rm(tmpThumb, { force: true }), rm(tmpPoster, { force: true })]);
  }
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
  /** Si el archivo YA está en Telegram (ingesta del inbox): id del mensaje a
   *  reenviar al almacén en vez de re-subir los bytes desde el VPS. */
  forwardFromInboxMsgId?: number;
  /** Ingesta diferida: crea la fila YA (metadatos + miniatura local) y deja el
   *  original SIN guardar en el almacén; lo hace el barrido de fondo. El vídeo
   *  aparece en segundos aunque Telegram esté frenando escrituras. */
  deferStore?: boolean;
  /** callback para ver el sub-paso en vivo (lo pinta /ingest/status). */
  onStep?: (s: string) => void;
  log?: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void };
}): Promise<IngestResult> {
  const { userId, filePath, contentType, capturedAtHint } = opts;
  const log = opts.log ?? { info: () => {}, warn: () => {} };
  const step = (s: string) => {
    opts.onStep?.(s);
    log.info({ paso: s }, "ingesta: paso");
  };
  let filename = opts.filename || "IMG";

  step("stat");
  const { size } = await stat(filePath);
  if (size === 0) {
    await rm(filePath, { force: true });
    throw Object.assign(new Error("archivo vacío (0 bytes)"), { code: "EMPTY" });
  }

  step("hash");
  const sha256 = await hashFile(filePath);

  step("dedup");
  const dup = await one<{ id: string; kind: "photo" | "video" }>(
    "select id, kind from assets where user_id = $1 and sha256 = $2 and deleted_at is null",
    [userId, sha256],
  );
  if (dup) {
    await rm(filePath, { force: true });
    return { status: "duplicate", id: dup.id, kind: dup.kind, bytes: size };
  }

  step("probe");
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

  step("miniatura-reserva");
  await placeholderThumb(tmpThumb, info.kind).catch(() => {});

  // ---------- Ingesta DIFERIDA: fila ya, original y miniatura real después ----------
  if (opts.deferStore && opts.forwardFromInboxMsgId) {
    step("import-telegram");
    const { tgCachePut } = await import("./telegram.js");

    // 1) miniatura de reserva a la caché de disco → /v1/blob ya sirve algo
    step("cache-thumb");
    await tgCachePut(thumbKey, tmpThumb).catch(() => {});

    // 2) fila creada YA (metadatos de ffprobe, que ya corrió arriba con timeout duro)
    step("insert");
    const insertedD = await one<{ id: string }>(
      `insert into assets
         (user_id, kind, filename, mime, bytes, sha256, width, height, duration_s, fps, video_bitrate,
          codec, captured_at, camera_make, camera_model, lens, lat, lon, is_live,
          original_key, thumb_key, poster_key, stored, src_msg_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,false,$23)
       returning id`,
      [
        userId, info.kind, filename, mime, size, sha256, info.width, info.height, info.durationS, info.fps,
        info.videoBitrate, info.codec, capturedAt, info.cameraMake, info.cameraModel, info.lens,
        info.lat, info.lon, false, originalKey, thumbKey, posterKey, opts.forwardFromInboxMsgId,
      ],
    );
    const dId = insertedD!.id;
    // miniatura de reserva ya en BD → nunca 404, aunque no haya nada más
    await saveDerivativeBytes(dId, tmpThumb, null).catch(() => {});
    log.info({ id: dId, kind: info.kind, size }, "asset creado (original y miniatura real pendientes)");

    // 3) miniatura + póster REALES en 2º plano (no bloquean que el vídeo aparezca)
    void (async () => {
      try {
        if (info.kind === "video") {
          await extractFrame(filePath, tmpPoster);
          await sharpThumb(tmpPoster, tmpThumb);
        } else {
          await sharpThumb(filePath, tmpThumb);
        }
        await saveDerivativeBytes(dId, tmpThumb, info.kind === "video" ? tmpPoster : null);
        // la miniatura también a Telegram (blob_refs) → durable y se sirve por la
        // vía normal con caché de disco, sin consultar la BD en cada carga de galería
        await put(thumbKey, tmpThumb, "image/webp").catch((e) => log.warn(e, "miniatura no subida a TG"));
        if (posterKey) await tgCachePut(posterKey, tmpPoster).catch(() => {});
      } catch (e) {
        log.warn(e, "miniatura real falló; se queda la de reserva");
      } finally {
        await Promise.allSettled([
          rm(filePath, { force: true }),
          rm(tmpThumb, { force: true }),
          rm(tmpPoster, { force: true }),
        ]);
      }
    })();

    return { status: "saved", id: dId, kind: info.kind, bytes: size };
  }

  // El original: se intenta REENVIAR dentro de Telegram (instantáneo, sin gastar
  // subida del VPS). El forward de un userbot está limitado (FLOOD_WAIT), así que
  // se le da un margen corto: si no sale ya, se sube el archivo como plan B.
  const storeOriginal = (async () => {
    if (opts.forwardFromInboxMsgId) {
      try {
        const { putOriginalByForward } = await import("./storage.js");
        await withTimeout(
          putOriginalByForward(originalKey, opts.forwardFromInboxMsgId, filePath),
          15_000,
          "reenviar al almacén",
        );
        return;
      } catch (e) {
        log.warn({ err: (e as Error)?.message }, "forward al almacén no salió; subo el archivo");
      }
    }
    await put(originalKey, filePath, mime);
  })();

  // la miniatura va a la BD (más abajo); aquí solo el original
  await withTimeout(storeOriginal, 12 * 60_000, "guardar original en el almacén");

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
  await saveDerivativeBytes(id, tmpThumb, null).catch(() => {}); // reserva en BD ya
  log.info({ id, kind: info.kind, size, userId }, "asset guardado (miniatura real en 2º plano)");

  // miniatura + póster reales en 2º plano; luego se borra el archivo de disco
  void (async () => {
    try {
      await withTimeout(
        (async () => {
          if (info.kind === "video") {
            await extractFrame(filePath, tmpPoster);
            await sharpThumb(tmpPoster, tmpThumb);
            await saveDerivativeBytes(id, tmpThumb, tmpPoster);
            await query("update assets set poster_key = $1 where id = $2", [posterKey, id]);
          } else {
            await sharpThumb(filePath, tmpThumb);
            await saveDerivativeBytes(id, tmpThumb, null);
          }
          await put(thumbKey, tmpThumb, "image/webp").catch(() => {}); // durable + caché de disco
        })(),
        6 * 60_000,
        "miniatura en 2º plano",
      );
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
