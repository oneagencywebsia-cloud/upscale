import { createReadStream, existsSync, createWriteStream } from "node:fs";
import { mkdir, stat, rm, readdir, utimes, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import bigInt from "big-integer";
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
let channelEntity: Api.TypeInputPeer | null = null;

/** Descarta el cliente y el canal cacheados: la siguiente llamada reconecta de cero. */
function resetTelegram(): void {
  const dying = clientPromise;
  clientPromise = null;
  channelEntity = null;
  dying?.then((c) => c.disconnect().catch(() => {})).catch(() => {});
}

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

async function getChannel(): Promise<Api.TypeInputPeer> {
  if (channelEntity) return channelEntity;
  const c = await getClient();
  channelEntity = await c.getInputEntity(env.TELEGRAM_CHANNEL_ID!);
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

// ------------------------------- ingesta (inbox) -------------------------------

export interface InboxItem {
  id: number;
  filename: string;
  mime: string;
  caption: string | null;
  date: number; // epoch segundos
  bytes: number;
}

const MEDIA_EXT = /\.(mov|mp4|m4v|hevc|3gp|avi|mkv|webm|heic|heif|jpg|jpeg|png|webp|gif|tiff|dng|avif)$/i;

/** id del último mensaje del inbox (para arrancar sin procesar el histórico). */
export async function tgInboxLatestId(): Promise<number> {
  const c = await getClient();
  const [m] = await c.getMessages(env.TELEGRAM_INBOX, { limit: 1 });
  return m && typeof m.id === "number" ? m.id : 0;
}

/** Mensajes con archivo multimedia del inbox, id > sinceId, del más antiguo al más nuevo. */
export async function tgInboxNewMedia(sinceId: number, limit = 20): Promise<InboxItem[]> {
  const c = await getClient();
  const msgs = await c.getMessages(env.TELEGRAM_INBOX, { limit, minId: sinceId });
  const out: InboxItem[] = [];
  for (const m of msgs) {
    if (!m || typeof m.id !== "number" || m.id <= sinceId) continue;
    const doc = m.document as Api.Document | undefined;
    if (!doc) continue; // solo archivos ("enviar como archivo"), no fotos comprimidas
    const nameAttr = doc.attributes?.find(
      (a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename,
    );
    const filename = nameAttr?.fileName || `TG_${m.id}`;
    const mime = doc.mimeType || "application/octet-stream";
    // solo fotos/vídeos; cualquier otro documento (PDF, zip…) se ignora y NO se toca
    if (!mime.startsWith("image/") && !mime.startsWith("video/") && !MEDIA_EXT.test(filename)) continue;
    out.push({
      id: m.id,
      filename,
      mime,
      caption: (m.message as string) || null,
      date: Number(m.date) || Math.floor(Date.now() / 1000),
      bytes: Number(doc.size) || 0,
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Descarga el archivo del mensaje `id` del inbox a `outPath`. */
export async function tgDownloadInbox(id: number, outPath: string): Promise<void> {
  const c = await getClient();
  const [msg] = await c.getMessages(env.TELEGRAM_INBOX, { ids: [id] });
  if (!msg || !msg.media) throw new Error(`mensaje ${id} sin media`);
  await c.downloadMedia(msg, { outputFile: outPath });
}

/** Borra mensajes del inbox (ya procesados). */
export async function tgDeleteInbox(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const c = await getClient();
  await c.deleteMessages(env.TELEGRAM_INBOX, ids, { revoke: true }).catch(() => {});
}

/** Sube el archivo como documento (bytes exactos) y registra key -> message_id. */
export async function tgPut(key: string, filePath: string): Promise<void> {
  const channel = await getChannel();
  const { size } = await stat(filePath);
  // más "workers" = más trozos en paralelo = subida más rápida en archivos grandes
  const workers = size > 8 * 1024 * 1024 ? 20 : 4;

  let msg: unknown;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const c = await getClient();
      msg = await c.sendFile(channel, { file: filePath, forceDocument: true, caption: key, workers });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      // fuerza reconexión limpia antes de reintentar
      resetTelegram();
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  if (lastErr || !msg) throw lastErr ?? new Error("sendFile no devolvió mensaje");

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

/** Tamaño en bytes registrado para una key (sin tocar Telegram). */
export async function tgSize(key: string): Promise<number> {
  const row = await one<{ bytes: string }>("select bytes from blob_refs where key = $1", [key]);
  if (!row) throw new Error("blob no registrado");
  return Number(row.bytes);
}

let downloading: Map<string, Promise<void>> | null = null;

/** Descarga la key entera a la caché de disco (una sola vez aunque llamen en paralelo). */
async function ensureCached(key: string): Promise<string> {
  const cp = cachePath(key);
  if (existsSync(cp)) {
    await utimes(cp, new Date(), new Date()).catch(() => {}); // LRU touch
    return cp;
  }
  downloading ??= new Map();
  let job = downloading.get(key);
  if (!job) {
    job = (async () => {
      const row = await one<{ tg_message_id: string }>(
        "select tg_message_id from blob_refs where key = $1",
        [key],
      );
      if (!row) throw new Error("blob no registrado");
      const c = await getClient();
      const channel = await getChannel();
      const [msg] = await c.getMessages(channel, { ids: [Number(row.tg_message_id)] });
      if (!msg || !msg.media) throw new Error("mensaje no encontrado en Telegram");
      await mkdir(env.TG_CACHE_DIR, { recursive: true });
      const tmp = `${cp}.${randomBytes(6).toString("hex")}.dl`;
      await c.downloadMedia(msg, { outputFile: tmp });
      await rm(cp, { force: true }).catch(() => {});
      await rename(tmp, cp);
      pruneCache();
    })();
    downloading.set(key, job);
  }
  try {
    await job;
  } finally {
    downloading.delete(key);
  }
  return cp;
}

/**
 * Descarga SOLO el rango pedido directamente de Telegram (sin bajar el archivo
 * entero). Así un vídeo empieza a reproducirse en cuanto llega el primer trozo.
 */
// Cache corta de la localización del documento: durante la reproducción de un
// vídeo el navegador pide decenas de rangos; sin esto haríamos un getMessages
// (ida y vuelta a Telegram) por cada rango.
const docCache = new Map<string, { loc: Api.InputDocumentFileLocation; total: number; at: number }>();
const DOC_TTL = 90_000; // el fileReference caduca; 90 s va sobrado para un vídeo

async function docLocation(
  key: string,
): Promise<{ loc: Api.InputDocumentFileLocation; total: number }> {
  const hit = docCache.get(key);
  if (hit && Date.now() - hit.at < DOC_TTL) return { loc: hit.loc, total: hit.total };

  const row = await one<{ tg_message_id: string; bytes: string }>(
    "select tg_message_id, bytes from blob_refs where key = $1",
    [key],
  );
  if (!row) throw new Error("blob no registrado");
  const total = Number(row.bytes);

  const c = await getClient();
  const channel = await getChannel();
  const [msg] = await c.getMessages(channel, { ids: [Number(row.tg_message_id)] });
  const doc = msg?.document as Api.Document | undefined;
  if (!doc) throw new Error("mensaje sin documento");

  const loc = new Api.InputDocumentFileLocation({
    id: doc.id,
    accessHash: doc.accessHash,
    fileReference: doc.fileReference,
    thumbSize: "",
  });
  docCache.set(key, { loc, total, at: Date.now() });
  if (docCache.size > 50) docCache.delete(docCache.keys().next().value!);
  return { loc, total };
}

async function tgReadRangeLive(
  key: string,
  start: number,
  end: number,
): Promise<{ stream: Readable; totalSize: number }> {
  const c = await getClient();
  const { loc: location, total } = await docLocation(key);

  const CHUNK = 512 * 1024; // requestSize: múltiplo de 4096, máx 512 KB
  const alignedStart = Math.floor(start / CHUNK) * CHUNK;
  const skip = start - alignedStart;
  const wantLen = end - start + 1;

  const iter = c.iterDownload({
    file: location,
    offset: bigInt(alignedStart),
    limit: wantLen + skip,
    requestSize: CHUNK,
  });

  async function* gen(): AsyncGenerator<Buffer> {
    let dropped = 0;
    let emitted = 0;
    for await (const chunk of iter) {
      let buf = Buffer.from(chunk as Uint8Array);
      if (dropped < skip) {
        const d = Math.min(skip - dropped, buf.length);
        dropped += d;
        buf = buf.subarray(d);
      }
      if (!buf.length) continue;
      const remaining = wantLen - emitted;
      if (buf.length > remaining) buf = buf.subarray(0, remaining);
      emitted += buf.length;
      yield buf;
      if (emitted >= wantLen) return;
    }
  }

  return { stream: Readable.from(gen()), totalSize: total };
}

/** Stream de lectura del objeto. Con `range` intenta servir en directo desde Telegram. */
export async function tgRead(
  key: string,
  range?: { start: number; end: number },
): Promise<{ stream: Readable; size: number; totalSize: number }> {
  const cp = cachePath(key);

  // ya cacheado: servir del disco (rápido y con seek instantáneo)
  if (existsSync(cp)) {
    await utimes(cp, new Date(), new Date()).catch(() => {});
    const { size } = await stat(cp);
    if (range) {
      return {
        stream: createReadStream(cp, { start: range.start, end: range.end }),
        size: range.end - range.start + 1,
        totalSize: size,
      };
    }
    return { stream: createReadStream(cp), size, totalSize: size };
  }

  // rango + no cacheado: streaming en directo desde Telegram (arranca al instante)
  if (range) {
    try {
      const { stream, totalSize } = await tgReadRangeLive(key, range.start, range.end);
      return { stream, size: range.end - range.start + 1, totalSize };
    } catch (e) {
      docCache.delete(key); // por si el fileReference caducó
      // si el streaming directo falla, caemos a descargar entero y servir el rango
      console.error("[tg] streaming directo falló, uso caché completa:", (e as Error).message);
    }
  }

  const full = await ensureCached(key);
  const { size } = await stat(full);
  if (range) {
    return {
      stream: createReadStream(full, { start: range.start, end: range.end }),
      size: range.end - range.start + 1,
      totalSize: size,
    };
  }
  return { stream: createReadStream(full), size, totalSize: size };
}
