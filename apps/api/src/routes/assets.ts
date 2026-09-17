import { createReadStream, createWriteStream, existsSync } from "node:fs";
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

/**
 * Un solo ZIP a la vez en TODO el proceso.
 *
 * Cada ZIP mantiene una ventana de descargas grandes en el disco del VPS con
 * su propio presupuesto de espacio; dos o tres a la vez (un doble clic en
 * "descargar todo", una pestaña recargada) multiplicaban ese presupuesto por
 * el número de ZIPs y podían llenar el disco entre todos — además de repartir
 * el mismo techo de ancho de banda de Telegram entre varias descargas, con lo
 * que TODAS van más lentas y ninguna acaba antes. Mejor decirlo claro.
 */
let zipEnCurso = false;

/** Nombre seguro dentro del ZIP: sin rutas ni ".." (el nombre viene de la
 *  cabecera X-Filename de quien subió el archivo, no del servidor). */
function nombreZipSeguro(nm: string): string {
  const base = nm.replace(/[\\/]+/g, "_").replace(/^\.+/, "_").replace(/[\x00-\x1f]/g, "");
  return base.slice(0, 180) || "archivo";
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
          await pipeline(req.body as Readable, sizeLimiter(MAX_UPLOAD_BYTES), createWriteStream(tmpOrig));
        } catch (e) {
          await rm(tmpOrig, { force: true });
          if ((e as { code?: string })?.code === "PAYLOAD_TOO_LARGE") {
            return reply.code(413).send({ error: "el archivo supera el límite máximo admitido" });
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
        if ((err as { code?: string })?.code === "UNREADABLE") {
          return reply.code(400).send({
            error: "el vídeo llegó dañado (falta el índice interno del archivo) y no se puede reproducir — revisa la copia original antes de volver a subirlo",
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
  // El nombre del ZIP lleva el rango de fechas: "Recuerdos del 2026-07-01 al 2026-09-08.zip".
  // Al descomprimir queda esa carpeta con todos los originales dentro.
  app.get("/v1/assets/zip", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const rawIds = (req.query as Record<string, unknown>).ids;
    // ?ids=a&ids=b llega como array: sin esto, `.split` reventaba con un 500.
    const idsStr = typeof rawIds === "string" ? rawIds : Array.isArray(rawIds) ? rawIds.join(",") : null;
    const idList = idsStr
      ? idsStr.split(",").map((s) => String(s).trim()).filter((s) => ES_UUID.test(s)).slice(0, 20000)
      : null;
    if (idsStr && !idList?.length) return reply.code(400).send({ error: "ningún id válido en ?ids" });

    if (zipEnCurso) {
      return reply
        .code(409)
        .send({ error: "ya hay una descarga en ZIP en curso; espera a que termine y vuelve a intentarlo" });
    }

    const params: unknown[] = [userId];
    let sql = `select a.id, a.kind, a.filename, a.captured_at, a.original_key, a.bytes
                 from assets a where a.user_id = $1 and a.deleted_at is null`;
    if (idList) {
      params.push(idList);
      sql += ` and a.id = any($2::uuid[])`;
    }
    sql += " order by a.captured_at asc, a.id asc";
    const rows = (await query<{ id: string; kind: string; filename: string; captured_at: Date; original_key: string; bytes: string }>(sql, params)).rows;
    if (!rows.length) return reply.code(404).send({ error: "nada que descargar" });

    const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const d1 = ymd(rows[0]!.captured_at);
    const d2 = ymd(rows[rows.length - 1]!.captured_at);
    const name = (d1 === d2 ? `Recuerdos ${d1}` : `Recuerdos del ${d1} al ${d2}`).replace(/[^\w .\-]/g, "");

    // A partir de aquí el ZIP es "el" ZIP en curso: el finally del final lo
    // libera pase lo que pase (fin normal, error o cancelación del navegador).
    zipEnCurso = true;
    try {
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

    // Si el navegador corta la descarga del ZIP hay que parar DE VERDAD: sin
    // esto seguían corriendo las descargas de la ventana de prefetch (varios
    // GB cada una) para un ZIP que ya no lee nadie.
    let abortado = false;
    let terminado = false; // el bucle ya no va a usar más archivos
    reply.raw.once("close", () => {
      abortado = true;
    });

    // Los originales se bajan a la caché de disco (tgEnsureLocal). El
    // limpiador de esa caché (pruneCache en telegram.ts) borra por antigüedad
    // en cuanto se pasa del presupuesto, y NO sabe nada de este ZIP: podía
    // borrar el archivo que archiver está a punto de abrir → 'error' ENOENT →
    // se destruía el socket y el ZIP entero se iba al traste a media
    // descarga. pinCachedFile() lo marca como "en uso" mientras dura su
    // entrada en el ZIP (es justo para lo que existe; ya lo usa el worker de
    // previews). Solo aplica al motor telegram; con "local" no hay caché que
    // limpiar y los originales son los archivos de verdad.
    const pin: ((p: string) => () => void) | null =
      env.STORAGE_DRIVER === "telegram"
        ? await import("../telegram.js").then((m) => m.pinCachedFile).catch(() => null)
        : null;

    // Ventana de prefetch: se bajan CONC archivos a la vez (y cada uno con varios
    // hilos por dentro) mientras el ZIP escribe el anterior. Store mode, byte a byte.
    //
    // PERO el prefetch ya no puede ser "3 archivos" a secas: desde que un
    // original puede pesar 20-100 GB, tres en vuelo son 300 GB en el disco del
    // VPS antes de escribir la primera entrada — se llena el disco y se cae
    // TODO (ingesta, previews, subidas), no solo el ZIP. Se limita también por
    // BYTES en vuelo, con un presupuesto sacado del espacio libre real.
    const CONC = 3;
    let presupuesto = 8 * 1024 * 1024 * 1024; // suelo razonable si statfs falla
    try {
      const { statfs } = await import("node:fs/promises");
      const dir = env.STORAGE_DRIVER === "telegram" ? env.TG_CACHE_DIR : env.STORAGE_DIR;
      const s = await statfs(dir);
      // la mitad de lo libre, nunca más de 64 GB: el resto del sistema
      // (ingesta, transcodificaciones) sigue necesitando disco mientras tanto.
      presupuesto = Math.min(64 * 1024 * 1024 * 1024, Math.max(2 * 1024 * 1024 * 1024, Math.floor(s.bavail * s.bsize * 0.5)));
    } catch {
      /* sistema de archivos raro: nos quedamos con el suelo */
    }

    const inflight = new Map<number, Promise<string | null>>();
    const enVuelo = new Map<number, number>(); // índice -> bytes reservados
    const pins = new Map<number, () => void>(); // índice -> soltar el pin
    const bytesEnVuelo = () => [...enVuelo.values()].reduce((n, x) => n + x, 0);
    const kickoff = (i: number) => {
      if (i >= rows.length || inflight.has(i) || abortado) return;
      const b = Number(rows[i]!.bytes) || 0;
      // SIEMPRE se permite al menos una descarga, aunque ese archivo solo ya
      // se salga del presupuesto — si no, un vídeo más grande que el
      // presupuesto no se descargaría nunca y el ZIP se quedaría colgado.
      if (inflight.size > 0 && bytesEnVuelo() + b > presupuesto) return;
      enVuelo.set(i, b);
      inflight.set(
        i,
        blobToLocalFile(rows[i]!.original_key)
          .then((p) => {
            // Pin EN CUANTO está en disco, no al llegarle el turno: un archivo
            // descargado por adelantado puede pasarse horas esperando (mientras
            // se comprime un vídeo enorme anterior) y el limpiador de caché lo
            // habría borrado por antiguo justo antes de usarlo.
            // `terminado`: una descarga de la ventana que acaba DESPUÉS de que
            // el bucle haya cortado no debe dejar un pin colgado — ese archivo
            // sería intocable para el limpiador de caché el resto de la vida
            // del proceso.
            if (p && pin && !terminado && !pins.has(i)) pins.set(i, pin(p));
            return p;
          })
          .catch(() => null),
      );
    };
    const soltarPin = (i: number) => {
      pins.get(i)?.();
      pins.delete(i);
    };
    for (let i = 0; i < CONC; i++) kickoff(i);

    const nameFor = (r: { filename: string; kind: string; id: string }) => {
      // El nombre viene de X-Filename al subir: si trae "/" o "..", el ZIP
      // saldría con rutas dentro (zip-slip) y al descomprimir escribiría fuera
      // de la carpeta. Se neutraliza aquí, que es donde se construye la entrada.
      let nm = nombreZipSeguro(r.filename || `${r.kind}_${r.id}`);
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
      if (abortado || reply.raw.destroyed) break;
      const r = rows[i]!;
      if (!inflight.has(i)) kickoff(i); // el presupuesto pudo dejarlo fuera antes
      const local = await inflight.get(i)!;
      inflight.delete(i);
      enVuelo.delete(i);
      // Rellenar la ventana: puede entrar más de uno si los que acaban de
      // salir liberaron presupuesto.
      for (let j = i + 1; j < Math.min(rows.length, i + 1 + CONC); j++) kickoff(j);
      // El archivo puede haber desaparecido entre la descarga y su turno (una
      // limpieza de caché agresiva, un borrado manual). Antes eso llegaba a
      // archiver como un ENOENT → evento 'error' → socket destruido → el ZIP
      // ENTERO se cortaba a mitad. Ahora se reintenta una vez y, si aún no
      // está, se salta ese archivo y el ZIP continúa con el resto.
      let ruta = local;
      if (ruta && !existsSync(ruta)) {
        req.log.warn({ id: r.id }, "zip: el original ya no estaba en disco, se rebaja de nuevo");
        ruta = await blobToLocalFile(r.original_key).catch(() => null);
        if (ruta && pin && !pins.has(i)) pins.set(i, pin(ruta));
        if (ruta && !existsSync(ruta)) ruta = null;
      }
      if (!ruta) {
        soltarPin(i);
        failed++;
        req.log.warn({ id: r.id }, "zip: archivo omitido");
        continue;
      }
      const local2 = ruta;
      const nm = nameFor(r);
      try {
        await new Promise<void>((resolve) => {
          // Espera a que archiver TERMINE esta entrada antes de seguir: es lo
          // que mantiene la ventana de prefetch en su sitio (si no, se
          // encolarían de golpe miles de entradas y se dispararían todas las
          // descargas a la vez).
          //
          // Antes había un `setTimeout(done, 120_000)` fijo. Con originales de
          // decenas de GB eso se queda corto por definición: archiver tiene
          // que leer el archivo ENTERO del disco (y mandarlo por el socket, al
          // ritmo del que descarga) para cerrar la entrada — 20 GB no caben en
          // 2 minutos ni con disco rápido. El plazo saltaba, el bucle seguía
          // adelante y se perdía todo el control de flujo. Ahora el criterio es
          // PROGRESO, no tiempo: mientras el ZIP siga escribiendo bytes
          // (archive.pointer() sube), se espera lo que haga falta; solo se
          // abandona si pasan 10 minutos sin escribir ni un byte.
          let ultimo = archive.pointer();
          let quieto = 0;
          let iv: ReturnType<typeof setInterval> | null = null;
          const done = () => {
            if (iv) clearInterval(iv);
            iv = null;
            archive.off("entry", done);
            archive.off("error", done);
            resolve();
          };
          iv = setInterval(() => {
            if (abortado || reply.raw.destroyed) return done();
            const ahora = archive.pointer();
            if (ahora > ultimo) {
              ultimo = ahora;
              quieto = 0;
              return;
            }
            if (++quieto >= 20) {
              req.log.warn({ id: r.id, nm }, "zip: entrada sin progreso 10 min, se abandona");
              done();
            }
          }, 30_000);
          archive.once("entry", done);
          archive.once("error", done);
          archive.file(local2, { name: nm, date: new Date(r.captured_at) });
        });
      } finally {
        soltarPin(i);
      }
      added++;
    }
    // Soltar los pines que queden (ventana de prefetch al cortar, archivos
    // saltados): si no, esos archivos se quedarían intocables para el limpiador
    // de caché PARA SIEMPRE y el disco no se recuperaría nunca.
    terminado = true;
    for (const i of [...pins.keys()]) soltarPin(i);
    req.log.info({ userId, added, failed }, "zip: finalizando");
    try {
      // finalize() sobre un socket ya cerrado (el usuario canceló) rechaza;
      // como la respuesta está hijacked, ese rechazo llegaría al manejador de
      // errores de Fastify, que intentaría responder sobre una respuesta ya
      // tomada. Se traga aquí, que es donde se sabe qué pasó.
      if (abortado || reply.raw.destroyed) archive.abort();
      else await archive.finalize();
    } catch (e) {
      req.log.warn({ err: (e as Error)?.message }, "zip: cierre con incidencias");
      if (!reply.raw.destroyed) reply.raw.destroy();
    }
    } finally {
      zipEnCurso = false;
    }
  });

  // ---------- listar ----------
  app.get("/v1/assets", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const q = req.query as {
      limit?: string; cursor?: string; kind?: string; fav?: string;
      q?: string; camera?: string; from?: string; to?: string;
    };
    const limit = Math.min(Math.max(Number(q.limit) || 80, 1), 500);
    const params: unknown[] = [userId];
    let sql = `select ${A} from assets a where a.user_id = $1 and a.deleted_at is null`;

    if (q.kind === "photo" || q.kind === "video") {
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
