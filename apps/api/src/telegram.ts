import { createReadStream, existsSync, createWriteStream } from "node:fs";
import { mkdir, stat, rm, readdir, utimes, rename, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
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
  resetPool();
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
            // BUG real encontrado (verificado en producción con el vídeo
            // IMG_0276.MOV): "Request was unsuccessful 2 time(s)" es el
            // propio mensaje de GramJS al agotar SUS reintentos internos de
            // client.invoke() (getMessages, subidas...) ante un
            // ServerError/RPC_CALL_FAIL/RPC_MCGET_FAIL — su propio log dice
            // literalmente "Telegram is having internal issues" cuando pasa.
            // Con solo 2 intentos (2s de espera entre cada uno, ~4s en
            // total) cualquier hipo pasajero de los servidores de Telegram
            // tumbaba la generación de la copia ligera entera. Subido a 6:
            // más margen para que un problema transitorio del lado de
            // Telegram se resuelva solo sin gastar los 8 intentos con
            // backoff exponencial de generarPreviews() en fallos que no son
            // culpa nuestra ni del archivo.
            requestRetries: 6,
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

// ---------------------- pool de conexiones de descarga ----------------------
// Telegram limita CADA conexión a ~1 MB/s. Hasta ahora los "4 hilos en paralelo"
// llamaban todos a getClient() → el MISMO cliente → GramJS los multiplexaba por
// UNA sola conexión: cero aceleración. Los clientes oficiales abren varias
// conexiones a la vez; esto hace lo mismo: N clientes independientes sobre la
// MISMA sesión, usados SOLO para bajar bytes (nunca para enviar ni escuchar
// eventos). Resultado: ~N MB/s, que es lo que hace que un 4K se reproduzca sin
// tirones en vez de pararse cada 3 segundos.
let poolPromise: Promise<TelegramClient[]> | null = null;
// Mínimo de conexiones SIEMPRE conectadas (no bajo demanda): abrir una conexión
// nueva es un handshake MTProto de red (típicamente unos cientos de ms, hasta
// 25s en el peor caso, ver newPoolClient) — si TODAS las conexiones ya
// abiertas están ocupadas cuando llega una petición nueva, esa espera cae
// justo en el camino crítico de "abrir un archivo", amenazando el objetivo de
// <2s. Con varias reproducciones/descargas simultáneas a escala de TB, tener
// de sobra conexiones YA abiertas y listas (más que solo las que usa una
// descarga) es lo que evita ese coste casi siempre. TG_POOL_WARM_MIN sube
// este mínimo por encima de TG_DOWNLOAD_STREAMS sin tocar cuántas usa CADA
// descarga individual.
const POOL_BASELINE = Math.max(1, Math.min(8, env.TG_DOWNLOAD_STREAMS), env.TG_POOL_WARM_MIN);
const POOL_MAX = Math.max(POOL_BASELINE, env.TG_POOL_MAX_CLIENTS);

async function newPoolClient(label: string): Promise<TelegramClient> {
  const c = new TelegramClient(
    new StringSession(env.TELEGRAM_SESSION!),
    env.TELEGRAM_API_ID!,
    env.TELEGRAM_API_HASH!,
    // requestRetries subido de 2 a 6 — mismo motivo que en getClient(): un
    // ServerError/RPC_CALL_FAIL transitorio de Telegram no debe agotar el
    // presupuesto de reintentos de GramJS en solo ~4s.
    { connectionRetries: 3, requestRetries: 6, timeout: 20, floodSleepThreshold: 20, autoReconnect: true },
  );
  c.setLogLevel("error" as never);
  await raceTimeout(c.connect(), 25_000, `connect ${label}`);
  return c;
}

async function getPool(): Promise<TelegramClient[]> {
  if (!poolPromise) {
    poolPromise = (async () => {
      const made: TelegramClient[] = [];
      for (let i = 0; i < POOL_BASELINE; i++) {
        try {
          made.push(await newPoolClient(`pool#${i}`));
        } catch (e) {
          console.error(`[tg] pool#${i} no conectó:`, (e as Error).message);
          break; // con los que haya vamos servidos; el resto cae al cliente principal
        }
      }
      if (!made.length) throw new Error("ninguna conexión de descarga disponible");
      return made;
    })();
    poolPromise.catch(() => {
      poolPromise = null;
    });
  }
  try {
    return await poolPromise;
  } catch {
    poolPromise = null;
    return [await getClient()]; // plan B: el cliente principal
  }
}

// ------------------- crecimiento del pool bajo demanda -------------------
// FALLO REAL encontrado: el pool tenía tamaño FIJO = TG_DOWNLOAD_STREAMS (p. ej.
// 6) y downloadClients() repartía ESOS MISMOS 6 clientes entre CUALQUIERA que
// pidiera descarga — un vídeo, dos vídeos a la vez, o un vídeo + una miniatura.
// Con el mutex exclusive() (necesario: sin él, dos iterDownload a la vez sobre
// el mismo cliente mezclan bytes), esto significaba que la SEGUNDA reproducción
// simultánea heredaba clientes YA ocupados por la primera y hacía cola detrás
// de un usuario que nada tiene que ver — la corrección de un bug de bytes
// mezclados reintrodujo un cuello de botella de rendimiento con varios
// usuarios a la vez. Arreglo: el pool CRECE (una conexión nueva por hueco que
// falte) hasta TG_POOL_MAX_CLIENTS cuando la demanda supera lo que hay libre,
// y se encoge solo si un cliente de más lleva minutos sin usarse.
const busyClients = new Set<TelegramClient>();
const poolLastUsed = new WeakMap<TelegramClient, number>();
let growLock: Promise<unknown> = Promise.resolve();

/** Añade UNA conexión más al pool si aún no se llegó al tope. Serializado
 *  (growLock) para que varias llamadas a la vez no disparen de golpe más
 *  conexiones de las que caben en TG_POOL_MAX_CLIENTS. */
function growPool(): Promise<TelegramClient | null> {
  const p = growLock.then(async () => {
    const pool = await getPool().catch(() => [] as TelegramClient[]);
    if (pool.length >= POOL_MAX) return null;
    try {
      const c = await newPoolClient(`pool#${pool.length} (bajo demanda)`);
      pool.push(c);
      console.error(`[tg] pool creció a ${pool.length}/${POOL_MAX} conexiones (demanda concurrente)`);
      return c;
    } catch (e) {
      console.error("[tg] no se pudo ampliar el pool:", (e as Error).message);
      return null;
    }
  });
  growLock = p.catch(() => {}); // que un fallo no atasque el siguiente intento
  return p;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** Encoge el pool: cierra clientes por encima del tamaño base que llevan
 *  varios minutos sin usarse. No toca los TG_DOWNLOAD_STREAMS de base ni
 *  ningún cliente ocupado ahora mismo. */
const POOL_IDLE_MS = 5 * 60_000;
async function reapIdlePoolClients(): Promise<void> {
  if (!poolPromise) return;
  try {
    const pool = await poolPromise;
    const now = Date.now();
    for (let i = pool.length - 1; i >= POOL_BASELINE; i--) {
      const c = pool[i]!;
      if (busyClients.has(c)) continue;
      const last = poolLastUsed.get(c) ?? 0;
      if (now - last > POOL_IDLE_MS) {
        pool.splice(i, 1);
        c.disconnect().catch(() => {});
      }
    }
  } catch {
    /* sin pool todavía, nada que encoger */
  }
}
setInterval(() => {
  reapIdlePoolClients().catch(() => {});
}, 60_000).unref();

/**
 * N clientes para repartir N trozos de UNA descarga. Da prioridad a clientes
 * LIBRES; si no hay suficientes y el pool no está al tope, abre conexiones
 * nuevas (con un plazo corto para no bloquear la petición si la conexión
 * tarda) antes de recurrir a repartir los mismos clientes entre sí.
 */
async function downloadClients(want: number): Promise<TelegramClient[]> {
  let pool: TelegramClient[];
  try {
    pool = await getPool();
  } catch {
    return [await getClient()];
  }
  const idle = pool.filter((c) => c.connected !== false && !busyClients.has(c));
  const result: TelegramClient[] = idle.slice(0, want);

  if (result.length < want && pool.length < POOL_MAX) {
    const need = Math.min(want - result.length, POOL_MAX - pool.length);
    for (let i = 0; i < need; i++) {
      const c = await withTimeout(growPool(), 4000);
      if (c) result.push(c);
      else break; // el resto seguirá conectando en 2º plano para la próxima llamada
    }
  }

  if (result.length < want) {
    const live = pool.filter((c) => c.connected !== false);
    const use = live.length ? live : [await getClient()];
    for (let i = result.length; i < want; i++) result.push(use[i % use.length]!);
  }
  return result.length ? result : [await getClient()];
}

// BUG DE VERDAD, verificado con SHA-256: descargar un archivo y comparar su
// hash contra el registrado en la BD daba un hash DISTINTO con el MISMO
// tamaño en bytes — bytes mezclados, no un corte. Causa: downloadClients()
// reparte los mismos clientes del pool a QUIEN LOS PIDA, sin ningún control
// de "este ya está ocupado". Si dos operaciones a la vez (tu descarga y, por
// ejemplo, el calentamiento de fondo, u otra descarga simultánea) piden
// conexión al mismo tiempo, pueden acabar compartiendo el MISMO cliente — y
// dos `iterDownload` corriendo A LA VEZ sobre la misma conexión mezclan sus
// respuestas entre sí. Encaja exactamente con "milisegundos en blanco o se
// repite un trozo": la ventana exacta donde dos descargas se pisaron.
//
// Arreglo: una cola POR CLIENTE. Cualquiera que quiera usar un cliente para
// iterDownload pasa por aquí — si ese cliente ya está ocupado, espera su
// turno; nunca hay dos iterDownload a la vez sobre el mismo cliente. Los
// distintos clientes del pool SIGUEN yendo en paralelo entre sí (eso es lo
// que suma ancho de banda de verdad) — esto solo impide el uso concurrente
// del MISMO cliente, que es lo único que era inseguro.
const clientQueue = new WeakMap<TelegramClient, Promise<unknown>>();
function exclusive<T>(c: TelegramClient, fn: () => Promise<T>): Promise<T> {
  const prev = clientQueue.get(c) ?? Promise.resolve();
  const marked = async () => {
    busyClients.add(c);
    poolLastUsed.set(c, Date.now());
    try {
      return await fn();
    } finally {
      poolLastUsed.set(c, Date.now());
      busyClients.delete(c);
    }
  };
  const run = prev.then(marked, marked);
  clientQueue.set(c, run.then(() => {}, () => {}));
  return run;
}

/** Tira el pool (reconecta de cero en la próxima descarga). */
function resetPool(): void {
  const dying = poolPromise;
  poolPromise = null;
  growLock = Promise.resolve();
  busyClients.clear();
  dying?.then((cs) => cs.forEach((c) => c.disconnect().catch(() => {}))).catch(() => {});
}

async function getChannel(): Promise<Api.TypeInputPeer> {
  if (channelEntity) return channelEntity;
  const c = await getClient();
  channelEntity = await c.getInputEntity(env.TELEGRAM_CHANNEL_ID!);
  return channelEntity;
}

// ------------------------------- caché en disco -------------------------------

const CACHE_INLINE_LIMIT = 50 * 1024 * 1024; // solo cacheamos archivos pequeños

// Las miniaturas/pósters van a un subdirectorio propio con su LRU independiente:
// así el churn de vídeos grandes NUNCA expulsa las miniaturas (que son lo que el
// usuario ve todo el rato y muy caras de re-servir).
const THUMB_DIR = () => join(env.TG_CACHE_DIR, "thumbs");
const isDerivative = (key: string) => key.endsWith("/thumb.webp") || key.endsWith("/poster.jpg");

// ---------------------------- caché de ARRANQUE ----------------------------
// Abrir un vídeo costaba entre 1 y 12 s porque cada apertura hablaba con
// Telegram de cero (resolver el documento + bajar el primer trozo). Con los
// primeros MB de cada vídeo YA en disco, la reproducción empieza en ~20 ms y el
// resto se va trayendo mientras miras. Son 6 MB por vídeo: 45 vídeos = 270 MB,
// y reconstruirlos tras un deploy son unos segundos a 20 MB/s.
const HEAD_CACHE_BYTES = 6 * 1024 * 1024;
const HEADS_DIR = () => join(env.TG_CACHE_DIR, "heads");
const headPath = (key: string) => join(HEADS_DIR(), createHash("sha1").update(key).digest("hex"));
const HEADS_BUDGET_BYTES = () => Math.max(300, Math.floor(env.TG_CACHE_MAX_MB / 4)) * 1024 * 1024;
/** Cuántos arranques caben de verdad en el presupuesto de disco configurado —
 *  usado para no limitar la precarga a una ventana pequeña y arbitraria
 *  (60 vídeos) cuando la biblioteca tiene miles: el presupuesto de disco YA es
 *  el límite real, así que dejamos que precargarArranques() considere tantos
 *  candidatos como quepan de verdad. */
export function headsBudgetCount(): number {
  return Math.floor(HEADS_BUDGET_BYTES() / HEAD_CACHE_BYTES);
}

function cachePath(key: string): string {
  const hash = createHash("sha1").update(key).digest("hex");
  return isDerivative(key) ? join(THUMB_DIR(), hash) : join(env.TG_CACHE_DIR, hash);
}

// Archivos "en uso" que NUNCA debe tocar el limpiador aunque él solo supere
// todo el presupuesto — p. ej. el original de un vídeo de 20 min (varios GB)
// mientras dura su conversión a copia ligera. Sin esto: se descarga, el
// limpiador lo expulsa porque no cabe en la caché, y la siguiente vez hay que
// volver a descargarlo entero — para siempre. Ver pinCachedFile().
const pinnedCache = new Set<string>();
/** Protege `p` de pruneDir mientras dure una operación larga sobre él (p. ej.
 *  transcodificar). Llamar a la función que devuelve para soltarlo — SIEMPRE,
 *  en un finally, acabe bien o mal la operación. */
export function pinCachedFile(p: string): () => void {
  pinnedCache.add(p);
  return () => pinnedCache.delete(p);
}

async function pruneDir(dir: string, maxBytes: number): Promise<void> {
  try {
    const files = await readdir(dir);
    const stats = await Promise.all(
      files.map(async (f) => {
        const p = join(dir, f);
        const s = await stat(p).catch(() => null);
        return s && s.isFile() ? { p, size: s.size, at: s.mtimeMs } : null;
      }),
    );
    const list = stats.filter(Boolean) as { p: string; size: number; at: number }[];
    let total = list.reduce((n, x) => n + x.size, 0);
    if (total <= maxBytes) return;
    list.sort((a, b) => a.at - b.at); // más antiguo primero
    // NUNCA se borra el más reciente, aunque él solo ya supere el presupuesto
    // — un original de varios GB (más grande que TODA la caché) es justo lo
    // que se acaba de descargar para poder usarlo; borrarlo ahora sería tirar
    // esa descarga a la basura y repetirla la próxima vez, sin fin. Se acepta
    // pasarse del presupuesto por ese archivo — en cuanto entre algo más
    // nuevo, deja de ser "el más reciente" y ya puede salir él solo.
    const candidates = list.length > 1 ? list.slice(0, -1) : [];
    for (const x of candidates) {
      if (total <= maxBytes) break;
      if (pinnedCache.has(x.p)) continue; // en uso activo — intocable
      await rm(x.p, { force: true });
      total -= x.size;
    }
  } catch {
    /* ignore */
  }
}

// Presupuesto de la caché de derivadas. Una miniatura pesa ~23 KB pero un PÓSTER
// ~260 KB: con los 400 MB fijos de antes solo cabían ~1.500 pósters y a partir de
// ahí la caché se pasaba el día expulsando y re-descargando. Se le da un tercio
// del presupuesto total, que escala con la máquina.
const DERIV_CACHE_BYTES = () => Math.max(400, Math.floor(env.TG_CACHE_MAX_MB / 3)) * 1024 * 1024;

let lastPrune = 0;
async function pruneCache(): Promise<void> {
  if (Date.now() - lastPrune < 60_000) return; // no en cada request
  lastPrune = Date.now();
  await pruneDir(env.TG_CACHE_DIR, env.TG_CACHE_MAX_MB * 1024 * 1024);
  await pruneDir(THUMB_DIR(), DERIV_CACHE_BYTES());
  // los arranques son pequeños y son LO que hace que el play sea inmediato:
  // presupuesto propio para que el trasiego de vídeos grandes no los expulse
  await pruneDir(HEADS_DIR(), HEADS_BUDGET_BYTES());
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
      // exclusive(): `c` es el cliente principal, compartido por medio backend
      // — sin esto, otra operación usándolo A LA VEZ mezclaría sus bytes con
      // los de esta descarga.
      await exclusive(c, async () => {
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
      });
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

/**
 * Descarga la CABECERA y la COLA del archivo del inbox en un fichero disperso
 * del tamaño real (el hueco del medio queda a ceros).
 *
 * Por qué las dos puntas: en los MP4/MOV del iPhone el átomo `moov` —el índice
 * con duración, resolución, fps y códec— va al FINAL del archivo. Bajando solo
 * el principio, ffprobe no lee absolutamente nada (y ffmpeg no puede sacar el
 * póster). Con principio + final, ffprobe lee el índice de la cola y ffmpeg
 * saca el primer fotograma de la cabecera, sin bajarse los 600 MB del medio.
 *
 * Devuelve los bytes realmente descargados.
 */
export async function tgDownloadInboxHeadTail(
  id: number,
  outPath: string,
  headBytes: number,
  tailBytes: number,
): Promise<number> {
  const c = await getClient();
  const [msg] = await raceTimeout(c.getMessages(env.TELEGRAM_INBOX, { ids: [id] }), 30_000, `getMessages ${id}`);
  const doc = msg?.document as Api.Document | undefined;
  if (!doc || !msg?.media) throw new Error(`mensaje ${id} sin documento`);
  const total = Number(doc.size) || 0;

  // si es pequeño, el archivo entero y listo
  if (!total || total <= headBytes + tailBytes) {
    return tgDownloadInboxHead(id, outPath, total || headBytes + tailBytes);
  }

  const loc = new Api.InputDocumentFileLocation({
    id: doc.id,
    accessHash: doc.accessHash,
    fileReference: doc.fileReference,
    thumbSize: "",
  });
  const dcId = doc.dcId;

  // la cola se alinea a 4 KB (MTProto exige offset alineado)
  const tailStart = Math.floor((total - tailBytes) / 4096) * 4096;

  const { open } = await import("node:fs/promises");
  const fh = await open(outPath, "w");
  try {
    await fh.truncate(total); // fichero disperso del tamaño REAL
    const clients = await downloadClients(2);
    const [head, tail] = await Promise.all([
      fetchSubRange(loc, dcId, 0, headBytes, clients[0]),
      fetchSubRange(loc, dcId, tailStart, total, clients[1]),
    ]);
    await fh.write(head, 0, head.length, 0);
    await fh.write(tail, 0, tail.length, tailStart);
    return head.length + tail.length;
  } finally {
    await fh.close();
  }
}

/**
 * Descarga SOLO los primeros `maxBytes` del archivo del inbox.
 * Devuelve los bytes escritos (≤ maxBytes, o el tamaño real si es más pequeño).
 */
export async function tgDownloadInboxHead(id: number, outPath: string, maxBytes: number): Promise<number> {
  const c = await getClient();
  const [msg] = await raceTimeout(c.getMessages(env.TELEGRAM_INBOX, { ids: [id] }), 30_000, `getMessages ${id}`);
  const doc = msg?.document as Api.Document | undefined;
  if (!doc || !msg?.media) throw new Error(`mensaje ${id} sin documento`);
  const total = Number(doc.size) || 0;
  const want = total ? Math.min(maxBytes, total) : maxBytes;

  const location = new Api.InputDocumentFileLocation({
    id: doc.id,
    accessHash: doc.accessHash,
    fileReference: doc.fileReference,
    thumbSize: "",
  });
  await rm(outPath, { force: true }).catch(() => {});
  const ws = createWriteStream(outPath);
  let written = 0;
  try {
    // sin `limit` (un límite no alineado a 4 KB da LIMIT_INVALID): iteramos en
    // trozos y cortamos el iterador en cuanto tenemos la cabecera que queríamos.
    // exclusive(): `c` es el cliente principal compartido — ver la nota junto
    // a la definición de exclusive() más arriba en este archivo.
    await exclusive(c, async () => {
      const iterOpts: Parameters<typeof c.iterDownload>[0] = {
        file: location,
        dcId: doc.dcId,
        requestSize: 512 * 1024,
      };
      if (total) iterOpts.fileSize = bigInt(total);
      for await (const chunk of c.iterDownload(iterOpts)) {
        const buf = Buffer.from(chunk as Uint8Array);
        await new Promise<void>((res, rej) => ws.write(buf, (er) => (er ? rej(er) : res())));
        written += buf.length;
        if (written >= want) break;
      }
    });
  } finally {
    await new Promise<void>((res) => ws.end(() => res()));
  }
  if (written <= 0) throw new Error(`cabecera vacía (msg ${id})`);
  return written;
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
  let newMsgId = 0;
  let bytes = 0;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const c = await getClient();
      const fromPeer = await c.getInputEntity(env.TELEGRAM_INBOX);
      // invoke crudo con randomId explícito: el wrapper c.forwardMessages() de
      // esta versión de GramJS no lo pone y para canales no devuelve el mensaje.
      const randomId = bigInt(randomBytes(8).readBigUInt64BE().toString());
      const res = (await raceTimeout(
        c.invoke(
          new Api.messages.ForwardMessages({
            fromPeer,
            toPeer: channel,
            id: [inboxMsgId],
            randomId: [randomId],
          }),
        ),
        15_000,
        `forward ${inboxMsgId}`,
      )) as { updates?: unknown[] };

      for (const u of res.updates ?? []) {
        const m = (u as { message?: Api.Message }).message;
        if (!m || typeof m.id !== "number") continue;
        const doc = (m as Api.Message).document as Api.Document | undefined;
        if (doc) {
          newMsgId = m.id;
          bytes = Number(doc.size) || 0;
          break;
        }
        if (!newMsgId) newMsgId = m.id;
      }
      if (newMsgId) {
        lastErr = null;
        break;
      }
      throw new Error("forward: sin mensaje nuevo en la respuesta");
    } catch (e) {
      lastErr = e;
      if (/flood/i.test((e as Error)?.message ?? "")) break;
      resetTelegram();
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }

  if (!newMsgId) {
    throw lastErr instanceof Error && /flood/i.test(lastErr.message)
      ? lastErr
      : new Error(`el reenvío no produjo un mensaje válido (origen ${inboxMsgId})`);
  }

  if (!bytes && filePath) bytes = (await stat(filePath).catch(() => ({ size: 0 }))).size;
  await query(
    `insert into blob_refs (key, tg_message_id, bytes) values ($1,$2,$3)
     on conflict (key) do update set tg_message_id = excluded.tg_message_id, bytes = excluded.bytes`,
    [key, newMsgId, bytes],
  );

  if (filePath && bytes && bytes <= CACHE_INLINE_LIMIT) {
    const dst = cachePath(key);
    await mkdir(dirname(dst), { recursive: true });
    await pipe(createReadStream(filePath), createWriteStream(dst)).catch(() => {});
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
  const dst = cachePath(key);
  await mkdir(dirname(dst), { recursive: true });
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
    const isThumb = key.endsWith("/thumb.webp");
    const t = await one<{ n: string }>(
      isThumb
        ? "select octet_length(thumb_webp) as n from assets where thumb_key = $1 and deleted_at is null limit 1"
        : "select octet_length(poster_jpg) as n from assets where poster_key = $1 and deleted_at is null limit 1",
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

/**
 * Descarga un documento entero a `outPath` con VARIOS hilos en paralelo (como los
 * clientes oficiales de Telegram). Escrituras posicionadas en el archivo. Sin
 * recompresión — son los mismos bytes, solo que en trozos simultáneos.
 */
async function tgDownloadParallel(
  msg: Api.Message,
  outPath: string,
  streams = 4,
): Promise<void> {
  const doc = msg.document as Api.Document | undefined;
  const total = Number(doc?.size) || 0;
  const dcId = doc?.dcId;
  if (!doc || !total) {
    // sin tamaño no se puede trocear: caemos al descargador normal
    const c = await getClient();
    await c.downloadMedia(msg, { outputFile: outPath });
    return;
  }
  const loc = new Api.InputDocumentFileLocation({
    id: doc.id,
    accessHash: doc.accessHash,
    fileReference: doc.fileReference,
    thumbSize: "",
  });

  const { open } = await import("node:fs/promises");
  const fh = await open(outPath, "w");
  try {
    await fh.truncate(total);
    const REQ = 512 * 1024;
    const per = Math.max(REQ, Math.ceil(total / streams / REQ) * REQ);
    const nParts = Math.ceil(total / per);
    // una conexión por trozo (pool) → el ancho de banda SUMA de verdad
    const clients = await downloadClients(nParts);
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < nParts; i++) {
      const from = i * per;
      const to = Math.min(total, from + per);
      const c = clients[i]!;
      // exclusive(): si `c` coincide con el de OTRO trozo (el pool puede ser
      // más pequeño que nParts) o con alguna otra descarga en curso a la vez,
      // esto pone en cola en vez de correr dos iterDownload a la vez sobre la
      // misma conexión — que es justo lo que mezclaba bytes entre descargas.
      jobs.push(
        exclusive(c, async () => {
          let pos = from;
          for await (const chunk of c.iterDownload({
            file: loc,
            dcId,
            offset: bigInt(from),
            limit: to - from,
            requestSize: REQ,
          })) {
            const buf = Buffer.from(chunk as Uint8Array);
            if (!buf.length) continue;
            const w = pos + buf.length > to ? buf.subarray(0, to - pos) : buf;
            await fh.write(w, 0, w.length, pos);
            pos += w.length;
            if (pos >= to) break;
          }
        }),
      );
    }
    await Promise.all(jobs);
  } finally {
    await fh.close();
  }
}

/** Descarga la key entera a la caché de disco (una sola vez aunque llamen en paralelo). */
async function ensureCached(key: string, streams = 4): Promise<string> {
  const cp = cachePath(key);
  if (existsSync(cp)) {
    await utimes(cp, new Date(), new Date()).catch(() => {}); // LRU touch
    return cp;
  }
  downloading ??= new Map();
  let job = downloading.get(key);
  if (!job) {
    job = (async () => {
      const msg = await messageForKey(key);
      await mkdir(env.TG_CACHE_DIR, { recursive: true });
      const tmp = `${cp}.${randomBytes(6).toString("hex")}.dl`;
      try {
        await tgDownloadParallel(msg, tmp, streams);
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

/** Ruta local del archivo entero (lo descarga del almacén si hace falta). Para el ZIP. */
export async function tgEnsureLocal(key: string, streams = 3): Promise<string> {
  return ensureCached(key, streams);
}

/**
 * Fichero DISPERSO con la cabecera y la cola de un objeto YA guardado, del
 * tamaño real. Para releer metadatos o sacar el póster de un vídeo sin bajarse
 * el archivo entero: de un 4K de 600 MB se descargan 14 MB.
 * Devuelve la ruta de un temporal — lo borra quien lo pide.
 */
export async function tgHeadTailTemp(
  key: string,
  outPath: string,
  headBytes = 8 * 1024 * 1024,
  tailBytes = 6 * 1024 * 1024,
): Promise<{ path: string; total: number; partial: boolean }> {
  const { loc, total, dcId } = await docLocation(key);
  const { open } = await import("node:fs/promises");

  if (!total || total <= headBytes + tailBytes) {
    // pequeño: el archivo entero sale más a cuenta que trocear
    const fh = await open(outPath, "w");
    try {
      const buf = await fetchSubRange(loc, dcId, 0, total, (await downloadClients(1))[0]);
      await fh.write(buf, 0, buf.length, 0);
    } finally {
      await fh.close();
    }
    return { path: outPath, total, partial: false };
  }

  const tailStart = Math.floor((total - tailBytes) / 4096) * 4096;
  const fh = await open(outPath, "w");
  try {
    await fh.truncate(total);
    const cs = await downloadClients(2);
    const [head, tail] = await Promise.all([
      fetchSubRange(loc, dcId, 0, headBytes, cs[0]),
      fetchSubRange(loc, dcId, tailStart, total, cs[1]),
    ]);
    await fh.write(head, 0, head.length, 0);
    await fh.write(tail, 0, tail.length, tailStart);
  } finally {
    await fh.close();
  }
  return { path: outPath, total, partial: true };
}

/**
 * Deja los primeros MB de `key` en disco para que abrir el vídeo sea instantáneo.
 * Idempotente y barato: si ya está, no hace nada.
 */
export async function tgEnsureHead(key: string): Promise<boolean> {
  const hp = headPath(key);
  if (existsSync(hp)) return false;
  if (existsSync(cachePath(key))) return false; // ya está el archivo entero
  const { loc, total, dcId } = await docLocation(key);
  const want = Math.min(HEAD_CACHE_BYTES, total || HEAD_CACHE_BYTES);
  const buf = await fetchSubRange(loc, dcId, 0, want, (await downloadClients(1))[0]);
  await mkdir(HEADS_DIR(), { recursive: true });
  const tmp = `${hp}.${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, buf);
  await rename(tmp, hp);
  return true;
}

/** ¿Tenemos ya el arranque de esta key en disco? */
export function tieneArranque(key: string): boolean {
  return existsSync(headPath(key));
}

// ---- prioridad: la reproducción del usuario manda sobre el mantenimiento ----
let lastLiveReadAt = 0;
/** ¿Hay alguien viendo algo ahora mismo? (rango servido en los últimos `ms`) */
export function streamingActivo(ms = 20_000): boolean {
  return Date.now() - lastLiveReadAt < ms;
}

const warming = new Set<string>();
let warmChain: Promise<unknown> = Promise.resolve();

/**
 * Precarga la key entera al disco en 2º plano (sin bloquear). Tras la primera
 * reproducción, todos los rangos (seeks, final del vídeo, revisionados) se sirven
 * del disco al instante → cero tirones.
 *
 * Las precargas se hacen DE UNA EN UNA: si se lanzan varias a la vez se reparten
 * el mismo ancho de banda y ninguna termina, que es justo lo que hacía que un
 * vídeo arrancara, se atascara, volviera a arrancar y así en bucle.
 */
export function warmCache(key: string, totalBytes: number): void {
  if (warming.has(key)) return;
  if (existsSync(cachePath(key))) return;
  if (totalBytes < 3 * 1024 * 1024) return; // no merece la pena
  // Antes: si el archivo era mayor que TODA la caché se abandonaba la precarga y
  // el vídeo se quedaba servido en directo a ~1 MB/s para siempre (= tirones
  // eternos). Ahora solo se descarta si por sí solo vaciaría media caché.
  if (totalBytes > env.TG_CACHE_MAX_MB * 1024 * 1024 * 0.5) return;
  warming.add(key);
  warmChain = warmChain
    .then(() => (existsSync(cachePath(key)) ? undefined : ensureCached(key, env.TG_DOWNLOAD_STREAMS)))
    .catch((e) => console.error("[tg] warmCache falló:", (e as Error).message))
    .finally(() => warming.delete(key));
}

/**
 * Descarga SOLO el rango pedido directamente de Telegram (sin bajar el archivo
 * entero). Así un vídeo empieza a reproducirse en cuanto llega el primer trozo.
 */
// Cache de la localización del documento: durante la reproducción de un vídeo
// el navegador pide decenas de rangos; sin esto haríamos un getMessages (ida y
// vuelta a Telegram) por cada rango. A escala de TB con miles de vídeos
// distintos, un caché de solo 50 entradas (el tamaño anterior) se vaciaba
// constantemente — CUALQUIER vídeo que no fuera de los ~50 más recientemente
// abiertos pagaba esa ida y vuelta extra en el camino crítico de "abrir un
// vídeo", justo lo que amenaza el objetivo de <2s. Subido a 5000 (unos pocos
// cientos de bytes cada una: irrelevante en RAM) y con desalojo REALMENTE LRU
// (antes desalojaba por orden de INSERCIÓN, no de USO — una entrada reciente
// podía ser la primera en caer si otras se reinsertaban después).
const docCache = new Map<string, { loc: Api.InputDocumentFileLocation; total: number; dcId?: number; at: number }>();
const DOC_CACHE_MAX = 5000;
const docInflight = new Map<string, Promise<{ loc: Api.InputDocumentFileLocation; total: number; dcId?: number }>>();
// El fileReference de Telegram dura bastante más que los 90s anteriores (ese
// valor era innecesariamente conservador y forzaba re-resoluciones de sobra).
// Es seguro alargarlo: si una referencia realmente caduca antes de tiempo,
// fetchSubRange/tgReadRangeLive YA la detectan como fallo, borran esta
// entrada y reintentan con una fresca — el TTL solo decide cuánto se AHORRA
// en el caso normal, nunca compromete la corrección.
const DOC_TTL = 20 * 60_000;

function docCacheTouch(key: string, v: { loc: Api.InputDocumentFileLocation; total: number; dcId?: number; at: number }): void {
  docCache.delete(key); // reinsertar mueve la clave al final del Map → orden de uso, no de inserción
  docCache.set(key, v);
  while (docCache.size > DOC_CACHE_MAX) docCache.delete(docCache.keys().next().value!);
}

async function docLocation(
  key: string,
): Promise<{ loc: Api.InputDocumentFileLocation; total: number; dcId?: number }> {
  const hit = docCache.get(key);
  if (hit && Date.now() - hit.at < DOC_TTL) {
    docCacheTouch(key, hit); // refresca la posición LRU en cada uso, no solo al crear
    return { loc: hit.loc, total: hit.total, dcId: hit.dcId };
  }

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
    docCacheTouch(key, { loc: r.loc, total: t, dcId: r.dcId, at: Date.now() });
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
  docCacheTouch(key, { loc, total, dcId, at: Date.now() });
  return { loc, total, dcId };
}

const CHUNK = 512 * 1024; // requestSize: múltiplo de 4096, máx 512 KB

// ------------------------- FLOOD_WAIT en la descarga -------------------------
// GramJS ya duerme SOLO cuando el FLOOD_WAIT pedido es <= floodSleepThreshold
// (20 s, ver getClient/newPoolClient) — para eso no hace falta nada aquí. El
// caso que SÍ llegaba roto: un FLOOD_WAIT > 20 s salía como excepción de
// iterDownload y el reintento de abajo (antes: 150-450 ms de espera) volvía a
// llamar a Telegram CASI AL INSTANTE, dentro de la misma ventana de bloqueo →
// fallaba otra vez, agotaba los 3 intentos en menos de 1 s y tiraba abajo el
// trozo (y con él, en tgReadRangeLive, la respuesta HTTP entera aunque ya
// llevara cabecera + bytes enviados al navegador). Ahora se detecta el
// FLOOD_WAIT, se espera el tiempo que Telegram pide (con un tope para no
// colgar la petición indefinidamente) y NO cuenta contra el presupuesto de
// reintentos por fallo real de red.
let lastFloodWait: { at: number; seconds: number } | null = null;
function floodWaitSeconds(e: unknown): number | null {
  const msg = e instanceof Error ? e.message : String(e);
  const m = /wait of (\d+) seconds|flood_wait[_ ]?(\d+)/i.exec(msg);
  if (!m) return null;
  return Number(m[1] ?? m[2]) || null;
}

/** Baja [from, to) de un documento con reintentos. Devuelve exactamente to-from bytes. */
async function fetchSubRange(
  loc: Api.InputDocumentFileLocation,
  dcId: number | undefined,
  from: number,
  to: number,
  client?: TelegramClient,
): Promise<Buffer> {
  const alignedStart = Math.floor(from / CHUNK) * CHUNK;
  const skip = from - alignedStart;
  const want = to - from;
  const MAX_NET_ATTEMPTS = 3;
  const MAX_FLOOD_ATTEMPTS = 3;
  let netAttempt = 0;
  let floodAttempt = 0;
  for (;;) {
    try {
      // cada trozo por SU conexión → suman ancho de banda de verdad. exclusive()
      // asegura que, si esta MISMA conexión está en uso por otra cosa a la vez
      // (otra descarga, el calentamiento de fondo…), esperamos nuestro turno en
      // vez de correr los dos iterDownload a la vez y mezclar las respuestas.
      // En el primer intento se usa el cliente que nos tocó del pool; en
      // reintentos (de red o tras un FLOOD_WAIT) probamos con OTRO cliente del
      // pool si hay uno libre, en vez de machacar siempre el mismo.
      const c = netAttempt === 0 && floodAttempt === 0 && client ? client : (await downloadClients(1))[0]!;
      const out = Buffer.allocUnsafe(want);
      const filled = await exclusive(c, async () => {
        let dropped = 0;
        let n = 0;
        for await (const chunk of c.iterDownload({
          file: loc,
          dcId,
          offset: bigInt(alignedStart),
          limit: Math.ceil((want + skip) / CHUNK) * CHUNK,
          requestSize: CHUNK,
        })) {
          let buf = Buffer.from(chunk as Uint8Array);
          if (dropped < skip) {
            const d = Math.min(skip - dropped, buf.length);
            dropped += d;
            buf = buf.subarray(d);
          }
          if (!buf.length) continue;
          const room = want - n;
          if (buf.length > room) buf = buf.subarray(0, room);
          buf.copy(out, n);
          n += buf.length;
          if (n >= want) break;
        }
        return n;
      });
      if (filled === want) return out;
      throw new Error(`subrango incompleto ${filled}/${want}`);
    } catch (e) {
      const waitSecs = floodWaitSeconds(e);
      if (waitSecs != null) {
        floodAttempt++;
        lastFloodWait = { at: Date.now(), seconds: waitSecs };
        if (floodAttempt > MAX_FLOOD_ATTEMPTS) throw e;
        const capped = Math.min(waitSecs, 30); // tope: no colgar el HTTP para siempre
        console.error(`[tg] FLOOD_WAIT ${waitSecs}s en subrango, espero ${capped}s (intento ${floodAttempt}/${MAX_FLOOD_ATTEMPTS})`);
        await new Promise((r) => setTimeout(r, capped * 1000));
        continue; // no cuenta contra netAttempt: no es un fallo de red
      }
      netAttempt++;
      if (netAttempt >= MAX_NET_ATTEMPTS) throw e;
      await new Promise((r) => setTimeout(r, 150 * netAttempt));
    }
  }
}

export async function tgReadRangeLive(
  key: string,
  start: number,
  end: number,
  streamsOverride?: number,
): Promise<{ stream: Readable; totalSize: number }> {
  lastLiveReadAt = Date.now(); // el mantenimiento se aparta mientras esto pase
  const { loc, total, dcId } = await docLocation(key);
  const wantLen = end - start + 1;

  // El rango se baja en trozos PEQUEÑOS (1 MB) con una VENTANA DESLIZANTE de N
  // conexiones y se van entregando EN ORDEN según llegan.
  //
  // Antes: se lanzaban N trozos gigantes y se hacía Promise.all → el navegador no
  // recibía NI UN BYTE hasta tener los 16 MB completos (a ~1 MB/s, 16 s en
  // silencio). El <video> se cansaba, cortaba, reintentaba... y así en bucle.
  // Ahora el primer byte sale en ~1 s y el caudal es continuo.
  async function* gen(): AsyncGenerator<Buffer> {
    const STREAMS = Math.max(1, Math.min(32, streamsOverride ?? env.TG_DOWNLOAD_STREAMS));
    const PART = 1024 * 1024;
    // El PRIMER trozo va aparte y más pequeño (256 KB): a ~1 MB/s por conexión,
    // 1 MB entero puede ser ~1s solo para el primer byte — sumado a resolver
    // la localización del documento y conseguir una conexión libre, arriesga
    // el objetivo de "abrir cualquier archivo en <2s". Con 256 KB el primer
    // byte sale en ~0,25s en el peor caso realista, y a partir del segundo
    // trozo se vuelve a 1 MB (menos "costuras" = más eficiente en régimen).
    const FIRST_PART = Math.min(256 * 1024, wantLen);
    const partRange = (i: number): [number, number] => {
      if (i === 0) return [start, start + FIRST_PART];
      const from = start + FIRST_PART + (i - 1) * PART;
      return [from, Math.min(end + 1, from + PART)];
    };
    const nParts = FIRST_PART >= wantLen ? 1 : 1 + Math.ceil((wantLen - FIRST_PART) / PART);
    const clients = await downloadClients(Math.min(nParts, STREAMS));

    // CLAVE para el rendimiento real: lanzar el SIGUIENTE trozo de una conexión
    // en cuanto ESA conexión termina — no cuando el consumidor (el bucle de
    // abajo) llega a ese índice. Antes, si el trozo 2 tardaba un poco más de
    // lo normal (variación de red normal y corriente), las conexiones 3, 4 y 5
    // —aunque llevaran RATO libres— se quedaban paradas sin pedir nada más,
    // porque `launch(i+STREAMS)` solo se llamaba dentro del bucle secuencial,
    // al llegar a cada índice por orden. Un solo trozo lento frenaba a las
    // demás conexiones enteras — así de fácil se caía de 12-17 MB/s en una
    // ráfaga corta a menos de 1 MB/s sostenido en una descarga larga.
    const inflight = new Map<number, Promise<Buffer>>();
    const launch = (i: number): void => {
      if (i >= nParts || inflight.has(i)) return;
      const [from, to] = partRange(i);
      const p = fetchSubRange(loc, dcId, from, to, clients[i % clients.length]);
      inflight.set(i, p);
      // en cuanto ESTA conexión libere (bien o mal), ya puede coger el
      // siguiente trozo que le toque — sin esperar a que el consumidor
      // secuencial llegue hasta aquí.
      p.then(
        () => launch(i + STREAMS),
        () => launch(i + STREAMS),
      );
    };
    for (let i = 0; i < Math.min(nParts, STREAMS); i++) launch(i);

    try {
      for (let i = 0; i < nParts; i++) {
        let buf: Buffer;
        try {
          buf = await inflight.get(i)!;
        } catch (e) {
          // Último intento antes de tirar TODA la respuesta HTTP (que para este
          // punto ya puede llevar cabecera + varios MB enviados al navegador:
          // es exactamente el "vídeo a medio cargar" que se reportó). Causa más
          // probable de un fallo que sobrevive a los reintentos de
          // fetchSubRange: el fileReference caducó a mitad de un vídeo largo
          // (varios minutos de descarga). Se refresca la localización del
          // documento y se repite ESTE trozo, exacto mismo rango, con un
          // cliente nuevo — así no se duplican ni desordenan bytes.
          inflight.delete(i);
          docCache.delete(key);
          console.error(`[tg] trozo ${i} falló (${(e as Error).message}), reintento final con fileReference fresco`);
          const fresh = await docLocation(key);
          const [from, to] = partRange(i);
          const c2 = (await downloadClients(1))[0];
          buf = await fetchSubRange(fresh.loc, fresh.dcId, from, to, c2);
        }
        inflight.delete(i);
        // OJO: se refresca en CADA trozo, no solo una vez al principio. Una
        // descarga de 571 MB puede tardar varios minutos — si esto solo se
        // marcaba al empezar, a los 20s "streamingActivo()" volvía a decir
        // que no había nadie mirando, y el mantenimiento de fondo (calentar
        // arranques, generar copias…) volvía a competir por las MISMAS
        // conexiones durante el resto de la descarga, dejándola a un ritmo
        // de caracol el resto del tiempo.
        lastLiveReadAt = Date.now();
        yield buf;
      }
    } catch (e) {
      docCache.delete(key); // fileReference fresco al siguiente intento
      throw e;
    }
  }

  return { stream: Readable.from(gen()), totalSize: total };
}

/**
 * Diagnóstico del almacén: conexiones vivas, estado de la caché y una prueba de
 * velocidad real (baja 8 MB de un original y mide MB/s). Sirve para saber si el
 * pool está funcionando y si la caché es persistente o se borra en cada deploy.
 */
/**
 * Prueba SOSTENIDA por el camino REAL de una descarga (tgReadRangeLive, el
 * mismo generador con ventana deslizante que usa /v1/blob/*), emitiendo una
 * muestra de velocidad cada ~3s a medida que llegan los bytes. Generador, no
 * un valor final: así la ruta HTTP puede ir transmitiendo cada muestra en
 * cuanto se produce en vez de esperar a tenerlo todo — necesario porque el
 * proxy delante de la API corta la conexión si no ve NINGÚN byte salir
 * durante ~30s, y una prueba de cientos de MB tarda mucho más que eso.
 */
export async function* tgSustainedSpeedTest(
  key: string,
  mb: number,
  streams?: number,
): AsyncGenerator<{ s: number; mbps: number } | { fin: true; mb: number; segundos: number; mbpsMedia: number }> {
  const total = await tgSize(key);
  const wantBytes = Math.min(mb * 1024 * 1024, total);
  const { stream } = await tgReadRangeLive(key, 0, wantBytes - 1, streams);
  const t0 = Date.now();
  let bytes = 0;
  let lastSampleAt = t0;
  let lastSampleBytes = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    bytes += chunk.length;
    const now = Date.now();
    if (now - lastSampleAt >= 3000) {
      const mbps = (bytes - lastSampleBytes) / 1e6 / ((now - lastSampleAt) / 1000);
      yield { s: +((now - t0) / 1000).toFixed(1), mbps: +mbps.toFixed(2) };
      lastSampleAt = now;
      lastSampleBytes = bytes;
    }
  }
  const secs = (Date.now() - t0) / 1000;
  yield { fin: true, mb: +(bytes / 1e6).toFixed(1), segundos: +secs.toFixed(2), mbpsMedia: +(bytes / 1e6 / secs).toFixed(2) };
}

export async function tgDiag(sampleKey?: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  try {
    const pool = await getPool();
    const vivas = pool.filter((c) => c.connected !== false);
    out.conexionesDescarga = {
      streamsPorDescarga: env.TG_DOWNLOAD_STREAMS, // cuántas usa UNA reproducción/descarga
      poolBase: POOL_BASELINE,
      poolMax: POOL_MAX, // tope al que puede CRECER el pool con varios usuarios a la vez
      poolActual: pool.length,
      activas: vivas.length,
      ocupadasAhora: pool.filter((c) => busyClients.has(c)).length, // en medio de un iterDownload ahora mismo
    };
  } catch (e) {
    out.conexionesDescarga = { error: (e as Error).message };
  }

  out.floodWait = lastFloodWait
    ? { ...lastFloodWait, hace: `${Math.round((Date.now() - lastFloodWait.at) / 1000)}s` }
    : null;

  try {
    const medir = async (dir: string) => {
      const files = await readdir(dir).catch(() => [] as string[]);
      let bytes = 0;
      let n = 0;
      for (const f of files) {
        const s = await stat(join(dir, f)).catch(() => null);
        if (s?.isFile()) {
          bytes += s.size;
          n++;
        }
      }
      return { archivos: n, mb: Math.round(bytes / 1e6) };
    };
    out.cache = {
      dir: env.TG_CACHE_DIR,
      originales: await medir(env.TG_CACHE_DIR),
      derivadas: await medir(THUMB_DIR()),
      arranquesDeVideo: await medir(HEADS_DIR()),
      presupuestoMb: env.TG_CACHE_MAX_MB,
      calentando: [...warming].length,
      protegidos: pinnedCache.size, // en uso activo (p. ej. transcodificando) — el limpiador no los toca
      reproduciendoAhora: streamingActivo(),
    };
  } catch (e) {
    out.cache = { error: (e as Error).message };
  }

  if (sampleKey) {
    try {
      const total = await tgSize(sampleKey);
      const want = Math.min(8 * 1024 * 1024, total);
      const nParts = Math.max(1, Math.ceil(want / (1024 * 1024)));
      const clients = await downloadClients(Math.min(nParts, env.TG_DOWNLOAD_STREAMS));
      const { loc, dcId } = await docLocation(sampleKey);
      const t0 = Date.now();
      await Promise.all(
        Array.from({ length: nParts }, (_, i) =>
          fetchSubRange(loc, dcId, i * 1024 * 1024, Math.min(want, (i + 1) * 1024 * 1024), clients[i % clients.length]),
        ),
      );
      const secs = (Date.now() - t0) / 1000;
      out.velocidad = { key: sampleKey, mb: +(want / 1e6).toFixed(1), segundos: +secs.toFixed(2), mbps: +(want / 1e6 / secs).toFixed(2) };
    } catch (e) {
      out.velocidad = { error: (e as Error).message };
    }

  }
  return out;
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

  // miniatura / póster: si NO están en Telegram (blob_refs), se sirven de la BD
  // (bytes) con write-back a disco → jamás 404 y no se consulta la BD en cada
  // carga de galería. Si SÍ están en blob_refs, cae al camino normal (Telegram
  // → caché de disco), que es lo habitual una vez subida la miniatura.
  const isThumb = key.endsWith("/thumb.webp");
  const isPoster = key.endsWith("/poster.jpg");
  if (isThumb || isPoster) {
    const inTg = await one<{ x: number }>("select 1 x from blob_refs where key = $1", [key]).catch(() => null);
    const row = inTg
      ? null
      : await one<{ b: Buffer | null }>(
          isThumb
            ? "select thumb_webp as b from assets where thumb_key = $1 and deleted_at is null limit 1"
            : "select poster_jpg as b from assets where poster_key = $1 and deleted_at is null limit 1",
          [key],
        ).catch(() => null);
    // Si el póster no existe (falló al generarse), se sirve la MINIATURA en su
    // lugar. Antes esto daba 404 y el visor se quedaba en negro: más vale una
    // imagen pequeña que nada, y el barrido la sustituye cuando la regenere.
    const bytes = row?.b ?? null;
    // ...pero solo si el póster tampoco está en Telegram (si está, hay que ir a
    // buscarlo ahí, no servir la miniatura en su lugar).
    if (isPoster && !inTg && !bytes?.length) {
      const alt = await one<{ b: Buffer | null }>(
        `select thumb_webp as b from assets
           where poster_key = $1 and deleted_at is null and thumb_webp is not null limit 1`,
        [key],
      ).catch(() => null);
      if (alt?.b?.length) {
        return { stream: Readable.from([alt.b]), size: alt.b.length, totalSize: alt.b.length };
      }
    }
    if (bytes && bytes.length) {
      const buf = bytes;
      const total = buf.length;
      // write-back a disco: la PRÓXIMA petición de esta miniatura sale del disco,
      // no vuelve a la BD. Convierte el coste de BD en una sola vez por miniatura.
      void (async () => {
        try {
          await mkdir(dirname(cp), { recursive: true });
          const tmp = `${cp}.${randomBytes(4).toString("hex")}`;
          await writeFile(tmp, buf);
          await rename(tmp, cp);
        } catch {
          /* si falla, se sirve desde BD otra vez, sin más */
        }
      })();
      const slice = range ? buf.subarray(range.start, Math.min(range.end + 1, total)) : buf;
      return { stream: Readable.from([slice]), size: slice.length, totalSize: total };
    }
  }

  // ¿el trozo pedido cae dentro del ARRANQUE que ya tenemos en disco? Entonces
  // se sirve de local (~20 ms) sin tocar Telegram. Es lo que hace que darle al
  // play sea inmediato en vez de esperar 1-12 s. Si el rango se sale del
  // arranque, se recorta: el reproductor pedirá el siguiente trozo acto seguido
  // (respuesta parcial más corta de lo pedido: es válido en HTTP Range).
  if (range) {
    const hp = headPath(key);
    if (existsSync(hp)) {
      try {
        const { size: headSize } = await stat(hp);
        if (range.start < headSize) {
          await utimes(hp, new Date(), new Date()).catch(() => {});
          const total = await tgSize(key);
          const end = Math.min(range.end, headSize - 1);
          warmCache(key, total); // el resto, en 2º plano
          return {
            stream: createReadStream(hp, { start: range.start, end }),
            size: end - range.start + 1,
            totalSize: total,
          };
        }
      } catch {
        /* si algo falla, camino normal */
      }
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
  } else {
    // SIN rango (el botón "Descargar", que pide el archivo entero de una
    // sola vez): antes esto esperaba a tener el ORIGINAL COMPLETO en disco
    // antes de mandar el primer byte — para un vídeo de más de ~500 MB eso
    // son más de un minuto en silencio, tiempo de sobra para que el proxy
    // corte la conexión y el navegador vea un 503 "no disponible ahora
    // mismo". Se sirve igual que el streaming de vídeo: en directo, por
    // trozos, según van llegando — el primer byte sale enseguida y la
    // descarga entera nunca depende de un único plazo límite.
    // OJO: sin warmCache aquí a propósito. En la reproducción SÍ tiene
    // sentido (se pide un trocito y se cachea el resto por si acaso) pero en
    // una descarga completa el archivo ENTERO ya se está retransmitiendo en
    // directo — cachearlo TAMBIÉN en paralelo es descargarlo dos veces a la
    // vez, compitiendo por las mismas conexiones del pool consigo mismo.
    // Verificado en producción: dos descargas de 571 MB y 310 MB a la vez
    // caían a ~0,6 MB/s cada una por esto exactamente.
    try {
      const total = await tgSize(key);
      const { stream, totalSize } = await tgReadRangeLive(key, 0, total - 1);
      return { stream, size: totalSize, totalSize };
    } catch (e) {
      docCache.delete(key);
      console.error("[tg] streaming directo (descarga completa) falló, uso caché completa:", (e as Error).message);
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
