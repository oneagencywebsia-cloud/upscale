import { mkdir, rm, writeFile, stat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { env } from "./env.js";
import { query, one } from "./db.js";
import { ingestLocalFile, regenerateDerivatives } from "./pipeline.js";
import { makePreview, placeholderBroken } from "./media.js";
import {
  tgInboxNewMedia,
  tgInboxStartId,
  tgDownloadInbox,
  tgDownloadInboxHeadTail,
  tgDeleteInbox,
  resetTelegram,
  armInboxListener,
  tgPutByForward,
  tgPut,
  tgEnsureLocal,
  tgHeadTailTemp,
  streamingActivo,
  tgEnsureHead,
  tieneArranque,
  pinCachedFile,
  headsBudgetCount,
} from "./telegram.js";

/** Vídeos/archivos por encima de esto: se ingiere solo la cabecera (rápido) y el
 *  original entero se guarda por reenvío server-side. Debajo, descarga completa
 *  (es rápida y así el hash real y las dimensiones entran a la primera). */
const HEAD_INGEST_OVER_BYTES = 16 * 1024 * 1024;
/** Cabecera: contiene los primeros fotogramas (de ahí sale el póster). */
const HEAD_BYTES = 8 * 1024 * 1024;
/** Cola: en los MP4/MOV del iPhone el índice `moov` (duración, resolución, fps,
 *  códec) va AL FINAL. Sin esto ffprobe no lee nada y el vídeo entra sin datos. */
const TAIL_BYTES = 6 * 1024 * 1024;

/** Tope real de Telegram para un documento (ver env.ts). Por encima de esto, la
 *  re-subida de un original (recuperación pesada) está condenada a fallar — no
 *  es un fallo nuestro reintentable, es un muro de Telegram. */
const TELEGRAM_FILE_CEILING_BYTES = (env.TELEGRAM_ACCOUNT_PREMIUM ? 4 : 2) * 1024 * 1024 * 1024;

/**
 * Timeout que escala con el tamaño en vez de un número fijo — un vídeo de horas
 * en 4K pesa varios GB y a la única conexión que usa Telegram por descarga
 * (~1 MB/s, ver TG_DOWNLOAD_STREAMS en env.ts) tarda bastante más que los pocos
 * minutos fijos que había antes. Con `mbPerSec` conservador y margen x1.5 para
 * red lenta/reintentos internos; techo duro para que ni un archivo enorme cuelgue
 * el proceso para siempre. Mismo criterio que ya usa generarPreviews() al subir
 * la copia de reproducción (allí el tamaño está acotado por diseño y por eso el
 * timeout es fijo a 60 min; aquí el ORIGINAL no tiene ese tope, así que escala).
 */
function scaledTimeoutMs(bytes: number, minMs: number, mbPerSec = 1, safetyFactor = 1.5): number {
  const bytesPerSec = mbPerSec * 1024 * 1024;
  const est = bytes > 0 ? (bytes / bytesPerSec) * 1000 * safetyFactor : 0;
  return Math.max(minMs, Math.min(est, 6 * 60 * 60_000)); // techo duro: 6 h
}

/**
 * Hueco libre en TMP_DIR frente a lo que hace falta (con margen). Antes de bajar
 * un original de posiblemente varios GB a un temporal, mejor comprobar y aplazar
 * con un aviso claro que quedarse sin disco a mitad de la descarga — mismo
 * criterio que el statfs ya usado en generarPreviews() antes de transcodificar.
 */
async function hasDiskSpaceFor(neededBytes: number): Promise<boolean> {
  try {
    const { statfs } = await import("node:fs/promises");
    const fsStat = await statfs(env.TMP_DIR);
    const libres = fsStat.bavail * fsStat.bsize;
    const necesarios = neededBytes * 1.2 + 512 * 1024 * 1024; // colchón fijo de 512 MB
    return libres >= necesarios;
  } catch {
    return true; // si statfs falla (sistema de archivos raro), no bloqueamos
  }
}

/**
 * Vigila el inbox de Telegram (Mensajes guardados por defecto). Cada archivo
 * enviado "como archivo" entra en la biblioteca SIN recomprimir — la única vía
 * inalámbrica que conserva el 4K/60fps/HEVC del iPhone.
 *
 * El usuario destino: el caption del mensaje si es un token de subida (`upl_…`),
 * o si no INGEST_USER_ID.
 */

const KEY = "ingest:last_id";
let running = false;
let runningSince = 0;
let pausedUntil = 0; // epoch ms: si Telegram nos mete FLOOD_WAIT, paramos hasta aquí

/** Intentos fallidos por mensaje, persistidos en kv (sobreviven a reinicios). */
async function getFails(id: number): Promise<number> {
  const r = await one<{ v: string }>("select v from kv where k = $1", [`ingest:fail:${id}`]);
  return r ? Number(r.v) || 0 : 0;
}
async function bumpFails(id: number): Promise<number> {
  const n = (await getFails(id)) + 1;
  await query(
    "insert into kv (k, v, updated_at) values ($1,$2,now()) on conflict (k) do update set v = excluded.v, updated_at = now()",
    [`ingest:fail:${id}`, String(n)],
  );
  return n;
}
async function clearFails(id: number): Promise<void> {
  await query("delete from kv where k = $1", [`ingest:fail:${id}`]).catch(() => {});
}

/** Estado observable para diagnóstico (GET /v1/ingest/status). */
export const ingestState: {
  started: boolean;
  inbox: string;
  running: boolean;
  runningForSeconds: number | null;
  lastTickAt: string | null;
  lastTickError: string | null;
  lastStep: string;
  lastSeen: number;
  lastImported: { id: number; assetId: string; at: string } | null;
  totalImported: number;
  /** Cuánto tardó cada fase del último archivo (ms) — para ver dónde se va el tiempo. */
  lastTimings: { bytes: number; downloadMs: number; processMs: number; totalMs: number } | null;
  pausedUntil: string | null;
  pending: number;
  /** trabajo de mantenimiento pendiente (miniaturas/metadatos/pósters) */
  chores: number;
} = {
  started: false,
  inbox: env.TELEGRAM_INBOX,
  running: false,
  runningForSeconds: null,
  lastTickAt: null,
  lastTickError: null,
  lastStep: "-",
  lastSeen: 0,
  lastImported: null,
  totalImported: 0,
  lastTimings: null,
  pausedUntil: null,
  pending: 0,
  chores: 0,
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_r, rej) => {
      t = setTimeout(() => rej(new Error(`timeout ${Math.round(ms / 1000)}s en ${label}`)), ms);
    }),
  ]).finally(() => clearTimeout(t!)) as Promise<T>;
}

async function getLastId(): Promise<number> {
  const r = await one<{ v: string }>("select v from kv where k = $1", [KEY]);
  return r ? Number(r.v) || 0 : 0;
}
async function setLastId(id: number): Promise<void> {
  await query(
    "insert into kv (k, v, updated_at) values ($1, $2, now()) on conflict (k) do update set v = excluded.v, updated_at = now()",
    [KEY, String(id)],
  );
}

async function resolveUser(caption: string | null): Promise<string | null> {
  // 1) token de subida en el caption del mensaje
  const tok = caption?.trim().match(/\bupl_[A-Za-z0-9_-]{16,}\b/)?.[0];
  if (tok) {
    const row = await one<{ user_id: string }>("select user_id from upload_tokens where token = $1", [tok]);
    if (row) return row.user_id;
  }
  // 2) atado a mano desde Ajustes ("recibir aquí los vídeos de Telegram")
  const bound = await one<{ v: string }>("select v from kv where k = 'ingest:user_id'").catch(() => null);
  if (bound?.v) return bound.v;
  // 3) variable de entorno
  if (env.INGEST_USER_ID) return env.INGEST_USER_ID;
  // 4) el usuario más reciente con token de subida (suele ser el que acaba de configurarlo)
  const tk = await one<{ user_id: string }>(
    "select user_id from upload_tokens order by created_at desc limit 1",
  );
  if (tk) return tk.user_id;
  // 5) último recurso: el usuario con más biblioteca
  const top = await one<{ user_id: string }>(
    "select user_id from assets where deleted_at is null group by user_id order by count(*) desc limit 1",
  );
  return top?.user_id ?? null;
}

/** Ata la ingesta a un usuario concreto (kv). Lo llama el botón de Ajustes. */
export async function ingestBindUser(userId: string): Promise<void> {
  await query(
    "insert into kv (k, v, updated_at) values ('ingest:user_id', $1, now()) on conflict (k) do update set v = excluded.v, updated_at = now()",
    [userId],
  );
}
export async function ingestBoundUser(): Promise<string | null> {
  const r = await one<{ v: string }>("select v from kv where k = 'ingest:user_id'").catch(() => null);
  return r?.v ?? null;
}

async function tick(log: FastifyBaseLoggerLike): Promise<void> {
  // watchdog: si una vuelta lleva colgada > 12 min, la damos por muerta y reconectamos
  if (running && Date.now() - runningSince > 12 * 60_000) {
    log.error({ colgadaDesde: new Date(runningSince).toISOString(), enPaso: ingestState.lastStep }, "ingesta: vuelta colgada, reseteo forzado");
    running = false;
    resetTelegram();
  }
  if (running) return;
  if (Date.now() < pausedUntil) {
    ingestState.lastStep = `en pausa por FLOOD_WAIT hasta ${new Date(pausedUntil).toISOString()}`;
    return;
  }
  running = true;
  runningSince = Date.now();
  ingestState.running = true;
  ingestState.lastTickAt = new Date().toISOString();
  // OJO: no borramos lastTickError aquí — así queda visible por qué falló el último;
  // se limpia solo cuando algo se importa bien.
  ingestState.lastStep = "arrancando";
  try {
    // primer arranque: fijamos el punto de partida en el último mensaje actual
    // para NO procesar el histórico de Mensajes guardados, solo lo que llegue nuevo.
    const inited = await one<{ v: string }>("select v from kv where k = 'ingest:inited'");
    if (!inited) {
      const start = await tgInboxStartId(30);
      await setLastId(start);
      await query("insert into kv (k, v) values ('ingest:inited', '1') on conflict (k) do nothing");
      log.info({ lastId: start }, "ingesta: punto de partida fijado (recoge lo de los últimos 30 min)");
      // no return: seguimos y procesamos ya lo reciente en esta misma vuelta
    }

    // el barrido de guardado corre SIEMPRE y ANTES de ingerir nuevos: así el
    // backlog de originales pendientes drena aunque el usuario esté subiendo en
    // bloque (los reenvíos son instantáneos).
    await storePending(log).catch((e) => log.warn(e, "barrido de guardado"));

    ingestState.lastStep = "getLastId";
    const lastId = await getLastId();
    ingestState.lastStep = "listando inbox";
    const items = await withTimeout(tgInboxNewMedia(lastId), 60_000, "listar inbox");
    ingestState.lastSeen = items.length;
    if (!items.length) return;

    await mkdir(env.TMP_DIR, { recursive: true });
    for (const it of items) {
      const userId = await resolveUser(it.caption);
      if (!userId) {
        ingestState.lastTickError = `msg ${it.id}: no se pudo determinar el usuario (pon INGEST_USER_ID o sube algo primero)`;
        log.warn({ id: it.id }, "ingesta: sin usuario destino; no se toca el mensaje, se reintenta");
        continue; // NO avanzamos lastId ni borramos: se reintenta cuando haya usuario
      }
      const tmp = join(env.TMP_DIR, `tg-${it.id}-${randomBytes(4).toString("hex")}${it.filename.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? ""}`);
      try {
        const t0 = Date.now();
        // VÍDEOS grandes: solo la cabecera (segundos), no el vídeo entero
        // (minutos a ~1 MB/s). El original íntegro lo guarda storePending por
        // reenvío; las dimensiones que falten las completa backfillDerivatives.
        // Las fotos (incluida ProRAW/DNG, que sí necesita el archivo entero para
        // el revelado) van siempre completas.
        const isVideo = it.mime.startsWith("video/") || /\.(mov|mp4|m4v|hevc|avi|mkv|webm)$/i.test(it.filename);
        const headOnly = isVideo && it.bytes > HEAD_INGEST_OVER_BYTES;
        let dl: number;
        if (headOnly) {
          ingestState.lastStep = `leyendo cabecera+cola de msg ${it.id} (${Math.round(it.bytes / 1e6)} MB)`;
          log.info({ id: it.id, filename: it.filename, bytes: it.bytes, userId }, "ingesta: cabecera+cola (archivo grande)");
          dl = await withTimeout(
            tgDownloadInboxHeadTail(it.id, tmp, HEAD_BYTES, TAIL_BYTES),
            90_000,
            "leer cabecera+cola de Telegram",
          );
        } else {
          // preflight de disco: esta rama SÍ baja el archivo entero (fotos de
          // cualquier tamaño, o vídeos pequeños) — con ProRAW/panorámicas puede
          // ser bastante más que unos pocos MB. Mejor aplazar con un aviso claro
          // que quedarse sin espacio a mitad de la descarga. No cuenta como
          // fallo del mensaje: se reintenta en cuanto haya hueco.
          if (it.bytes > 0 && !(await hasDiskSpaceFor(it.bytes))) {
            ingestState.lastTickError = `msg ${it.id}: sin espacio en disco suficiente para ${Math.round(it.bytes / 1e6)} MB, se aplaza`;
            log.warn({ id: it.id, bytes: it.bytes }, "ingesta: sin espacio en disco, se aplaza");
            continue; // NO avanzamos lastId: se reintenta la próxima vuelta
          }
          const dlTimeout = scaledTimeoutMs(it.bytes, 11 * 60_000);
          ingestState.lastStep = `descargando msg ${it.id} (${Math.round(it.bytes / 1e6)} MB)`;
          log.info({ id: it.id, filename: it.filename, bytes: it.bytes, userId }, "ingesta: descargando de Telegram");
          dl = await withTimeout(tgDownloadInbox(it.id, tmp, dlTimeout), dlTimeout + 30_000, "descargar de Telegram");
        }
        const t1 = Date.now();
        log.info({ id: it.id, bytes: dl, downloadMs: t1 - t0, headOnly }, "ingesta: descargado, procesando");
        ingestState.lastStep = `procesando msg ${it.id}`;
        // headOnly: hash de 4 MB + ffprobe de 14 MB en disco → 4 min de sobra.
        // Sin headOnly (fotos grandes, ProRAW/DNG) se lee el archivo ENTERO para
        // el hash: escala por si acaso, aunque en disco local es rápido — mejor
        // sobrar margen que abortar una foto de 500 MB a mitad de hashear.
        const procTimeout = headOnly ? 4 * 60_000 : scaledTimeoutMs(it.bytes, 4 * 60_000, 30, 2);
        const res = await withTimeout(
          ingestLocalFile({
            userId,
            filePath: tmp,
            filename: it.filename,
            contentType: it.mime,
            capturedAtHint: new Date(it.date * 1000).toISOString(),
            forwardFromInboxMsgId: it.id,
            deferStore: true, // la fila se crea YA; el original se guarda en el barrido de fondo
            headOnly,
            knownBytes: it.bytes,
            onStep: (s) => { ingestState.lastStep = `msg ${it.id}: ${s}`; },
            log,
          }),
          procTimeout,
          "crear la fila del asset",
        );
        const t2 = Date.now();
        ingestState.lastTimings = { bytes: dl, downloadMs: t1 - t0, processMs: t2 - t1, totalMs: t2 - t0 };
        log.info({ id: it.id, assetId: res.id, status: res.status, kind: res.kind, downloadMs: t1 - t0, processMs: t2 - t1 }, "ingesta: fila creada");
        ingestState.lastImported = { id: it.id, assetId: res.id, at: new Date().toISOString() };
        ingestState.totalImported++;
        ingestState.lastTickError = null;
        await clearFails(it.id);
        // si era duplicado no hay fila nueva pendiente: se borra el mensaje ya
        if (res.status === "duplicate") {
          await withTimeout(tgDeleteInbox([it.id]), 30_000, "borrar mensaje").catch(() => {});
        }
        await setLastId(it.id); // no reprocesar; el mensaje se borra tras guardarse el original
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => {});
        const msg = (e as Error)?.message ?? String(e);
        const n = await bumpFails(it.id);
        ingestState.lastTickError = `msg ${it.id} (intento ${n}): ${msg}`;
        log.error({ id: it.id, intento: n, err: msg }, "ingesta: fallo con un mensaje");

        // FLOOD_WAIT: Telegram nos frena. Pausamos el poller el tiempo que pida
        // (o 15 min por defecto) en vez de seguir machacando.
        const fw = /flood(?:_wait)?[ _]?(\d+)/i.exec(msg);
        if (fw || /flood/i.test(msg)) {
          const secs = fw ? Math.min(3600, Number(fw[1]) + 5) : 900;
          pausedUntil = Date.now() + secs * 1000;
          ingestState.pausedUntil = new Date(pausedUntil).toISOString();
          log.warn({ secs }, "ingesta: FLOOD_WAIT, poller en pausa");
          break;
        }

        resetTelegram(); // por si la conexión está medio muerta
        if (n >= 3) {
          log.error({ id: it.id }, "ingesta: 3 fallos, se salta este mensaje");
          await clearFails(it.id);
          await setLastId(it.id); // pasamos al siguiente
          continue;
        }
        break; // reintentamos este mismo en la próxima vuelta
      }
    }

    /* el mantenimiento va en el finally: aquí no, que un `return` temprano
       (inbox vacío) lo dejaba sin ejecutar. Ver maintenance(). */
  } catch (e) {
    ingestState.lastTickError = (e as Error)?.message ?? String(e);
    log.error({ err: (e as Error)?.message }, "ingesta: fallo en la vuelta");
  } finally {
    // SIEMPRE, haya llegado algo nuevo o no. Estaba tras el bucle de items y el
    // `return` de "inbox vacío" lo saltaba: como el inbox está vacío casi todo
    // el tiempo, el backfill no llegaba a ejecutarse NUNCA y nada se reparaba
    // solo (miniaturas de reserva eternas, pósters sin sacar de la BD…).
    await maintenance(log).catch((e) => log.warn(e, "mantenimiento"));
    running = false;
    ingestState.running = false;
    ingestState.lastStep = "en reposo";
    void armInboxListener().catch(() => {}); // re-arma el disparo instantáneo si hubo reconexión
  }
}

/**
 * Tareas de fondo que deben correr en CADA vuelta, llegue o no material nuevo:
 * guardar originales pendientes, regenerar miniaturas/metadatos que fallaron y
 * ir sacando los pósters de Postgres a Telegram.
 */
async function maintenance(log: FastifyBaseLoggerLike): Promise<void> {
  // autocuración: restos en disco de un worker que murió a mitad de faena
  // (OOM-kill, redeploy). Barato (throttled a 1 vuelta cada 30 min) y corre
  // SIEMPRE, incluso con reproducción activa — es solo un listado de directorio.
  await limpiarTemporalesHuerfanos(log).catch((e) => log.warn(e, "limpieza de temporales huérfanos"));

  // guardar originales pendientes es prioritario (son reenvíos, no gastan banda)
  await storePending(log).catch((e) => log.warn(e, "barrido de guardado"));

  // El resto son descargas pesadas. Si el usuario está viendo un vídeo AHORA,
  // se apartan: reproducir siempre manda sobre el mantenimiento. Antes el
  // barrido acaparaba las 4 conexiones y la reproducción caía a 2 MB/s.
  if (streamingActivo()) {
    ingestState.lastStep = "en reposo (mantenimiento en pausa: reproducción en curso)";
  } else {
    // lo PRIMERO: que abrir un vídeo sea inmediato. Es barato y es lo que se nota.
    await precargarArranques(log).catch((e) => log.warn(e, "precarga de arranques"));
    if (ingestState.pending <= 3 && !streamingActivo()) {
      await backfillDerivatives(log).catch((e) => log.warn(e, "barrido de miniaturas"));
    }
    if (ingestState.pending === 0 && !streamingActivo()) {
      await offloadPosters(log).catch((e) => log.warn(e, "barrido de pósters"));
    }
    // OJO: generarPreviews NO va aquí. Transcodificar un 4K son minutos y
    // congelaría este bucle entero (miniaturas, arranques, guardado). Corre en
    // su propio worker independiente — ver startPreviewWorker().
  }
  // ¿queda faena? el bucle no debe irse al ritmo lento con trabajo por hacer
  const q = await one<{ n: string }>(
    `select count(*) n from assets a
       where deleted_at is null and stored = true and not unrecoverable
         and (
           (poster_jpg is null and not exists (select 1 from blob_refs br where br.key = a.poster_key))
           or (kind = 'video' and (width is null or duration_s is null)
               and octet_length(coalesce(poster_jpg, ''::bytea)) > 4)
           or (poster_key is not null and octet_length(coalesce(poster_jpg, ''::bytea)) > 4
               and not exists (select 1 from blob_refs br where br.key = a.poster_key))
         )`,
  ).catch(() => null);
  ingestState.chores = q ? Number(q.n) : 0;
}

/**
 * Restos huérfanos en TMP_DIR de un worker que murió a mitad de faena
 * (OOM-kill, redeploy). Normalmente el propio código los borra en su
 * `finally`, pero eso NO se ejecuta si el proceso es matado en seco a media
 * descarga/transcodificación. Sin esto, a escala de TB esos restos (pueden
 * ser el original ENTERO de un vídeo de varios GB, ver generarPreviews) se
 * acumulan para siempre y se comen el disco — justo lo que el preflight de
 * espacio está intentando evitar. Umbral: más viejo que el timeout más largo
 * del sistema (ffmpeg interno: 180 min, media.ts; descarga de un original
 * enorme: hasta 6h, ver scaledTimeoutMs) + margen amplio, para no tocar nada
 * que pueda seguir legítimamente en curso.
 */
const TMP_HUERFANO_MS = 7 * 60 * 60 * 1000; // 7h
const TMP_SWEEP_CADA_MS = 30 * 60 * 1000; // no listar el directorio en cada vuelta
let lastTmpSweep = 0;
async function limpiarTemporalesHuerfanos(log: FastifyBaseLoggerLike): Promise<void> {
  if (Date.now() - lastTmpSweep < TMP_SWEEP_CADA_MS) return;
  lastTmpSweep = Date.now();
  const nombres = await readdir(env.TMP_DIR).catch(() => [] as string[]);
  let borrados = 0;
  for (const nombre of nombres) {
    // prefijos usados por tick/storePending/backfillDerivatives/generarPreviews/offloadPosters
    if (!/^(tg|store|bf|prev|off)-/.test(nombre)) continue;
    const ruta = join(env.TMP_DIR, nombre);
    try {
      const st = await stat(ruta);
      if (Date.now() - st.mtimeMs > TMP_HUERFANO_MS) {
        await rm(ruta, { force: true });
        borrados++;
      }
    } catch {
      /* pudo borrarlo el propio proceso justo ahora: no pasa nada */
    }
  }
  if (borrados) log.warn({ borrados }, "limpieza: restos huérfanos de un worker muerto retirados de TMP_DIR");
}

interface FastifyBaseLoggerLike {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
}

/**
 * Barrido de fondo: por cada asset con stored=false, guarda el ORIGINAL en el
 * almacén (reenvío del mensaje del inbox) y marca stored=true. Miniatura/póster
 * ya están en la BD, no hace falta tocarlos aquí.
 *
 * Robustez: contador de fallos persistido. Si tras 6 intentos el mensaje de
 * origen ya no existe (el usuario lo borró de "Mensajes guardados"), el original
 * es irrecuperable → se borra el asset (evita miniaturas rotas eternas).
 * FLOOD_WAIT → pausa. Los errores se ven en /ingest/status.
 */
async function storePending(log: FastifyBaseLoggerLike): Promise<void> {
  // total pendiente (para el diagnóstico) y lote a procesar ESTA vuelta.
  // 1 por vuelta: recuperar = descargar+subir un vídeo, es caro; en lote
  // machacaría Telegram y dispararía FLOOD_WAIT.
  const tot = await one<{ n: string }>(
    "select count(*) n from assets where not stored and deleted_at is null",
  ).catch(() => null);
  ingestState.pending = tot ? Number(tot.n) : 0;

  const pend = await query<{
    id: string;
    kind: "photo" | "video";
    original_key: string;
    filename: string;
    src_msg_id: string | null;
    thumb_ok: boolean;
    bytes: string | null;
  }>(
    `select id, kind, original_key, filename, src_msg_id, (thumb_webp is not null) as thumb_ok, bytes
       from assets where not stored and deleted_at is null order by uploaded_at asc limit 4`,
  );
  if (!pend.rows.length) {
    if (ingestState.lastTickError?.startsWith("guardar ")) ingestState.lastTickError = null;
    return;
  }
  ingestState.lastStep = `guardando originales pendientes (${ingestState.pending})`;

  for (const a of pend.rows) {
    const fkey = `ingest:store_fail:${a.id}`;
    const srcId = Number(a.src_msg_id);
    if (!a.src_msg_id || !Number.isFinite(srcId) || srcId <= 0) {
      await query("delete from kv where k = $1", [fkey]).catch(() => {});
      await retireUnrecoverable(a.id, a.filename, "sin mensaje de origen válido", log);
      continue;
    }
    const n = (await kvNum(fkey)) + 1;
    const bytes = Number(a.bytes) || 0;
    // Por encima del tope real de Telegram (ver env.ts), la recuperación pesada
    // (descargar + volver a SUBIR el original) está condenada: re-subir bajo la
    // MISMA cuenta no puede superar su propio límite. El reenvío (forward) no
    // re-sube nada — es server-side — así que SÍ sigue siendo viable sin límite
    // de tamaño. Para estos archivos nunca escalamos a la vía pesada: solo
    // reintentamos el reenvío (el resto de la lógica de abandono a los 8
    // intentos sigue aplicando igual más abajo).
    const heavyEligible = bytes === 0 || bytes <= TELEGRAM_FILE_CEILING_BYTES;
    let tmp: string | null = null;
    let heavy = false;
    try {
      // 1º el reenvío (instantáneo, server-side). Si falla, se recupera de
      // verdad: descargar el original del inbox y subirlo al almacén.
      if (n <= 2 || !heavyEligible) {
        if (!heavyEligible && n > 2) {
          ingestState.lastStep = `"${a.filename}" (${Math.round(bytes / 1e6)} MB) supera el tope de Telegram para re-subir; solo reenvío`;
        }
        await withTimeout(tgPutByForward(a.original_key, srcId), 18_000, "reenviar original");
      } else {
        // preflight de disco: el original puede pesar varios GB (vídeo de
        // horas en 4K) — mismo criterio que generarPreviews antes de bajarlo
        // entero. Si no cabe, se aplaza SIN contar como intento fallido del
        // archivo (no es su culpa) y se reintenta en cuanto haya hueco.
        if (!(await hasDiskSpaceFor(bytes))) {
          ingestState.lastTickError = `guardar "${a.filename}": sin espacio en disco para ${Math.round(bytes / 1e6)} MB, se aplaza`;
          log.warn({ id: a.id, bytes }, "asset: sin espacio en disco para recuperación pesada, se aplaza");
          continue;
        }
        heavy = true;
        ingestState.lastStep = `recuperando "${a.filename}" (descarga + subida)`;
        await mkdir(env.TMP_DIR, { recursive: true });
        tmp = join(env.TMP_DIR, `store-${a.id}-${randomBytes(4).toString("hex")}`);
        // timeouts que escalan con el tamaño real (bytes): un fijo de 8-9 min
        // bastaba para clips cortos pero cortaba en seco un original de horas
        // a mitad de descarga o de subida. ~1 MB/s de bajada (una sola conexión,
        // igual que en tgDownloadInbox) y ~2 MB/s de subida (tgPut usa varios
        // workers) con margen para reintentos internos.
        const dlTimeout = scaledTimeoutMs(bytes, 8 * 60_000, 1);
        const upTimeout = scaledTimeoutMs(bytes, 8 * 60_000, 2, 2);
        const got = await withTimeout(tgDownloadInbox(srcId, tmp, dlTimeout), dlTimeout + 30_000, "descargar del inbox");
        if (!got) throw new Error("descarga vacía");
        await withTimeout(tgPut(a.original_key, tmp), upTimeout, "subir original");
        if (!a.thumb_ok) {
          await regenerateDerivatives(a.id, a.kind, tmp).catch((e) =>
            log.warn({ id: a.id, err: (e as Error)?.message }, "no se pudo regenerar la miniatura"),
          );
        }
      }
      await query("update assets set stored = true, src_msg_id = null where id = $1", [a.id]);
      await query("delete from kv where k = $1", [fkey]).catch(() => {});
      await withTimeout(tgDeleteInbox([srcId]), 30_000, "borrar del inbox").catch(() => {});
      ingestState.lastTickError = null;
      log.info({ id: a.id, via: heavy ? "descarga+subida" : "forward" }, "asset: original guardado");
      // una recuperación pesada por vuelta: no encadenar descargas grandes
      if (heavy) break;
    } catch (e) {
      const emsg = (e as Error)?.message ?? String(e);
      await kvSet(fkey, n);
      ingestState.lastTickError = `guardar "${a.filename}" (intento ${n}): ${emsg}`;
      log.warn({ id: a.id, intento: n, err: emsg }, "asset: sigue sin guardarse");

      const fw = /flood(?:_wait)?[ _]?(\d+)/i.exec(emsg);
      if (fw || /flood/i.test(emsg)) {
        const secs = fw ? Math.min(3600, Number(fw[1]) + 5) : 900;
        pausedUntil = Date.now() + secs * 1000;
        ingestState.pausedUntil = new Date(pausedUntil).toISOString();
        log.warn({ secs }, "ingesta: FLOOD_WAIT en el barrido, pausa");
        resetTelegram();
        break;
      }

      // ¿el mensaje de origen ya no existe? solo se retira si el inbox
      // RESPONDE y el mensaje no está (un error de red no cuenta).
      if (n >= 3) {
        try {
          const near = await tgInboxNewMedia(Math.max(0, srcId - 1), 5);
          if (!near.some((it) => it.id === srcId)) {
            await query("delete from kv where k = $1", [fkey]).catch(() => {});
            await retireUnrecoverable(a.id, a.filename, "el mensaje de Telegram ya no existe", log);
            continue;
          }
        } catch {
          /* inbox no respondió: no retiramos, se reintenta */
        }
      }
      if (n >= 8) {
        // el mensaje existe pero no hay forma: se retira para no machacar
        // Telegram indefinidamente. El usuario lo reenvía si lo quiere.
        await query("delete from kv where k = $1", [fkey]).catch(() => {});
        await retireUnrecoverable(a.id, a.filename, "no se pudo guardar tras 8 intentos", log);
        continue;
      }
      resetTelegram();
      break;
    } finally {
      if (tmp) await rm(tmp, { force: true }).catch(() => {});
    }
  }
}

async function kvNum(k: string): Promise<number> {
  const r = await one<{ v: string }>("select v from kv where k = $1", [k]).catch(() => null);
  return Number(r?.v) || 0;
}

/**
 * Regenera miniatura/póster de assets viejos que se quedaron con la de reserva
 * (sharp no lee HEIC → el carrete del iPhone salía en negro). Se detectan por
 * poster_jpg NULL. 2 por vuelta. Tras 3 intentos fallidos se deja como está.
 */
async function backfillDerivatives(log: FastifyBaseLoggerLike): Promise<void> {
  type BF = { id: string; kind: "photo" | "video"; original_key: string; filename: string; bytes: string };
  // (a) sin póster (carrete HEIC viejo) o (b) vídeo ingerido por cabecera al que
  // ffprobe no pudo sacarle dimensiones/duración → se completa con el original.
  const rows = (
    await query<BF>(
      `select id, kind, original_key, filename, bytes from assets a
         where deleted_at is null and stored = true and not unrecoverable
           and (
             (poster_jpg is null
              -- ya descargado a Telegram por el barrido de descarga: no es que falte
              and not exists (select 1 from blob_refs br where br.key = a.poster_key))
             or (kind = 'video' and (width is null or duration_s is null)
                 and octet_length(coalesce(poster_jpg, ''::bytea)) > 4)
           )
         order by uploaded_at desc limit 3`,
    ).catch(() => ({ rows: [] as BF[] }))
  ).rows;
  if (!rows.length) return;

  for (const a of rows) {
    const fk = `ingest:bf:${a.id}`;
    const n = (await kvNum(fk)) + 1;
    await kvSet(fk, n); // cuenta el intento YA: si regen no lanza pero tampoco
                        // arregla nada, igual se abandona tras 3 (no bucle infinito)
    ingestState.lastStep = `completando metadatos de un archivo`;
    let tmp: string | null = null;
    // tgEnsureLocal devuelve la ruta de la CACHÉ (no se borra); el temporal de
    // cabecera+cola sí es nuestro y hay que limpiarlo.
    let tmpEsPropio = false;
    try {
      const m = a.original_key.match(/^orig\/(.+)\.[a-z0-9]+$/i);
      const base = m?.[1];
      if (base) {
        await query("update assets set poster_key = coalesce(poster_key, $1) where id = $2", [
          `copy/${base}/poster.jpg`,
          a.id,
        ]);
      }
      // Un vídeo grande NO se baja entero para sacarle 4 datos y un fotograma:
      // con cabecera+cola (14 MB) ffprobe lee el `moov` y ffmpeg el primer
      // frame. De un 4K de 600 MB pasamos a 14 MB.
      const grande = a.kind === "video" && Number(a.bytes) > 24 * 1024 * 1024;
      if (grande) {
        await mkdir(env.TMP_DIR, { recursive: true });
        const ext = a.filename.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? ".mov";
        tmp = join(env.TMP_DIR, `bf-${a.id}-${randomBytes(4).toString("hex")}${ext}`);
        await withTimeout(tgHeadTailTemp(a.original_key, tmp), 120_000, "cabecera+cola");
        tmpEsPropio = true;
      } else {
        tmp = await tgEnsureLocal(a.original_key, 4);
      }
      await regenerateDerivatives(a.id, a.kind, tmp, a.filename);

      // ¿resuelto? foto: basta con tener póster. vídeo: además, dimensiones.
      const now = await one<{ pj: boolean; w: number | null; d: number | null }>(
        "select (octet_length(coalesce(poster_jpg,''::bytea)) > 4) as pj, width as w, duration_s as d from assets where id = $1",
        [a.id],
      );
      const fixed = !!now?.pj && (a.kind !== "video" || (now?.w != null && now?.d != null));
      if (fixed || n >= 3) {
        if (!fixed) await giveUpBackfill(a.id, !!now?.pj);
        await query("delete from kv where k = $1", [fk]).catch(() => {});
      }
      log.info({ id: a.id, fixed, intento: n }, "backfill: procesado");
    } catch (e) {
      log.warn({ id: a.id, intento: n, err: (e as Error)?.message }, "backfill: falló");
      if (n >= 3) {
        const has = await one<{ pj: boolean }>(
          "select (octet_length(coalesce(poster_jpg,''::bytea)) > 4) as pj from assets where id = $1",
          [a.id],
        );
        await giveUpBackfill(a.id, !!has?.pj);
        await query("delete from kv where k = $1", [fk]).catch(() => {});
      }
      break; // no encadenar si algo va mal
    } finally {
      if (tmp && tmpEsPropio) await rm(tmp, { force: true }).catch(() => {});
    }
  }
}

/**
 * Cuántos intentos con fallo REAL (no problemas de disco, que no cuentan)
 * antes de rendirse con la copia ligera de un vídeo. No se marca
 * `unrecoverable`: el original sigue intacto y reproducible, solo que sin
 * copia ligera se verá con tirones si la subida del VPS es lenta.
 *
 * Antes eran 3 intentos SIN espera entre ellos (~1 min de reloj real) — a
 * escala de miles de vídeos largos, un fallo transitorio (red, OOM-kill a
 * mitad de una transcodificación de horas) se confundía sistemáticamente con
 * "este archivo nunca podrá tener copia ligera". Con backoff exponencial
 * (ver `backoffMinutes`) 8 intentos cubren más de 2 días de reintentos
 * espaciados antes de rendirse — tiempo de sobra para que un problema
 * pasajero (disco, red, carga del VPS) se resuelva solo.
 */
const PREVIEW_MAX_ATTEMPTS = Math.max(3, Number(process.env.PREVIEW_MAX_ATTEMPTS) || 8);

/**
 * Un candado `preview_locked_at` más viejo que esto se considera huérfano
 * (el worker murió a mitad de faena: OOM-kill, redeploy) y el vídeo vuelve a
 * la cola solo, sin intervención manual. Bastante por encima del timeout
 * interno de ffmpeg (180 min, media.ts) + margen para la descarga previa del
 * original completo (puede ser de varios GB).
 */
const PREVIEW_LOCK_TIMEOUT_MIN = Math.max(60, Number(process.env.PREVIEW_LOCK_TIMEOUT_MIN) || 240);

/**
 * Cuántos workers de copias de reproducción corren a la vez. CADA uno ya usa
 * varios hilos internamente (media.ts: Math.max(2, cpus-1) para el propio
 * ffmpeg), así que subir esto MULTIPLICA el consumo de CPU/RAM de golpe: en
 * un VPS modesto, 2-3 vídeos 4K largos transcodificando a la vez puede agotar
 * la RAM o dejar a los dos sin avanzar (thrashing). Por defecto 1: el backlog
 * se vacía uno a uno pero de forma ESTABLE, que es lo que importa a escala de
 * miles de archivos. Configurable con PREVIEW_WORKER_CONCURRENCY solo si el
 * VPS tiene CPU/RAM de sobra.
 */
const PREVIEW_WORKER_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.PREVIEW_WORKER_CONCURRENCY) || 1));

/**
 * Espera creciente antes de reintentar un vídeo que falló (minutos), para no
 * martillear un archivo que no va a poder procesarse hasta que cambien las
 * condiciones (disco, red, carga). Mientras espera, el resto del backlog
 * (vídeos más nuevos o que aún no han fallado) sigue avanzando por delante —
 * es la cola la que prioriza sola lo que SÍ puede progresar ahora mismo.
 */
function backoffMinutes(attempt: number): number {
  const escalones = [2, 8, 30, 120, 360, 720, 1440]; // 2min..24h
  return escalones[Math.min(Math.max(attempt, 1) - 1, escalones.length - 1)] ?? 2880; // tope 48h
}

/**
 * Métricas ligeras EN MEMORIA del worker de copias de reproducción, leídas
 * por /v1/diag/storage. Se resetean si el proceso reinicia a propósito: para
 * saber si el sistema va sobrado o ahogado AHORA importa lo reciente, no un
 * histórico acumulado desde siempre.
 */
const previewDurationsMs: number[] = [];
function recordPreviewDuration(ms: number): void {
  previewDurationsMs.push(ms);
  if (previewDurationsMs.length > 20) previewDurationsMs.shift();
}
export function previewWorkerMetrics(): {
  concurrenciaConfigurada: number;
  intentosMaxAntesDeRendirse: number;
  candadoHuerfanoMin: number;
  duracionMediaRecienteMs: number | null;
  muestras: number;
} {
  const avgMs = previewDurationsMs.length
    ? Math.round(previewDurationsMs.reduce((s, x) => s + x, 0) / previewDurationsMs.length)
    : null;
  return {
    concurrenciaConfigurada: PREVIEW_WORKER_CONCURRENCY,
    intentosMaxAntesDeRendirse: PREVIEW_MAX_ATTEMPTS,
    candadoHuerfanoMin: PREVIEW_LOCK_TIMEOUT_MIN,
    duracionMediaRecienteMs: avgMs,
    muestras: previewDurationsMs.length,
  };
}

/**
 * Genera la copia LIGERA de reproducción de los vídeos que no caben por el tubo.
 * El ORIGINAL no se toca: sigue intacto en Telegram y es lo único que se
 * descarga. Esto solo alimenta al reproductor de la app.
 *
 * Reclamo atómico con `for update skip locked`: permite correr varios workers
 * (PREVIEW_WORKER_CONCURRENCY) sin que dos procesen el mismo vídeo a la vez, y
 * de paso libera solo los candados huérfanos de un worker que murió a mitad
 * de faena (ver PREVIEW_LOCK_TIMEOUT_MIN) — autocuración sin cron aparte.
 *
 * Orden: más nuevos primero Y solo los que ya pueden reintentarse
 * (preview_next_attempt_at <= now()) — el backoff de uno que está fallando no
 * bloquea a los demás. Devuelve true si hizo (o intentó) algo.
 */
async function generarPreviews(log: FastifyBaseLoggerLike): Promise<boolean> {
  // Solo vídeos que de verdad no caben por el tubo (~2,3 MB/s):
  //  - bitrate conocido y > 1,4 MB/s, o
  //  - ingerido por cabecera (sin duración) y > 45 MB → casi seguro 4K pesado.
  // Un clip corto y ligero se reproduce bien con el original: no se transcodifica.
  const a = await one<{
    id: string;
    original_key: string;
    filename: string;
    bytes: string;
    preview_state: number;
    duration_s: number | null;
  }>(
    `update assets set preview_locked_at = now()
       where id = (
         select id from assets
           where kind = 'video' and stored = true and deleted_at is null
             and preview_key is null and preview_state >= 0
             and preview_next_attempt_at <= now()
             and (preview_locked_at is null or preview_locked_at < now() - make_interval(mins => ${PREVIEW_LOCK_TIMEOUT_MIN}))
             and (
               (duration_s is not null and duration_s > 0 and bytes::float8 / duration_s > 1400000)
               or ((duration_s is null or duration_s = 0) and bytes > 45 * 1024 * 1024)
             )
           order by uploaded_at desc
           for update skip locked
           limit 1
       )
       returning id, original_key, filename, bytes, preview_state, duration_s`,
  ).catch((e) => {
    log.warn(e, "preview: fallo reclamando trabajo de la cola");
    return null;
  });
  if (!a) {
    // nada que necesite copia: marca como "no hace falta" lo que quede colgado
    await query(
      `update assets set preview_state = -1
         where kind = 'video' and preview_key is null and preview_state >= 0 and deleted_at is null
           and duration_s is not null and duration_s > 0 and bytes::float8 / duration_s <= 1400000`,
    ).catch(() => {});
    return false;
  }

  if (a.preview_state >= PREVIEW_MAX_ATTEMPTS) {
    await query("update assets set preview_state = -1, preview_locked_at = null where id = $1", [a.id]).catch(() => {});
    return true; // se rinde: se seguirá viendo el original (con sus tirones)
  }
  const intento = a.preview_state + 1;
  await query("update assets set preview_state = $2 where id = $1", [a.id, intento]).catch(() => {});
  const startedAt = Date.now();

  const stamp = randomBytes(4).toString("hex");
  const out = join(env.TMP_DIR, `prev-${a.id}-${stamp}.mp4`);
  let unpin: (() => void) | null = null;
  try {
    ingestState.lastStep = `preparando copia de reproducción de "${a.filename}"`;
    log.info({ f: a.filename, mb: Math.round(Number(a.bytes) / 1e6) }, "preview: empieza");
    await mkdir(env.TMP_DIR, { recursive: true });

    // Comprobación de disco ANTES de empezar. Un original de horas puede
    // pesar decenas de GB — mejor fallar rápido y con un aviso claro que
    // quedarse sin espacio a mitad de una descarga/conversión que puede durar
    // horas (dejaría archivos a medias y el contenedor podría venirse abajo).
    // Margen generoso: el original (para poder leerlo entero) + la copia de
    // salida (una fracción del original) + un colchón fijo.
    try {
      const { statfs } = await import("node:fs/promises");
      const fsStat = await statfs(env.TMP_DIR);
      const libres = fsStat.bavail * fsStat.bsize;
      const necesarios = Number(a.bytes) * 1.3 + 1024 * 1024 * 1024;
      if (libres < necesarios) {
        log.warn(
          { f: a.filename, libresMb: Math.round(libres / 1e6), necesariosMb: Math.round(necesarios / 1e6) },
          "preview: sin espacio en disco suficiente, se aplaza",
        );
        // no se cuenta como intento fallido del archivo — es el disco, no él.
        // Aun así se aplaza un rato (no 20s): si el disco sigue lleno en la
        // siguiente vuelta no tiene sentido volver a comprobarlo enseguida, y
        // así el hueco lo ocupa mientras tanto otro vídeo del backlog.
        await query(
          "update assets set preview_state = greatest(0, preview_state - 1), preview_next_attempt_at = now() + interval '5 minutes', preview_locked_at = null where id = $1",
          [a.id],
        ).catch(() => {});
        return true;
      }
    } catch {
      /* si statfs falla (sistema de archivos raro), se sigue e intenta igual */
    }

    // hace falta el original ENTERO: ffmpeg tiene que decodificarlo todo. En
    // un vídeo largo esto pueden ser varios GB — más que TODA la caché — así
    // que se protege de que el limpiador lo expulse mientras se usa (si no,
    // se autoborraba nada más descargarse y cada intento volvía a bajar el
    // original entero desde cero, sin avanzar nunca). 8 conexiones (el máximo)
    // para esta descarga: solo ocurre cuando no hay nadie viendo nada
    // (streamingActivo() en reposo), así que no le quita banda a nadie.
    const src = await tgEnsureLocal(a.original_key, 8);
    unpin = pinCachedFile(src);
    await makePreview(src, out, { durationS: a.duration_s ?? undefined });

    const { size } = await stat(out);
    if (!size) throw new Error("preview vacía");

    const m = a.original_key.match(/^orig\/(.+)\.[a-z0-9]+$/i);
    const key = `prev/${m?.[1] ?? a.id}.mp4`;
    // margen amplio también aquí: la copia de un vídeo de horas puede pesar
    // varios GB, y es preferible tardar a rendirse a mitad de la subida.
    await withTimeout(tgPut(key, out), 60 * 60_000, "subir preview");
    await query(
      "update assets set preview_key = $1, preview_bytes = $2, preview_state = 0, preview_next_attempt_at = now(), preview_locked_at = null, preview_last_error = null where id = $3",
      [key, size, a.id],
    );
    recordPreviewDuration(Date.now() - startedAt);
    log.info(
      { f: a.filename, origMb: Math.round(Number(a.bytes) / 1e6), prevMb: Math.round(size / 1e6) },
      "preview: lista",
    );
  } catch (e) {
    const emsg = (e as Error)?.message ?? String(e);
    log.warn({ f: a.filename, intento, err: emsg }, "preview: falló");
    if (intento >= PREVIEW_MAX_ATTEMPTS) {
      // se rinde YA (no hace falta esperar a la próxima vuelta para detectarlo):
      // se seguirá viendo el original, con sus tirones si pesa mucho.
      await query(
        "update assets set preview_state = -1, preview_locked_at = null, preview_last_error = $2 where id = $1",
        [a.id, emsg.slice(0, 500)],
      ).catch(() => {});
    } else {
      const esperaMin = backoffMinutes(intento);
      await query(
        "update assets set preview_next_attempt_at = now() + make_interval(mins => $2), preview_locked_at = null, preview_last_error = $3 where id = $1",
        [a.id, esperaMin, emsg.slice(0, 500)],
      ).catch(() => {});
      log.info({ f: a.filename, intento, esperaMin }, "preview: reintento con backoff");
    }
  } finally {
    unpin?.();
    await rm(out, { force: true }).catch(() => {});
    // red de seguridad: cualquier camino de salida que no haya limpiado ya el
    // candado (p. ej. un throw antes de llegar al catch de arriba, aunque no
    // debería) lo libera aquí. Idempotente y barato.
    await query("update assets set preview_locked_at = null where id = $1 and preview_locked_at is not null", [
      a.id,
    ]).catch(() => {});
  }
  return true;
}

/**
 * Deja en disco los primeros MB de los vídeos para que abrir uno sea INMEDIATO.
 * Medido antes de esto: entre 1 y 12 s por vídeo, porque cada apertura resolvía
 * el documento en Telegram y bajaba el primer trozo en caliente. Con el arranque
 * en local se sirve en ~20 ms y el resto entra mientras miras.
 *
 * Va de lo más reciente a lo más antiguo (es lo que se abre) y es muy barato:
 * 6 MB por vídeo a 20 MB/s.
 *
 * ARRANQUE EN FRÍO: un deploy borra esta caché (vive en el contenedor). Durante
 * los primeros 6 min tras arrancar se van 10 por vuelta en vez de 4, para que
 * la biblioteca vuelva a abrirse rápido cuanto antes; luego baja el ritmo.
 */
const bootAt = Date.now();
async function precargarArranques(log: FastifyBaseLoggerLike): Promise<number> {
  // Antes esto miraba solo los 60 vídeos más recientes: en una biblioteca de
  // miles de archivos (el objetivo de escala de TB), CUALQUIER vídeo fuera de
  // esa ventana pequeña y arbitraria pagaba siempre el camino "frío" al
  // abrirlo (resolver documento + primer trozo en directo). El presupuesto de
  // disco de la caché de arranques (headsBudgetCount(), ver telegram.ts) YA es
  // el límite real de cuántos caben — dejamos que sea ESE el límite, no un
  // número fijo, para cubrir tantos vídeos como el disco configurado permita.
  const rows = (
    await query<{ original_key: string; filename: string }>(
      `select original_key, filename from assets
         where kind = 'video' and stored = true and deleted_at is null
         order by captured_at desc limit $1`,
      [Math.max(60, Math.min(5000, headsBudgetCount()))],
    ).catch(() => ({ rows: [] as { original_key: string; filename: string }[] }))
  ).rows;

  const cap = Date.now() - bootAt < 6 * 60_000 ? 10 : 4;
  let hechos = 0;
  for (const a of rows) {
    if (streamingActivo()) break; // si estás viendo algo, esto puede esperar
    if (tieneArranque(a.original_key)) continue;
    try {
      ingestState.lastStep = `preparando arranque de "${a.filename}"`;
      if (await tgEnsureHead(a.original_key)) hechos++;
      if (hechos >= cap) break;
    } catch (e) {
      log.warn({ f: a.filename, err: (e as Error)?.message }, "arranque: no se pudo precargar");
      break;
    }
  }
  if (hechos) log.info({ hechos }, "arranques precargados");
  return hechos;
}

/**
 * ESCALA: los pósters (~200 KB cada uno) viven en Postgres para que la galería
 * nunca se quede en blanco. A 100.000 archivos eso son ~20 GB de base de datos,
 * que ninguna Postgres gestionada aguanta barato. Este barrido los va sacando a
 * Telegram (donde el espacio es ilimitado y gratis) y los borra de la BD.
 *
 * Va MUY despacio a propósito (2 por vuelta, solo cuando no hay nada más que
 * hacer): subir miniaturas en bloque a Telegram dispara FLOOD_WAIT.
 * La miniatura pequeña (~25 KB) se queda en la BD como red de seguridad.
 */
async function offloadPosters(log: FastifyBaseLoggerLike): Promise<void> {
  type OF = { id: string; poster_key: string | null };
  const rows = (
    await query<OF>(
      `select id, poster_key from assets a
         where deleted_at is null and stored = true
           and poster_key is not null
           and octet_length(coalesce(poster_jpg, ''::bytea)) > 4
           and not exists (select 1 from blob_refs br where br.key = a.poster_key)
         order by uploaded_at asc limit 6`,
    ).catch(() => ({ rows: [] as OF[] }))
  ).rows;
  if (!rows.length) return;

  let i = 0;
  for (const a of rows) {
    // respiro entre subidas: en reposo Telegram lo tolera de sobra, pero no
    // conviene encadenarlas sin pausa (es lo que disparaba FLOOD_WAIT).
    if (i++) await new Promise((r) => setTimeout(r, 400));
    const fk = `ingest:off:${a.id}`;
    const n = (await kvNum(fk)) + 1;
    if (n > 3) continue; // se rinde: se queda en la BD, no pasa nada grave
    await kvSet(fk, n);
    const tmp = join(env.TMP_DIR, `off-${a.id}-${randomBytes(4).toString("hex")}.jpg`);
    try {
      const r = await one<{ b: Buffer }>("select poster_jpg as b from assets where id = $1", [a.id]);
      if (!r?.b?.length) {
        await query("delete from kv where k = $1", [fk]).catch(() => {});
        continue;
      }
      await mkdir(env.TMP_DIR, { recursive: true });
      await writeFile(tmp, r.b);
      await withTimeout(tgPut(a.poster_key!, tmp), 60_000, "subir póster");
      // ya está en Telegram (blob_refs) → liberar la BD
      await query("update assets set poster_jpg = null where id = $1", [a.id]);
      await query("delete from kv where k = $1", [fk]).catch(() => {});
      log.info({ id: a.id, bytes: r.b.length }, "póster movido a Telegram (BD liberada)");
    } catch (e) {
      const emsg = (e as Error)?.message ?? String(e);
      log.warn({ id: a.id, intento: n, err: emsg }, "no se pudo mover el póster");
      if (/flood/i.test(emsg)) {
        const fw = /flood(?:_wait)?[ _]?(\d+)/i.exec(emsg);
        pausedUntil = Date.now() + (fw ? Math.min(3600, Number(fw[1]) + 5) : 900) * 1000;
        ingestState.pausedUntil = new Date(pausedUntil).toISOString();
      }
      break; // uno malo por vuelta es suficiente
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
    }
  }
}

/**
 * Se abandona el backfill de un asset tras 3 intentos. Para que no vuelva a
 * salir en el barrido:
 *  - si NO tiene póster (p. ej. le falta el índice `moov` — confirmado con
 *    ffmpeg que el archivo llegó así de dañado desde su origen, ningún
 *    reintento arregla eso): se marca `unrecoverable` para no volver a
 *    intentarlo NUNCA, y se le pone una miniatura que lo diga claramente —
 *    antes era un cuadro oscuro indistinguible de "aún cargando".
 *  - si SÍ tiene póster pero le faltan dimensiones (vídeo por cabecera cuyo
 *    original no se pudo bajar): 0 como centinela — la UI lo pinta "—" igual que
 *    null, pero deja de seleccionarse.
 */
async function giveUpBackfill(id: string, hasPoster: boolean): Promise<void> {
  if (!hasPoster) {
    const tmp = join(env.TMP_DIR, `broken-${id}-${randomBytes(4).toString("hex")}.webp`);
    try {
      await mkdir(env.TMP_DIR, { recursive: true });
      await placeholderBroken(tmp);
      const img = await readFile(tmp);
      await query(
        "update assets set thumb_webp = $1, poster_jpg = $1, unrecoverable = true where id = $2",
        [img, id],
      );
    } catch {
      // si ni siquiera esto sale (disco lleno, etc.), al menos que no se
      // vuelva a reintentar — con el cuadro oscuro de siempre es aceptable
      await query(
        "update assets set poster_jpg = decode('', 'hex'), unrecoverable = true where id = $1",
        [id],
      ).catch(() => {});
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
    }
  } else {
    await query(
      "update assets set width = coalesce(width, 0), height = coalesce(height, 0), duration_s = coalesce(duration_s, 0) where id = $1",
      [id],
    ).catch(() => {});
  }
}

async function kvSet(k: string, v: number): Promise<void> {
  await query(
    "insert into kv (k, v, updated_at) values ($1,$2,now()) on conflict (k) do update set v = excluded.v, updated_at = now()",
    [k, String(v)],
  ).catch(() => {});
}

/** El original no se puede recuperar: se retira el asset para no dejar tiles rotas. */
async function retireUnrecoverable(
  id: string,
  filename: string,
  motivo: string,
  log: FastifyBaseLoggerLike,
): Promise<void> {
  await query("update assets set deleted_at = now() where id = $1 and deleted_at is null", [id]);
  ingestState.lastTickError = `"${filename}" retirado: original irrecuperable (${motivo}). Reenvíalo si lo quieres.`;
  log.error({ id, filename, motivo }, "asset retirado: original irrecuperable");
}

export function startInboxIngest(log: FastifyBaseLoggerLike): void {
  if (env.STORAGE_DRIVER !== "telegram") return;
  const fast = Math.max(8, env.INGEST_POLL_SECONDS); // hay actividad reciente
  const slow = Math.max(fast, 45); // inbox vacío: no machacar la cuenta de Telegram
  ingestState.started = true;
  log.info({ inbox: env.TELEGRAM_INBOX, fast, slow, user: env.INGEST_USER_ID ? "fijo" : "por token/caption" }, "ingesta de Telegram activa");

  let idle = 0;
  const loop = async () => {
    await tick(log).catch(() => {});
    // reduce la frecuencia cuando no llega nada nuevo ni hay pendientes de guardar
    const quiet = ingestState.lastSeen === 0 && ingestState.pending === 0 && ingestState.chores === 0;
    idle = quiet ? Math.min(idle + 1, 4) : 0;
    const next = idle >= 3 ? slow : fast;
    setTimeout(() => void loop(), next * 1000);
  };
  setTimeout(() => void loop(), 3000);
  // disparo instantáneo cuando llega algo al inbox (el sondeo queda de respaldo)
  void armInboxListener(() => void tick(log)).catch(() => {});

  startPreviewWorker(log);
}

/**
 * Worker SEPARADO para las copias ligeras de reproducción. Va por su cuenta,
 * a su ritmo, sin bloquear jamás el bucle de ingesta: transcodificar un 4K son
 * varios minutos y no puede frenar las miniaturas ni los arranques.
 *
 * Una copia cada vez. Se aparta si hay alguien reproduciendo (CPU + banda para
 * quien está mirando). Reintenta cada 20 s cuando hay trabajo, cada 5 min si no.
 */
function startPreviewWorker(log: FastifyBaseLoggerLike): void {
  if (env.STORAGE_DRIVER !== "telegram") return;
  log.info({ concurrencia: PREVIEW_WORKER_CONCURRENCY }, "worker de copias de reproducción: arrancando");
  for (let slot = 0; slot < PREVIEW_WORKER_CONCURRENCY; slot++) {
    startPreviewSlot(log, slot);
  }
}

function startPreviewSlot(log: FastifyBaseLoggerLike, slot: number): void {
  let busy = false;
  const loop = async () => {
    let huboTrabajo = false;
    if (!busy && !streamingActivo() && Date.now() >= pausedUntil) {
      busy = true;
      try {
        huboTrabajo = await generarPreviews(log).then(
          () => true,
          (e) => {
            log.warn(e, "worker de copias de reproducción");
            return false;
          },
        );
      } finally {
        busy = false;
      }
    }
    setTimeout(() => void loop(), (huboTrabajo ? 20 : 300) * 1000);
  };
  // arranque escalonado entre slots: evita que, si hay backlog, todos pidan
  // trabajo en el mismo instante justo al arrancar el proceso.
  setTimeout(() => void loop(), 15_000 + slot * 4000);
}

/** Fuerza una vuelta de ingesta ahora (para el endpoint de diagnóstico). */
export async function ingestTickNow(log: FastifyBaseLoggerLike): Promise<void> {
  await tick(log);
}

/**
 * Salta TODO lo que hay ahora en el inbox: pone el puntero por delante del
 * último mensaje. Limpia contadores de fallo y la pausa por FLOOD_WAIT.
 * Se usa cuando un mensaje se atasca; luego reenvías lo que quieras.
 */
export async function ingestSkipPending(log: FastifyBaseLoggerLike): Promise<{ newLastId: number; skipped: number }> {
  pausedUntil = 0;
  ingestState.pausedUntil = null;
  const before = await getLastId();
  let maxId = before;
  try {
    const items = await withTimeout(tgInboxNewMedia(0, 100), 60_000, "listar inbox (skip)");
    for (const it of items) {
      if (it.id > maxId) maxId = it.id;
      await clearFails(it.id);
    }
  } catch (e) {
    log.warn({ err: (e as Error)?.message }, "skip: no se pudo listar el inbox; solo limpio pausa");
  }
  if (maxId > before) await setLastId(maxId);
  ingestState.lastTickError = null;
  log.info({ before, newLastId: maxId }, "ingesta: saltados los pendientes");
  return { newLastId: maxId, skipped: Math.max(0, maxId - before) };
}

/** Quita la pausa por FLOOD_WAIT (para reintentar ya). */
export function ingestResume(): void {
  pausedUntil = 0;
  ingestState.pausedUntil = null;
}

export function ingestSnapshot() {
  return {
    ...ingestState,
    running,
    runningForSeconds: running ? Math.round((Date.now() - runningSince) / 1000) : null,
  };
}
