import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { env } from "./env.js";
import { query, one } from "./db.js";
import { ingestLocalFile } from "./pipeline.js";
import { tgInboxNewMedia, tgInboxStartId, tgDownloadInbox, tgDeleteInbox, resetTelegram } from "./telegram.js";

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
const attempts = new Map<number, number>(); // id -> nº de intentos fallidos

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
  // 2) configurado a mano
  if (env.INGEST_USER_ID) return env.INGEST_USER_ID;
  // 3) el usuario con más biblioteca (ignora cuentas de prueba vacías)
  const top = await one<{ user_id: string }>(
    "select user_id from assets where deleted_at is null group by user_id order by count(*) desc limit 1",
  );
  if (top) return top.user_id;
  // 4) si aún no hay assets, el usuario más reciente con token de subida
  const tk = await one<{ user_id: string }>(
    "select user_id from upload_tokens order by created_at desc limit 1",
  );
  return tk?.user_id ?? null;
}

async function tick(log: FastifyBaseLoggerLike): Promise<void> {
  // watchdog: si una vuelta lleva colgada > 12 min, la damos por muerta y reconectamos
  if (running && Date.now() - runningSince > 12 * 60_000) {
    log.error({ colgadaDesde: new Date(runningSince).toISOString(), enPaso: ingestState.lastStep }, "ingesta: vuelta colgada, reseteo forzado");
    running = false;
    resetTelegram();
  }
  if (running) return;
  running = true;
  runningSince = Date.now();
  ingestState.running = true;
  ingestState.lastTickAt = new Date().toISOString();
  ingestState.lastTickError = null;
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
        ingestState.lastStep = `descargando msg ${it.id} (${Math.round(it.bytes / 1e6)} MB)`;
        log.info({ id: it.id, filename: it.filename, bytes: it.bytes, userId }, "ingesta: descargando de Telegram");
        await tgDownloadInbox(it.id, tmp);
        ingestState.lastStep = `procesando msg ${it.id}`;
        const res = await withTimeout(
          ingestLocalFile({
            userId,
            filePath: tmp,
            filename: it.filename,
            contentType: it.mime,
            capturedAtHint: new Date(it.date * 1000).toISOString(),
            log,
          }),
          9 * 60_000,
          "guardar en el almacén",
        );
        log.info({ id: it.id, assetId: res.id, status: res.status, kind: res.kind, bytes: res.bytes }, "ingesta: guardado");
        ingestState.lastImported = { id: it.id, assetId: res.id, at: new Date().toISOString() };
        ingestState.totalImported++;
        await tgDeleteInbox([it.id]).catch(() => {});
        await setLastId(it.id);
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => {});
        const n = (attempts.get(it.id) ?? 0) + 1;
        attempts.set(it.id, n);
        ingestState.lastTickError = `msg ${it.id} (intento ${n}): ${(e as Error)?.message}`;
        log.error({ id: it.id, intento: n, err: (e as Error)?.message }, "ingesta: fallo con un mensaje");
        resetTelegram(); // por si la conexión está medio muerta
        if (n >= 3) {
          log.error({ id: it.id }, "ingesta: 3 fallos, se descarta este mensaje (bórralo de Mensajes guardados)");
          attempts.delete(it.id);
          await setLastId(it.id); // pasamos al siguiente
          continue;
        }
        break; // reintentamos este mismo en la próxima vuelta
      }
    }
  } catch (e) {
    ingestState.lastTickError = (e as Error)?.message ?? String(e);
    log.error({ err: (e as Error)?.message }, "ingesta: fallo en la vuelta");
  } finally {
    running = false;
    ingestState.running = false;
    ingestState.lastStep = "en reposo";
  }
}

interface FastifyBaseLoggerLike {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
}

export function startInboxIngest(log: FastifyBaseLoggerLike): void {
  if (env.STORAGE_DRIVER !== "telegram") return;
  const secs = Math.max(10, env.INGEST_POLL_SECONDS);
  ingestState.started = true;
  log.info({ inbox: env.TELEGRAM_INBOX, everySeconds: secs, user: env.INGEST_USER_ID ? "fijo" : "por token/caption" }, "ingesta de Telegram activa");
  setTimeout(() => void tick(log), 5000);
  setInterval(() => void tick(log), secs * 1000);
}

/** Fuerza una vuelta de ingesta ahora (para el endpoint de diagnóstico). */
export async function ingestTickNow(log: FastifyBaseLoggerLike): Promise<void> {
  await tick(log);
}

export function ingestSnapshot() {
  return {
    ...ingestState,
    running,
    runningForSeconds: running ? Math.round((Date.now() - runningSince) / 1000) : null,
  };
}
