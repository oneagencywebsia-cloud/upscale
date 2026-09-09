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
let inboxCb: (() => void) | null = null;
let armedOn: TelegramClient | null = null;

/** Descarta el cliente y el canal cacheados: la siguiente llamada reconecta de cero. */
export function resetTelegram(): void {
  const dying = clientPromise;
  clientPromise = null;
  channelEntity = null;
  armedOn = null; // el listener del inbox se re-arma al reconectar
  dying?.then((c) => c.disconnect().catch(() => {})).catch(() => {});
}

/**
 * Dispara `cb` en cuanto llega un archivo al inbox (sin esperar al sondeo).
 * Idempotente y se re-arma solo tras cada reconexión. Si falla, no pasa nada:
 * el sondeo de respaldo lo recoge igual.
 */
export async function armInboxListener(cb?: () => void): Promise<void> {
  if (cb) inboxCb = cb;
  if (!inboxCb) return;
  const c = await getClient();
  if (armedOn === c) return;
  try {
    const { NewMessage } = await import("telegram/events/index.js");
    // sin filtro de chat ("me" no siempre resuelve en el filtro): despertamos ante
    // cualquier mensaje con documento y que tick() decida si es del inbox. El
    // rebote de 1,5 s + el guard de tick hacen que una llamada de más sea barata.
    let kick: NodeJS.Timeout | null = null;
    c.addEventHandler(
      (ev: { message?: { document?: unknown } }) => {
        if (!ev?.message?.document || kick) return;
        kick = setTimeout(() => {
          kick = null;
          inboxCb?.();
        }, 1500);
      },
      new NewMessage({}),
    );
    armedOn = c;
  } catch {
    /* sin eventos: queda el sondeo */
  }
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
            requestRetries: 2,
            timeout: 20, // seg. por respuesta
            // si Telegram pide esperar > 20s (FLOOD_WAIT), que lance error en vez
            // de dormir en silencio minutos; lo gestionamos nosotros (plan B: subir)
            floodSleepThreshold: 20,
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
 * (iterDownload → deadline global + corte si Telegram deja de enviar).
 * Si falla, cae a downloadMedia. Devuelve bytes escritos.
 */
export async function tgDownloadInbox(id: number, outPath: string, deadlineMs = 8 * 60_000): Promise<number> {
  const c = await getClient();
  const [msg] = await raceTimeout(c.getMessages(env.TELEGRAM_INBOX, { ids: [id] }), 30_000, `getMessages ${id}`);
  const doc = msg?.document as Api.Document | undefined;
  if (!doc || !msg?.media) throw new Error(`mensaje ${id} sin documento (¿enviado como vídeo y no como archivo?)`);
  const total = Number(doc.size) || 0;
  const deadline = Date.now() + deadlineMs;

  // 1) por trozos, con abort limpio
  try {
    const location = new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: "",
    });
    await rm(outPath, { force: true }).catch(() => {});
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
        await new Promise<void>((res, rej) => ws.write(buf, (er) => (er ? rej(er) : res())));
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

  // 2) respaldo: downloadMedia con timeout
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

/**
 * Guarda el original SIN re-subirlo: reenvía (forward) el mensaje del inbox al
 * canal-almacén. Es instantáneo y server-side — el binario nunca sale de Telegram,
 * así que el 4K/60/HEVC llega intacto y sin gastar subida del VPS.
 * `filePath` (opcional) solo se usa para dejar el archivo pequeño ya en caché.
 */
export async function tgPutByForward(key: string, inboxMsgId: number, filePath?: string): Promise<void> {
  const channel = await getChannel();
  let fwd: Api.Message | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const c = await getClient();
      const res = await raceTimeout(
        c.forwardMessages(channel, { messages: [inboxMsgId], fromPeer: env.TELEGRAM_INBOX }),
        12_000,
        `forward ${inboxMsgId}`,
      );
      fwd = (Array.isArray(res) ? res[0] : (res as unknown)) as Api.Message | undefined;
      if (!fwd) throw new Error("forwardMessages no devolvió mensaje");
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      // FLOOD_WAIT en forwards: no insistir, que el llamante suba el archivo
      if (/flood/i.test((e as Error)?.message ?? "")) break;
      resetTelegram();
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  if (lastErr || !fwd) throw lastErr ?? new Error("forward al almacén falló");

  const doc = (fwd as Api.Message).document as Api.Document | undefined;
  let bytes = Number(doc?.size) || 0;
  if (!bytes && filePath) bytes = (await stat(filePath).catch(() => ({ size: 0 }))).size;
  const messageId = Number((fwd as Api.Message).id);
  await query(
    `insert into blob_refs (key, tg_message_id, bytes) values ($1,$2,$3)
     on conflict (key) do update set tg_message_id = excluded.tg_message_id, bytes = excluded.bytes`,
    [key, messageId, bytes],
  );

  if (filePath && bytes && bytes <= CACHE_INLINE_LIMIT) {
    await mkdir(env.TG_CACHE_DIR, { recursive: true });
    await pipe(createReadStream(filePath), createWriteStream(cachePath(key))).catch(() => {});
  }
}

/** Sube el archivo como documento (bytes exactos) y registra key -> message_id. */
export async function tgPut(key: string, filePath: string): Promise<void> {
  const channel = await getChannel();
  const { size } = await stat(filePath);
  // pocos "workers": 16 conexiones en paralelo disparaban FLOOD_WAIT y colgaban
  // la subida minutos. 4 sube a ritmo decente sin que Telegram frene.
  const workers = size > 8 * 1024 * 1024 ? 4 : 1;

  let msg: unknown;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const c = await getClient();
      msg = await raceTimeout(
        c.sendFile(channel, { file: filePath, forceDocument: true, caption: key, workers }),
        Math.max(90_000, Math.round((size / (150 * 1024)) * 1000)), // ~150 KB/s mínimo por intento
        `sendFile ${key} (intento ${attempt})`,
      );
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

/** Ruta en la caché de disco donde `/v1/blob` sirve una key sin tocar Telegram. */
export function tgCachePathFor(key: string): string {
  return cachePath(key);
}

/** Copia un archivo local a la caché de disco para poder servir la key ya (antes de subirla a Telegram). */
export async function tgCachePut(key: string, srcPath: string): Promise<void> {
  await mkdir(env.TG_CACHE_DIR, { recursive: true });
  const dst = cachePath(key);
  await pipe(createReadStream(srcPath), createWriteStream(dst)).catch(() => {});
}

/**
 * Descarga a `outPath` el documento de un mensaje del inbox (por su id) resuelto
 * desde blob_refs no — aquí directamente `me`. Reutiliza tgDownloadInbox.
 * (helper fino para la reproducción de assets aún no guardados)
 */
export async function tgInboxDocLocation(
  msgId: number,
): Promise<{ loc: Api.InputDocumentFileLocation; total: number; dcId?: number }> {
  const c = await getClient();
  const [msg] = await raceTimeout(c.getMessages(env.TELEGRAM_INBOX, { ids: [msgId] }), 30_000, `getMessages ${msgId}`);
  const doc = msg?.document as Api.Document | undefined;
  if (!doc) throw new Error(`mensaje ${msgId} del inbox sin documento`);
  return {
    loc: new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: "",
    }),
    total: Number(doc.size) || 0,
    dcId: doc.dcId,
  };
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
  if (row) return Number(row.bytes);
  // miniatura / póster en BD
  if (key.endsWith("/thumb.webp") || key.endsWith("/poster.jpg")) {
    const col = key.endsWith("/thumb.webp") ? "thumb_webp" : "poster_jpg";
    const t = await one<{ n: string }>(
      `select octet_length(${col}) as n from assets where (thumb_key = $1 or poster_key = $1) and deleted_at is null limit 1`,
      [key],
    ).catch(() => null);
    if (t?.n) return Number(t.n);
  }
  // asset aún sin guardar en el almacén: el tamaño lo sabe la fila del asset
  const a = await one<{ bytes: string }>(
    "select bytes from assets where original_key = $1 and deleted_at is null",
    [key],
  );
  if (a) return Number(a.bytes);
  throw new Error("blob no registrado");
}

let downloading: Map<string, Promise<void>> | null = null;

/** Resuelve el mensaje (canal-almacén o inbox) que respalda una key. */
async function messageForKey(key: string): Promise<Api.Message> {
  const c = await getClient();
  const row = await one<{ tg_message_id: string }>("select tg_message_id from blob_refs where key = $1", [key]);
  if (row) {
    const channel = await getChannel();
    const [m] = await c.getMessages(channel, { ids: [Number(row.tg_message_id)] });
    if (m?.media) return m;
    throw new Error("mensaje no encontrado en Telegram");
  }
  const a = await one<{ src_msg_id: string }>(
    "select src_msg_id from assets where original_key = $1 and not stored and deleted_at is null",
    [key],
  );
  if (!a?.src_msg_id) throw new Error("blob no registrado");
  const [m] = await c.getMessages(env.TELEGRAM_INBOX, { ids: [Number(a.src_msg_id)] });
  if (m?.media) return m;
  throw new Error("mensaje del inbox no encontrado");
}

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
      const c = await getClient();
      const msg = await messageForKey(key);
      await mkdir(env.TG_CACHE_DIR, { recursive: true });
      const tmp = `${cp}.${randomBytes(6).toString("hex")}.dl`;
      try {
        await c.downloadMedia(msg, { outputFile: tmp });
        await rm(cp, { force: true }).catch(() => {});
        await rename(tmp, cp);
        pruneCache();
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => {});
        throw e;
      }
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

const warming = new Set<string>();

/**
 * Precarga la key entera al disco en 2º plano (sin bloquear). Tras la primera
 * reproducción, todos los rangos (seeks, final del vídeo, revisionados) se sirven
 * del disco al instante → cero tirones.
 */
export function warmCache(key: string, totalBytes: number): void {
  if (warming.has(key)) return;
  if (existsSync(cachePath(key))) return;
  // no merece la pena para archivos pequeños ni para uno mayor que toda la caché
  if (totalBytes < 3 * 1024 * 1024) return;
  if (totalBytes > env.TG_CACHE_MAX_MB * 1024 * 1024) return;
  warming.add(key);
  // pequeño respiro para no competir con el arranque de la reproducción
  setTimeout(() => {
    void ensureCached(key)
      .catch((e) => console.error("[tg] warmCache falló:", (e as Error).message))
      .finally(() => warming.delete(key));
  }, 2000);
}

/**
 * Descarga SOLO el rango pedido directamente de Telegram (sin bajar el archivo
 * entero). Así un vídeo empieza a reproducirse en cuanto llega el primer trozo.
 */
// Cache corta de la localización del documento: durante la reproducción de un
// vídeo el navegador pide decenas de rangos; sin esto haríamos un getMessages
// (ida y vuelta a Telegram) por cada rango.
const docCache = new Map<string, { loc: Api.InputDocumentFileLocation; total: number; dcId?: number; at: number }>();
const docInflight = new Map<string, Promise<{ loc: Api.InputDocumentFileLocation; total: number; dcId?: number }>>();
const DOC_TTL = 90_000; // el fileReference caduca; 90 s va sobrado para un vídeo

async function docLocation(
  key: string,
): Promise<{ loc: Api.InputDocumentFileLocation; total: number; dcId?: number }> {
  const hit = docCache.get(key);
  if (hit && Date.now() - hit.at < DOC_TTL) return { loc: hit.loc, total: hit.total, dcId: hit.dcId };

  // varios rangos en paralelo al abrir un vídeo → una sola resolución
  const flying = docInflight.get(key);
  if (flying) return flying;
  const job = docLocationFresh(key).finally(() => docInflight.delete(key));
  docInflight.set(key, job);
  return job;
}

async function docLocationFresh(
  key: string,
): Promise<{ loc: Api.InputDocumentFileLocation; total: number; dcId?: number }> {

  const row = await one<{ tg_message_id: string; bytes: string }>(
    "select tg_message_id, bytes from blob_refs where key = $1",
    [key],
  );

  // aún sin guardar en el almacén: se reproduce directamente desde el inbox
  if (!row) {
    const a = await one<{ src_msg_id: string; bytes: string }>(
      "select src_msg_id, bytes from assets where original_key = $1 and not stored and deleted_at is null",
      [key],
    );
    if (!a?.src_msg_id) throw new Error("blob no registrado");
    const r = await tgInboxDocLocation(Number(a.src_msg_id));
    const t = r.total || Number(a.bytes);
    docCache.set(key, { loc: r.loc, total: t, dcId: r.dcId, at: Date.now() });
    return { loc: r.loc, total: t, dcId: r.dcId };
  }

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
  const dcId = doc.dcId;
  docCache.set(key, { loc, total, dcId, at: Date.now() });
  if (docCache.size > 50) docCache.delete(docCache.keys().next().value!);
  return { loc, total, dcId };
}

const CHUNK = 512 * 1024; // requestSize: múltiplo de 4096, máx 512 KB

async function tgReadRangeLive(
  key: string,
  start: number,
  end: number,
): Promise<{ stream: Readable; totalSize: number }> {
  const { total } = await docLocation(key);
  const wantLen = end - start + 1;

  // Generador resiliente: si Telegram corta a media descarga (fileReference
  // caducado, error de DC transitorio…) reanuda desde donde se quedó con una
  // localización fresca, hasta 3 intentos. Esto mata los tirones a mitad y el
  // "pillado" al final del vídeo.
  async function* gen(): AsyncGenerator<Buffer> {
    let emitted = 0;
    let stalls = 0; // veces seguidas SIN avanzar ni un byte
    while (emitted < wantLen) {
      const before = emitted;
      const from = start + emitted;
      const alignedStart = Math.floor(from / CHUNK) * CHUNK;
      const skip = from - alignedStart;
      const need = wantLen - emitted;
      const limit = Math.min(total - alignedStart, Math.ceil((need + skip) / CHUNK) * CHUNK);
      try {
        const c = await getClient();
        const { loc, dcId } = await docLocation(key);
        const iter = c.iterDownload({ file: loc, dcId, offset: bigInt(alignedStart), limit, requestSize: CHUNK });
        let dropped = 0;
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
      } catch (e) {
        docCache.delete(key); // fuerza fileReference fresco
        if (emitted === before && ++stalls >= 4) throw e;
        await new Promise((r) => setTimeout(r, 200 * stalls));
        continue;
      }
      // iterador agotado limpio: si no avanzó nada, cuenta como stall
      if (emitted === before) {
        docCache.delete(key);
        if (++stalls >= 4) throw new Error(`rango incompleto ${emitted}/${wantLen} (${key})`);
        await new Promise((r) => setTimeout(r, 200 * stalls));
      } else {
        stalls = 0;
      }
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

  // miniatura / póster: viven en la BD (bytes). Nunca dependen de Telegram ni
  // de la caché de disco → jamás 404 mientras exista el asset.
  if (key.endsWith("/thumb.webp") || key.endsWith("/poster.jpg")) {
    const col = key.endsWith("/thumb.webp") ? "thumb_webp" : "poster_jpg";
    const row = await one<{ b: Buffer | null }>(
      `select ${col} as b from assets where (thumb_key = $1 or poster_key = $1) and deleted_at is null limit 1`,
      [key],
    ).catch(() => null);
    if (row?.b && row.b.length) {
      const buf = row.b;
      const total = buf.length;
      const slice = range ? buf.subarray(range.start, Math.min(range.end + 1, total)) : buf;
      return { stream: Readable.from([slice]), size: slice.length, totalSize: total };
    }
  }

  // rango + no cacheado: streaming en directo desde Telegram (arranca al instante)
  // y, en paralelo, precarga el archivo entero al disco → el resto de la
  // reproducción (y los seeks) sale del disco sin tirones.
  if (range) {
    try {
      const { stream, totalSize } = await tgReadRangeLive(key, range.start, range.end);
      warmCache(key, totalSize);
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
