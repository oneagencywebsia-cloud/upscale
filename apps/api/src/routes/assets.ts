import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import { createHash } from "node:crypto";

// El tope YA NO es el de Telegram (2/4 GB por documento) — putSplit() trocea
// automáticamente un original más grande en varias partes al guardarlo (ver
// storage.ts/telegram.ts). El límite real ahora es el disco del VPS, que se
// comprueba antes de aceptar el cuerpo (ver el preflight con statfs abajo).
// 200 GB como techo absoluto, solo para tener alguna cota razonable.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024 * 1024;
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
import { ingestLocalFile } from "../pipeline.js";
import { requireUser, requireUploadToken, principalOf } from "../auth.js";
import { cuotaDe, premiarInvitacion } from "../accounts.js";
import { cogerHueco } from "../uploadSlots.js";
import { servirZip, filtroDe, filasDe, repartirEnPartes, progresoDe, ES_UUID as ES_UUID_ZIP } from "../zipDownload.js";

/** «parte 2 de 5» desde ?part=2&of=5 (solo cambia el nombre del archivo). */
function jobDe(q: Record<string, unknown>): string | null {
  return typeof q.job === "string" ? q.job : null;
}

function parteDe(q: Record<string, unknown>): { n: number; de: number } | null {
  const n = Math.floor(Number(q.part));
  const de = Math.floor(Number(q.of));
  return n >= 1 && de >= 2 && n <= de && de <= 500 ? { n, de } : null;
}

interface Row {
  id: string; user_id: string; kind: AssetKind; filename: string; mime: string; bytes: string;
  sha256: string; width: number | null; height: number | null; duration_s: string | null;
  fps: string | null; video_bitrate: string | null; codec: string | null;
  captured_at: Date; uploaded_at: Date; camera_make: string | null; camera_model: string | null;
  lens: string | null; lat: number | null; lon: number | null; is_live: boolean;
  thumb_key: string; poster_key: string | null; original_key: string;
  preview_key: string | null; preview_bytes: string | null;
  live_video_key: string | null; live_video_bytes: string | null;
  is_favorite: boolean;
}

// Todas las columnas de assets MENOS los blobs pesados (thumb_webp/poster_jpg),
// que se sirven por /v1/blob y no deben viajar en cada consulta.
const A =
  "a.id, a.user_id, a.kind, a.filename, a.mime, a.bytes, a.sha256, a.width, a.height, " +
  "a.duration_s, a.fps, a.video_bitrate, a.codec, a.captured_at, a.uploaded_at, a.camera_make, " +
  "a.camera_model, a.lens, a.lat, a.lon, a.is_live, a.original_key, a.thumb_key, a.poster_key, " +
  "a.live_video_key, a.live_video_bytes, a.is_favorite, a.deleted_at, " +
  "a.preview_key, a.preview_bytes";

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

/** `uuid` de Postgres: cualquier otra cosa hace reventar la consulta con un
 *  error de casting (500 "error interno") en vez del 404 honesto que toca. */
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cuánto debe durar la URL firmada de una DESCARGA, según el peso del archivo.
 *
 * Los 600 s fijos de antes eran un fallo real desde que un original puede
 * pesar decenas de GB: la firma se comprueba en CADA petición a /v1/blob, y
 * una descarga de 20 GB por un tubo de ~2-4 MB/s dura HORAS. A los ~10 min la
 * URL caducaba y todas las peticiones siguientes (incluida cualquier
 * reanudación del navegador o un gestor de descargas) pasaban a responder
 * 403: la descarga de un archivo grande era, literalmente, imposible de
 * terminar. Se calcula sobre un ritmo deliberadamente pesimista (150 KB/s)
 * para cubrir también una conexión móvil mala, con suelo de 15 min y techo de
 * 7 días. El enlace sigue siendo un HMAC atado a ESA key y solo lo obtiene
 * quien está autenticado.
 */
function ttlDescarga(bytes: number): number {
  const RITMO_PESIMISTA = 150 * 1024; // B/s
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  return Math.min(7 * 24 * 3600, Math.max(900, Math.ceil(n / RITMO_PESIMISTA)));
}

/**
 * Igual, pero para REPRODUCIR: aquí no manda el ancho de banda sino el tiempo
 * de pantalla — un vídeo largo pausado a la mitad y retomado después seguía
 * teniendo una URL de 1 h que caducaba mientras el <video> estaba abierto, y
 * el siguiente Range devolvía 403 (el reproductor se queda congelado sin
 * explicación). 4x la duración, entre 1 h y 24 h.
 */
function ttlReproduccion(durationS: number | null): number {
  const d = durationS && Number.isFinite(durationS) ? durationS : 0;
  return Math.min(24 * 3600, Math.max(3600, Math.ceil(d * 4)));
}

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

      // ---- cuota y tamaño máximo del plan, ANTES de aceptar ni un byte ----
      // Todo acaba en una única cuenta de Telegram: la cuota es lo que impide que
      // una persona la sature. El administrador no tiene tope.
      const cuota = await cuotaDe(principalOf(req));
      const declaredBytes = Number(h["content-length"]) || 0;
      if (declaredBytes > cuota.maxFileBytes) {
        return reply.code(413).send({
          code: "FILE_TOO_BIG",
          error: `Este archivo pesa más de lo que admite tu plan ${cuota.plan.name} por archivo (${Math.floor(cuota.maxFileBytes / 1024 ** 3)} GB).`,
          maxFileBytes: cuota.maxFileBytes,
        });
      }
      if (declaredBytes > cuota.remainingBytes) {
        return reply.code(402).send({
          code: "QUOTA",
          error: "No te queda espacio para este archivo. Libera espacio o consigue más con un código o invitando a alguien.",
          usedBytes: cuota.usedBytes,
          limitBytes: cuota.limitBytes,
        });
      }
      // tope de subidas a la vez (Telegram y disco son compartidos)
      const liberarHueco = cogerHueco(userId);
      if (!liberarHueco) {
        return reply.code(429).header("retry-after", "5").send({
          code: "BUSY",
          error: "Hay muchas subidas a la vez ahora mismo. Se reintentará solo en unos segundos.",
        });
      }
      reply.raw.once("close", liberarHueco);
      req.raw.once("close", liberarHueco);
      // sin Content-Length (o si miente) el tope se aplica mientras llega
      const maxCuerpo = Math.min(MAX_UPLOAD_BYTES, cuota.maxFileBytes, cuota.remainingBytes);

      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tmpOrig = join(env.TMP_DIR, `${stamp}.upload`);

      // Preflight de disco: el original llega ENTERO a TMP_DIR antes de
      // trocearlo/procesarlo (un vídeo de 1h a 4K/60 puede ser 20-45 GB) —
      // mejor rechazar YA, con un mensaje claro, que quedarse sin espacio a
      // mitad de la subida. Solo si el cliente manda Content-Length (siempre
      // en subidas normales); si no, se confía en sizeLimiter como antes.
      const declaredLen = Number(h["content-length"]) || 0;
      if (declaredLen > 0) {
        try {
          const { statfs } = await import("node:fs/promises");
          const fsStat = await statfs(env.TMP_DIR);
          const libres = fsStat.bavail * fsStat.bsize;
          const necesarios = declaredLen * 1.15 + 512 * 1024 * 1024; // margen para el troceado temporal
          if (libres < necesarios) {
            req.log.warn({ userId, declaredLen, libres }, "subida: sin espacio en disco suficiente");
            return reply.code(507).send({ error: `no hay espacio en disco suficiente para un archivo de ${Math.round(declaredLen / 1e9)} GB` });
          }
        } catch {
          /* si statfs falla (sistema de archivos raro), no bloqueamos */
        }
      }

      try {
        try {
          await pipeline(req.body as Readable, sizeLimiter(maxCuerpo), createWriteStream(tmpOrig));
        } catch (e) {
          await rm(tmpOrig, { force: true });
          if ((e as { code?: string })?.code === "PAYLOAD_TOO_LARGE") {
            if (maxCuerpo === cuota.remainingBytes && cuota.remainingBytes < cuota.maxFileBytes) {
              return reply.code(402).send({ code: "QUOTA", error: "No te queda espacio para este archivo." });
            }
            return reply.code(413).send({ code: "FILE_TOO_BIG", error: "el archivo supera el límite máximo admitido" });
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
        // «invita y gana»: la primera vez que la persona invitada guarda algo, se paga el premio
        if (res.status === "saved") premiarInvitacion(userId).catch(() => {});
        return { status: res.status, id: res.id };
      } catch (err) {
        await rm(tmpOrig, { force: true }).catch(() => {});
        if ((err as { code?: string })?.code === "EMPTY") {
          return reply.code(400).send({ error: "el archivo llegó vacío (0 bytes)" });
        }
        if ((err as { code?: string })?.code === "UNREADABLE") {
          return reply.code(400).send({
            error: "el archivo llegó dañado (falta su índice interno) y no se puede reproducir — revisa la copia original antes de volver a subirlo",
          });
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
      if (!ES_UUID.test(id)) return reply.code(404).send({ error: "no existe" });
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
    if (!ES_UUID.test(id)) return reply.code(404).send({ error: "no existe" });
    const body = (req.body as { value?: boolean } | undefined) ?? {};
    const r = await one<{ is_favorite: boolean }>(
      "update assets set is_favorite = $1 where id = $2 and user_id = $3 and deleted_at is null returning is_favorite",
      [body.value ?? true, id, userId],
    );
    if (!r) return reply.code(404).send({ error: "no existe" });
    return { isFavorite: r.is_favorite };
  });

  // ---------- descargar TODO (o una selección) en un ZIP ----------
  // POST (lo normal): la selección va en el cuerpo — con cientos de fotos los ids
  // no caben en una URL. GET se mantiene por compatibilidad (enlaces antiguos).
  // El nombre lleva el rango de fechas: "Recuerdos del 2026-07-01 al 2026-09-08.zip".
  const zipBody = { bodyLimit: 8 * 1024 * 1024 };
  app.get("/v1/assets/zip", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const q = req.query as Record<string, unknown>;
    return servirZip(req, reply, userId, filtroDe(q), { parte: parteDe(q), job: jobDe(q) });
  });
  app.post("/v1/assets/zip", { preHandler: requireUser, ...zipBody }, async (req, reply) => {
    const { userId } = principalOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    return servirZip(req, reply, userId, filtroDe(b), { parte: parteDe(b), job: jobDe(b) });
  });

  // Progreso de un ZIP en marcha (la web lo pregunta cada poco para su barra).
  app.get("/v1/assets/zip/progress", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const job = (req.query as Record<string, unknown>).job;
    const p = typeof job === "string" && ES_UUID_ZIP.test(job) ? progresoDe(job, userId) : null;
    if (!p) return reply.code(404).send({ error: "no hay descarga con ese id" });
    reply.header("Cache-Control", "no-store");
    return p;
  });

  // Antes de descargar «todo»: cuánto es y en cuántas partes conviene bajarlo
  // (en el móvil un ZIP de decenas de GB no es razonable). Cada parte lleva sus ids.
  app.post("/v1/assets/zip/plan", { preHandler: requireUser, ...zipBody }, async (req, reply) => {
    const { userId } = principalOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const filtro = filtroDe(b);
    if (filtro.ids && !filtro.ids.length) return reply.code(400).send({ error: "ningún id válido" });
    const max = Math.min(Math.max(Number(b.maxPartBytes) || 2 * 1024 ** 3, 100 * 1024 ** 2), 20 * 1024 ** 3);
    const rows = await filasDe(userId, filtro);
    const parts = repartirEnPartes(rows, max);
    return {
      count: rows.length,
      bytes: rows.reduce((n, r) => n + (Number(r.bytes) || 0), 0),
      parts,
    };
  });

  // ---------- listar ----------
  app.get("/v1/assets", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const q = req.query as {
      limit?: string; cursor?: string; kind?: string; fav?: string;
      q?: string; camera?: string; from?: string; to?: string; sort?: string;
    };
    const limit = Math.min(Math.max(Number(q.limit) || 80, 1), 500);
    // `sort=added`: lo último que se ha SUBIDO primero (por `uploaded_at`), en vez
    // de por la fecha en que se hizo la foto. Sin esto, un archivo antiguo que
    // acabas de subir queda enterrado en su día original y parece que no llegó.
    const added = q.sort === "added";
    const orderCol = added ? "uploaded_at" : "captured_at";
    const params: unknown[] = [userId];
    // En modo "added" el cursor lleva el `uploaded_at` con sus microsegundos
    // (to_char): un Date de JS los trunca a milisegundos y la paginación se
    // saltaría las filas insertadas dentro del mismo milisegundo.
    const cursorCol = added
      ? `, to_char(a.uploaded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts`
      : "";
    let sql = `select ${A}${cursorCol} from assets a where a.user_id = $1 and a.deleted_at is null`;

    if (q.kind === "photo" || q.kind === "video" || q.kind === "audio") {
      params.push(q.kind);
      sql += ` and a.kind = $${params.length}`;
    }
    if (q.fav === "1") sql += " and a.is_favorite";
    if (typeof q.q === "string" && q.q.trim()) {
      params.push(`%${q.q.trim()}%`);
      sql += ` and a.filename ilike $${params.length}`;
    }
    if (typeof q.camera === "string" && q.camera.trim()) {
      params.push(q.camera.trim());
      sql += ` and a.camera_make = $${params.length}`;
    }
    if (typeof q.from === "string" && q.from.trim() && !Number.isNaN(Date.parse(q.from))) {
      params.push(q.from.trim());
      sql += ` and a.captured_at >= $${params.length}::timestamptz`;
    }
    if (typeof q.to === "string" && q.to.trim() && !Number.isNaN(Date.parse(q.to))) {
      params.push(q.to.trim());
      sql += ` and a.captured_at < $${params.length}::timestamptz`;
    }
    if (typeof q.cursor === "string" && q.cursor) {
      // Un cursor manipulado o truncado hacía que Postgres fallara al castear
      // ("invalid input syntax for type uuid") y la galería entera respondía
      // 500 "error interno" — con un 400 claro el cliente sabe que debe
      // recargar desde el principio.
      const [ts, id] = Buffer.from(q.cursor, "base64url").toString("utf8").split("|");
      if (!ts || !id || !ES_UUID.test(id) || Number.isNaN(Date.parse(ts))) {
        return reply.code(400).send({ error: "cursor inválido" });
      }
      params.push(ts, id);
      sql += ` and (a.${orderCol}, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(limit + 1);
    sql += ` order by a.${orderCol} desc, a.id desc limit $${params.length}`;

    const res = await query<Row & { cursor_ts?: string }>(sql, params);
    const rows = res.rows;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await Promise.all(page.map(withUrls));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(`${added ? (last as Row & { cursor_ts?: string }).cursor_ts : last.captured_at.toISOString()}|${last.id}`, "utf8").toString("base64url")
        : null;

    return { items, nextCursor };
  });

  // ---------- cámaras distintas (para el desplegable de filtros) ----------
  app.get("/v1/assets/cameras", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const rows = (
      await query<{ camera_make: string }>(
        "select distinct camera_make from assets where user_id=$1 and camera_make is not null and deleted_at is null order by camera_make",
        [userId],
      )
    ).rows;
    return { cameras: rows.map((r) => r.camera_make) };
  });

  // ---------- puntos geolocalizados (vista de mapa) ----------
  // Carga única (sin paginación keyset): una biblioteca personal de ~1.500
  // archivos cabe entera en un solo viaje. El límite de 3000 es un TOPE DE
  // SEGURIDAD, no paginación real.
  app.get("/v1/assets/map", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const rows = (
      await query<{ id: string; lat: number; lon: number; thumb_key: string }>(
        `select a.id, a.lat, a.lon, a.thumb_key from assets a
         where a.user_id = $1 and a.deleted_at is null and a.lat is not null and a.lon is not null
         order by a.captured_at desc limit 3000`,
        [userId],
      )
    ).rows;
    const points = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        lat: r.lat,
        lon: r.lon,
        thumbUrl: await signedUrl(r.thumb_key, { expiresIn: DERIV_TTL }),
      })),
    );
    return { points };
  });

  // ---------- detalle ----------
  app.get("/v1/assets/:id", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    if (!ES_UUID.test(id)) return reply.code(404).send({ error: "no existe" });
    const r = await one<Row>(`select ${A} from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null`, [id, userId]);
    if (!r) return reply.code(404).send({ error: "no existe" });
    logAccess(userId, id, "view", req.headers["user-agent"]);
    return {
      ...(await withUrls(r)),
      originalUrl: await signedUrl(r.original_key, {
        expiresIn: ttlDescarga(Number(r.bytes)),
        downloadName: r.filename,
      }),
    };
  });

  // ---------- reproducir / ver el original en línea (sin forzar descarga) ----------
  app.get("/v1/assets/:id/stream", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    if (!ES_UUID.test(id)) return reply.code(404).send({ error: "no existe" });
    const r = await one<Row>(
      `select ${A} from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null`,
      [id, userId],
    );
    if (!r) return reply.code(404).send({ error: "no existe" });
    // REPRODUCIR (y solo reproducir) usa la copia ligera si existe: el tubo del
    // VPS da ~2,3 MB/s y un 4K/60 pide ~6,2, así que el original se atasca.
    // Las descargas (/original, el ZIP, originalUrl) NUNCA pasan por aquí.
    const paraVer = r.preview_key ?? r.original_key;
    if (r.kind === "video" && !r.preview_key) {
      // Sin copia ligera todavía: se sirve el original (puede cortarse si el
      // bitrate supera lo que da la conexión sostenida) y de paso se marca
      // para que la cola de generarPreviews() lo procese ANTES que el resto
      // — ver un vídeo con cortes ahora mismo lo salta al principio en vez
      // de esperar su turno por orden de subida. `greatest(preview_state,0)`
      // además REABRE un vídeo que ya se había rendido (-1) tras agotar sus
      // reintentos: si alguien lo está viendo con cortes AHORA, merece un
      // intento nuevo — más aún tras reforzar hoy todo el pipeline (timeouts,
      // comprobación de disco…) que pudo ser la causa de fallos previos.
      // `preview_next_attempt_at = now()` SALTA el backoff si ya había
      // fallado antes: sin esto, "urgente" podía significar igualmente
      // esperar hasta 30-1440 min si el vídeo estaba a mitad de su ciclo de
      // reintentos — "urgente" tiene que significar AHORA, no "en su turno".
      // Fire-and-forget: no debe retrasar ni un milisegundo la reproducción.
      query(
        "update assets set preview_bump_at = now(), preview_state = greatest(preview_state, 0), preview_next_attempt_at = now() where id = $1 and preview_key is null",
        [id],
      ).catch(() => {});
    }
    return reply.redirect(
      await signedUrl(paraVer, { expiresIn: ttlReproduccion(r.duration_s === null ? null : Number(r.duration_s)) }),
      302,
    );
  });

  // ---------- descargar original ----------
  app.get("/v1/assets/:id/original", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    if (!ES_UUID.test(id)) return reply.code(404).send({ error: "no existe" });
    const r = await one<Row>(`select ${A} from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null`, [id, userId]);
    if (!r) return reply.code(404).send({ error: "no existe" });
    logAccess(userId, id, "download", req.headers["user-agent"]);
    return reply.redirect(
      await signedUrl(r.original_key, { expiresIn: ttlDescarga(Number(r.bytes)), downloadName: r.filename }),
      302,
    );
  });

  // ---------- póster / miniatura grande ----------
  app.get("/v1/assets/:id/poster", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    if (!ES_UUID.test(id)) return reply.code(404).send({ error: "no existe" });
    const r = await one<Row>(`select ${A} from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null`, [id, userId]);
    if (!r) return reply.code(404).send({ error: "no existe" });
    return reply.redirect(await signedUrl(r.poster_key ?? r.thumb_key, { expiresIn: 3600 }), 302);
  });

  // ---------- borrar (liberar espacio) ----------
  app.delete("/v1/assets/:id", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    if (!ES_UUID.test(id)) return reply.code(404).send({ error: "no existe" });
    const r = await one<Row>(`select ${A} from assets a where a.id = $1 and a.user_id = $2 and a.deleted_at is null`, [id, userId]);
    if (!r) return reply.code(404).send({ error: "no existe" });

    await query("update assets set deleted_at = now() where id = $1", [id]);
    await Promise.allSettled([
      remove(r.original_key),
      remove(r.thumb_key),
      r.preview_key ? remove(r.preview_key) : Promise.resolve(),
      r.poster_key ? remove(r.poster_key) : Promise.resolve(),
      r.live_video_key ? remove(r.live_video_key) : Promise.resolve(),
    ]);
    req.log.info({ id, userId, freed: Number(r.bytes) }, "asset borrado");
    return reply.code(204).send();
  });
}
