import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { env } from "./env.js";
import { query, one } from "./db.js";
import { ingestLocalFile, regenerateDerivatives } from "./pipeline.js";
import {
  tgInboxNewMedia,
  tgInboxStartId,
  tgDownloadInbox,
  tgDeleteInbox,
  resetTelegram,
  armInboxListener,
  tgPutByForward,
  tgPut,
} from "./telegram.js";

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
        ingestState.lastStep = `descargando msg ${it.id} (${Math.round(it.bytes / 1e6)} MB)`;
        log.info({ id: it.id, filename: it.filename, bytes: it.bytes, userId }, "ingesta: descargando de Telegram");
        const dl = await withTimeout(tgDownloadInbox(it.id, tmp), 11 * 60_000, "descargar de Telegram");
        const t1 = Date.now();
        log.info({ id: it.id, bytes: dl, downloadMs: t1 - t0 }, "ingesta: descargado, procesando");
        ingestState.lastStep = `procesando msg ${it.id}`;
        const res = await withTimeout(
          ingestLocalFile({
            userId,
            filePath: tmp,
            filename: it.filename,
            contentType: it.mime,
            capturedAtHint: new Date(it.date * 1000).toISOString(),
            forwardFromInboxMsgId: it.id,
            deferStore: true, // la fila se crea YA; el original se guarda en el barrido de fondo
            onStep: (s) => { ingestState.lastStep = `msg ${it.id}: ${s}`; },
            log,
          }),
          4 * 60_000,
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

    // barrido: guarda en el almacén los originales de las filas ya creadas
    await storePending(log);
  } catch (e) {
    ingestState.lastTickError = (e as Error)?.message ?? String(e);
    log.error({ err: (e as Error)?.message }, "ingesta: fallo en la vuelta");
  } finally {
    running = false;
    ingestState.running = false;
    ingestState.lastStep = "en reposo";
    void armInboxListener().catch(() => {}); // re-arma el disparo instantáneo si hubo reconexión
  }
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
  }>(
    `select id, kind, original_key, filename, src_msg_id, (thumb_webp is not null) as thumb_ok
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
    let tmp: string | null = null;
    let heavy = false;
    try {
      // 1º el reenvío (instantáneo, server-side). Si falla, se recupera de
      // verdad: descargar el original del inbox y subirlo al almacén.
      if (n <= 2) {
        await withTimeout(tgPutByForward(a.original_key, srcId), 18_000, "reenviar original");
      } else {
        heavy = true;
        ingestState.lastStep = `recuperando "${a.filename}" (descarga + subida)`;
        await mkdir(env.TMP_DIR, { recursive: true });
        tmp = join(env.TMP_DIR, `store-${a.id}-${randomBytes(4).toString("hex")}`);
        const got = await withTimeout(tgDownloadInbox(srcId, tmp, 8 * 60_000), 9 * 60_000, "descargar del inbox");
        if (!got) throw new Error("descarga vacía");
        await withTimeout(tgPut(a.original_key, tmp), 8 * 60_000, "subir original");
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
    const quiet = ingestState.lastSeen === 0 && ingestState.pending === 0;
    idle = quiet ? Math.min(idle + 1, 4) : 0;
    const next = idle >= 3 ? slow : fast;
    setTimeout(() => void loop(), next * 1000);
  };
  setTimeout(() => void loop(), 3000);
  // disparo instantáneo cuando llega algo al inbox (el sondeo queda de respaldo)
  void armInboxListener(() => void tick(log)).catch(() => {});
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
