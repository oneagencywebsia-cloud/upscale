import { createReadStream, existsSync, createWriteStream } from "node:fs";
import { mkdir, stat, rm, readdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { Readable } from "node:stream";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { env } from "./env.js";
import { query, one } from "./db.js";

/**
 * Almacén sobre un canal privado de Telegram. Se sube SIEMPRE como documento
 * (sendFile forceDocument:true) → Telegram guarda los bytes EXACTOS, sin recomprimir.
 * Todo lo que el iPhone metió dentro del archivo (HDR, profundidad, ProRAW, EXIF…)
 * se conserva. Los Live Photos se guardan como dos objetos (HEIC + MOV).
 */

let clientPromise: Promise<TelegramClient> | null = null;

async function getClient(): Promise<TelegramClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const c = new TelegramClient(
          new StringSession(env.TELEGRAM_SESSION!),
          env.TELEGRAM_API_ID!,
          env.TELEGRAM_API_HASH!,
          { connectionRetries: 5, autoReconnect: true },
        );
        c.setLogLevel("error" as never);
        await c.connect();
        return c;
      } catch (e) {
        clientPromise = null; // no dejar cacheado un cliente muerto: el próximo intento reconecta
        throw e;
      }
    })();
  }
  try {
    const c = await clientPromise;
    if (c.connected === false) {
      clientPromise = null;
      channelEntity = null;
      return getClient();
    }
    return c;
  } catch (e) {
    clientPromise = null;
    throw e;
  }
}

let channelEntity: Api.TypeInputPeer | null = null;
async function getChannel(): Promise<Api.TypeInputPeer> {
  if (channelEntity) return channelEntity;
  const c = await getClient();
  const raw = env.TELEGRAM_CHANNEL_ID!;
  const id: string | number = /^-?\d+$/.test(raw) ? raw : raw;
  channelEntity = await c.getInputEntity(id);
  return channelEntity;
}

// ------------------------------- caché en disco -------------------------------

const CACHE_INLINE_LIMIT = 50 * 1024 * 1024; // solo cacheamos archivos pequeños

function cachePath(key: string): string {
  return join(env.TG_CACHE_DIR, createHash("sha1").update(key).digest("hex"));
}

async function pruneCache(): Promise<void> {
  try {
    const dir = env.TG_CACHE_DIR;
    const files = await readdir(dir);
    const stats = await Promise.all(
      files.map(async (f) => {
        const p = join(dir, f);
        const s = await stat(p).catch(() => null);
        return s ? { p, size: s.size, at: s.mtimeMs } : null;
      }),
    );
    const list = stats.filter(Boolean) as { p: string; size: number; at: number }[];
    let total = list.reduce((n, x) => n + x.size, 0);
    const max = env.TG_CACHE_MAX_MB * 1024 * 1024;
    if (total <= max) return;
    list.sort((a, b) => a.at - b.at); // más antiguos primero
    for (const x of list) {
      if (total <= max) break;
      await rm(x.p, { force: true });
      total -= x.size;
    }
  } catch {
    /* ignore */
  }
}

// ------------------------------- API pública -------------------------------

export async function ensureTelegram(): Promise<void> {
  await mkdir(env.TG_CACHE_DIR, { recursive: true });
  await getClient(); // conecta y valida la sesión al arrancar
}

/** Sube el archivo como documento (bytes exactos) y registra key -> message_id. */
export async function tgPut(key: string, filePath: string): Promise<void> {
  const c = await getClient();
  const channel = await getChannel();
  const { size } = await stat(filePath);
  const msg = await c.sendFile(channel, {
    file: filePath,
    forceDocument: true,
    caption: key,
    workers: 4,
  });
  const messageId = Number((msg as Api.Message).id);
  await query(
    `insert into blob_refs (key, tg_message_id, bytes) values ($1,$2,$3)
     on conflict (key) do update set tg_message_id = excluded.tg_message_id, bytes = excluded.bytes`,
    [key, messageId, size],
  );

  // si es pequeño, lo dejamos ya en caché para no volver a bajarlo
  if (size <= CACHE_INLINE_LIMIT) {
    await mkdir(env.TG_CACHE_DIR, { recursive: true });
    await pipe(createReadStream(filePath), createWriteStream(cachePath(key))).catch(() => {});
  }
}

async function pipe(rs: NodeJS.ReadableStream, ws: NodeJS.WritableStream): Promise<void> {
  const { pipeline } = await import("node:stream/promises");
  await pipeline(rs, ws);
}

export async function tgDelete(key: string): Promise<void> {
  const row = await one<{ tg_message_id: string }>("select tg_message_id from blob_refs where key = $1", [key]);
  if (row) {
    const c = await getClient();
    const channel = await getChannel();
    await c.deleteMessages(channel, [Number(row.tg_message_id)], { revoke: true }).catch(() => {});
  }
  await query("delete from blob_refs where key = $1", [key]).catch(() => {});
  await rm(cachePath(key), { force: true }).catch(() => {});
}

/** Devuelve un stream de lectura del objeto (de la caché o descargándolo de Telegram). */
export async function tgRead(key: string): Promise<{ stream: Readable; size: number }> {
  const cp = cachePath(key);
  if (existsSync(cp)) {
    const s = await stat(cp);
    await utimes(cp, new Date(), new Date()).catch(() => {}); // LRU touch
    return { stream: createReadStream(cp), size: s.size };
  }

  const row = await one<{ tg_message_id: string; bytes: string }>(
    "select tg_message_id, bytes from blob_refs where key = $1",
    [key],
  );
  if (!row) throw new Error("blob no registrado");

  const c = await getClient();
  const channel = await getChannel();
  const [msg] = await c.getMessages(channel, { ids: [Number(row.tg_message_id)] });
  if (!msg || !msg.media) throw new Error("mensaje no encontrado en Telegram");

  const size = Number(row.bytes);
  await mkdir(env.TG_CACHE_DIR, { recursive: true });
  // sufijo único: dos descargas simultáneas de la misma key no pueden pisarse el archivo
  const tmp = `${cp}.${randomBytes(6).toString("hex")}.dl`;
  await c.downloadMedia(msg, { outputFile: tmp });

  if (size <= CACHE_INLINE_LIMIT) {
    await rm(cp, { force: true }).catch(() => {});
    await (await import("node:fs/promises")).rename(tmp, cp);
    pruneCache();
    return { stream: createReadStream(cp), size };
  }
  // grande: servimos y borramos, no lo dejamos en caché
  const stream = createReadStream(tmp);
  stream.on("close", () => void rm(tmp, { force: true }));
  return { stream, size };
}
