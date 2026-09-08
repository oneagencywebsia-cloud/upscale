import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { env } from "./env.js";
import { query, one } from "./db.js";
import { ingestLocalFile } from "./pipeline.js";
import { tgInboxNewMedia, tgInboxLatestId, tgDownloadInbox, tgDeleteInbox } from "./telegram.js";

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
  // 3) instancia de un solo usuario: el único que ya tiene biblioteca
  const distinct = await query<{ user_id: string }>("select distinct user_id from assets limit 2");
  if (distinct.rows.length === 1) return distinct.rows[0]!.user_id;
  return null;
}

async function tick(log: FastifyBaseLoggerLike): Promise<void> {
  if (running) return;
  running = true;
  try {
    // primer arranque: fijamos el punto de partida en el último mensaje actual
    // para NO procesar el histórico de Mensajes guardados, solo lo que llegue nuevo.
    const inited = await one<{ v: string }>("select v from kv where k = 'ingest:inited'");
    if (!inited) {
      const latest = await tgInboxLatestId();
      await setLastId(latest);
      await query("insert into kv (k, v) values ('ingest:inited', '1') on conflict (k) do nothing");
      log.info({ lastId: latest }, "ingesta: punto de partida fijado (solo mensajes nuevos)");
      return;
    }

    const lastId = await getLastId();
    const items = await tgInboxNewMedia(lastId);
    if (!items.length) return;

    await mkdir(env.TMP_DIR, { recursive: true });
    for (const it of items) {
      const userId = await resolveUser(it.caption);
      if (!userId) {
        log.warn({ id: it.id }, "ingesta: sin INGEST_USER_ID ni token en el caption, se ignora");
        await setLastId(it.id); // no reintentar en bucle
        continue;
      }
      const tmp = join(env.TMP_DIR, `tg-${it.id}-${randomBytes(4).toString("hex")}${it.filename.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? ""}`);
      try {
        log.info({ id: it.id, filename: it.filename, bytes: it.bytes, userId }, "ingesta: descargando de Telegram");
        await tgDownloadInbox(it.id, tmp);
        const res = await ingestLocalFile({
          userId,
          filePath: tmp,
          filename: it.filename,
          contentType: it.mime,
          capturedAtHint: new Date(it.date * 1000).toISOString(),
          log,
        });
        log.info({ id: it.id, assetId: res.id, status: res.status, kind: res.kind, bytes: res.bytes }, "ingesta: guardado");
        await tgDeleteInbox([it.id]);
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => {});
        log.error({ id: it.id, err: (e as Error)?.message }, "ingesta: fallo con un mensaje");
        // no borramos el mensaje: se reintenta en la próxima vuelta
      }
      await setLastId(it.id);
    }
  } catch (e) {
    log.error({ err: (e as Error)?.message }, "ingesta: fallo en la vuelta");
  } finally {
    running = false;
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
  log.info({ inbox: env.TELEGRAM_INBOX, everySeconds: secs, user: env.INGEST_USER_ID ? "fijo" : "por token/caption" }, "ingesta de Telegram activa");
  setTimeout(() => void tick(log), 5000);
  setInterval(() => void tick(log), secs * 1000);
}
