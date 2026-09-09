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
export function resetTelegram(): void {
  const dying = clientPromise;
  clientPromise = null;
  channelEntity = null;
  dying?.then((c) => c.disconnect().catch(() => {})).catch(() => {});
}

function raceTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_r, rej) => {
      t = setTimeout(() => rej(new Error(`timeout ${Math.round(ms / 1000)}s: ${label}`)), ms);
    }),
  ]).finally(() => clearTimeout(t!)) as Promise<T>;
}

async function getClient(): Promise<TelegramClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const c = new TelegramClient(
          new StringSession(env.TELEGRAM_SESSION!),
          env.TELEGRAM_API_ID!,
          env.TELEGRAM_API_HASH!,
          {
            connectionRetries: 3,
            requestRetries: 3,
            timeout: 20, // seg. por respuesta
            floodSleepThreshold: 60,
            autoReconnect: true,
          },
        );
        c.setLogLevel("error" as never);
        await raceTimeout(c.connect(), 25_000, "connect");
        return c;
      } catch (e) {
        clientPromise = null; // no dejar cacheado un cliente muerto: el próximo intento reconecta
        throw e;
      }
    })();
  }
  try {
    const c = await raceTimeout(clientPromise, 30_000, "obtener cliente");
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

/**
 * Punto de partida al arrancar: id anterior al mensaje multimedia más antiguo de
 * los últimos `withinMinutes` minutos (para recoger lo enviado justo antes de
 * desplegar), o el último id si no hay nada reciente.
 */
export async function tgInboxStartId(withinMinutes = 30): Promise<number> {
  const c = await getClient();
  const msgs = await c.getMessages(env.TELEGRAM_INBOX, { limit: 15 });
  if (!msgs.length) return 0;
  const cutoff = Math.floor(Date.now() / 1000) - withinMinutes * 60;
  let latest = 0;
  let oldestRecentMedia = Number.MAX_SAFE_INTEGER;
  for (const m of msgs) {
    if (!m || typeof m.id !== "number") continue;
    if (m.id > latest) latest = m.id;
    const doc = m.document as Api.Document | undefined;
    if (doc && Number(m.date) >= cutoff && m.id < oldestRecentMedia) oldestRecentMedia = m.id;
  }
  return oldestRecentMedia !== Number.MAX_SAFE_INTEGER ? oldestRecentMedia - 1 : latest;
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

/**
 * Descarga el archivo del mensaje `id` del inbox a `outPath` por trozos
 * (iterDownload → control total, deadline global y detección de estancamiento).
 * Si iterDownload falla de entrada, cae a downloadMedia. Devuelve bytes escritos.
 */
export async function tgDownloadInbox(id: number, outPath: string, deadlineMs = 10 * 60_000): Promise<number> {
  const c = await getClient();
  const [msg] = await raceTimeout(c.getMessages(env.TELEGRAM_INBOX, { ids: [id] }), 30_000, `getMessages ${id}`);
  const doc = msg?.document as Api.Document | undefined;
  if (!doc || !msg?.media) throw new Error(`mensaje ${id} sin documento (¿enviado como vídeo y no como archivo?)`);

  const total = Number(doc.size) || 0;
  const deadline = Date.now() + deadlineMs;

  // 1) intento por trozos (abort limpio)
  try {
    const location = new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: "",
    });
    const ws = createWriteStream(outPath);
    let written = 0;
    let lastAt = Date.now();
    try {
      const iterOpts: Parameters<typeof c.iterDownload>[0] = { file: location, dcId: doc.dcId, requestSize: 512 * 1024 };
      if (total) iterOpts.fileSize = bigInt(total);
      for await (const chunk of c.iterDownload(iterOpts)) {
        const now = Date.now();
        if (now > deadline) throw new Error(`descarga > ${Math.round(deadlineMs / 1000)}s (msg ${id})`);
        if (now - lastAt > 120_000) throw new Error(`sin datos de Telegram 120s (msg ${id})`);
        lastAt = now;
        const buf = Buffer.from(chunk as Uint8Array);
        await new Promise<void>((res, rej) => ws.write(buf, (e) => (e ? rej(e) : res())));
        written += buf.length;
      }
    } finally {
      await new Promise<void>((res) => ws.end(() => res()));
    }
    if (written > 0 && (!total || written >= total)) return written;
    throw new Error(`iterDownload incompleto: ${written}/${total}`);
  } catch (e) {
    console.error("[tg] iterDownload falló, pruebo downloadMedia:", (e as Error).message);
  }

  // 2) fallback: downloadMedia con timeout
  await rm(outPath, { force: true }).catch(() => {});
  await raceTimeout(
    c.downloadMedia(msg, { outputFile: outPath }) as Promise<unknown>,
    Math.max(30_000, deadline - Date.now()),
    `downloadMedia ${id}`,
  );
  const { size } = await stat(outPath);
  if (total && size < total) throw new Error(`descarga incompleta: ${size}/${total} bytes (msg ${id})`);
  return size;
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
