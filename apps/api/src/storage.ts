import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, rename, copyFile, rm, utimes } from "node:fs/promises";
import { dirname, join, normalize, sep, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";
import { env } from "./env.js";

/**
 * Capa de almacenamiento con tres motores (STORAGE_DRIVER):
 *  - "telegram": canal privado de Telegram, subido como documento (bytes EXACTOS).
 *  - "local":    disco de esta máquina (STORAGE_DIR).
 *  - "r2":       Cloudflare R2 (S3), URLs firmadas nativas.
 * En "telegram" y "local" los archivos se sirven por
 *   GET /v1/blob/<key>?e=<exp>&t=<hmac>
 */

export interface SignOpts {
  expiresIn?: number; // segundos
  downloadName?: string;
}

// ------------------------------- LOCAL -------------------------------

function safeLocalPath(key: string): string {
  const clean = normalize(key).replace(/^([/\\]|\.\.[/\\])+/, "");
  const full = join(env.STORAGE_DIR, clean);
  if (!full.startsWith(normalize(env.STORAGE_DIR) + sep)) throw new Error("ruta fuera de STORAGE_DIR");
  return full;
}

const SECRET = env.BLOB_SECRET ?? env.SUPABASE_JWT_SECRET ?? "";
if ((env.STORAGE_DRIVER === "local" || env.STORAGE_DRIVER === "telegram") && SECRET.length < 16) {
  throw new Error("BLOB_SECRET (>=16 chars) es obligatorio para firmar los enlaces de /v1/blob");
}

export function blobToken(key: string, exp: number): string {
  return createHmac("sha256", SECRET).update(`${key}\n${exp}`).digest("base64url");
}

export function verifyBlobToken(key: string, exp: number, token: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const good = Buffer.from(blobToken(key, exp));
  const got = Buffer.from(token);
  return good.length === got.length && timingSafeEqual(good, got);
}

async function putLocal(key: string, filePath: string): Promise<void> {
  const dest = safeLocalPath(key);
  await mkdir(dirname(dest), { recursive: true });
  try {
    await rename(filePath, dest);
  } catch {
    await copyFile(filePath, dest);
    await rm(filePath, { force: true });
  }
}

// ------------------------------- API --------------------------------

/** Guarda un archivo del disco temporal en el almacenamiento definitivo. */
export async function put(key: string, filePath: string, contentType: string): Promise<void> {
  if (env.STORAGE_DRIVER === "r2") {
    const { putFile } = await import("./r2.js");
    return putFile(key, filePath, contentType);
  }
  if (env.STORAGE_DRIVER === "telegram") {
    const { tgPut } = await import("./telegram.js");
    return tgPut(key, filePath);
  }
  return putLocal(key, filePath);
}

/**
 * Como put(), pero trocea el original si supera el tope de Telegram por
 * documento (2 GB / 4 GB Premium) — un vídeo de 1h a 4K/60 HEVC del iPhone
 * puede pesar 20-45 GB, muy por encima. Cada parte se sube como su propio
 * mensaje (tgSendPart); el resto de la app lo sigue viendo como UN solo
 * archivo — la reconstrucción es transparente en la capa de lectura
 * (tgReadRangeLive/ensureCached en telegram.ts). Solo aplica a
 * STORAGE_DRIVER=telegram: local/R2 no tienen ese tope por archivo.
 */
export async function putSplit(
  key: string,
  filePath: string,
  contentType: string,
  size: number,
  /** Se llama tras subir CADA parte, con los bytes acumulados. Lo usa el
   *  pipeline para que el plazo límite sea "sin progreso en X" y no un tope
   *  total que mata una subida legítima de varias horas. */
  onProgress?: (bytesSubidos: number, parte: number, dePartes: number) => void,
): Promise<void> {
  if (env.STORAGE_DRIVER !== "telegram") return put(key, filePath, contentType);
  const { tgSendPart, tgRegisterParts, TELEGRAM_FILE_CEILING_BYTES, PART_SIZE_BYTES } = await import("./telegram.js");
  if (size <= TELEGRAM_FILE_CEILING_BYTES) return put(key, filePath, contentType); // camino de SIEMPRE

  // Preflight de disco: cada parte se materializa como un fichero temporal
  // aparte (hasta ~1,8 GB) ANTES de subirla. Sin sitio, la primera copia
  // fallaría a mitad y dejaría un temporal enorme a medias.
  try {
    const { statfs } = await import("node:fs/promises");
    const fsStat = await statfs(env.TMP_DIR);
    const libres = fsStat.bavail * fsStat.bsize;
    const necesarios = Math.min(size, PART_SIZE_BYTES) + 512 * 1024 * 1024;
    if (libres < necesarios) {
      throw new Error(
        `sin espacio en TMP_DIR para trocear: hacen falta ~${Math.round(necesarios / 1e6)} MB y hay ${Math.round(libres / 1e6)} MB`,
      );
    }
  } catch (e) {
    if (/sin espacio en TMP_DIR/.test((e as Error)?.message ?? "")) throw e;
    /* statfs no disponible: seguimos igual */
  }

  const n = Math.ceil(size / PART_SIZE_BYTES);
  const subidas: { index: number; messageId: number; bytes: number }[] = [];
  // nombre único por invocación: dos putSplit a la vez sobre ficheros con el
  // MISMO basename (p. ej. dos reintentos solapados del mismo asset) se
  // pisaban el temporal el uno al otro y subían bytes cruzados.
  const marca = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const temporales = Array.from({ length: n }, (_, i) => join(env.TMP_DIR, `${basename(filePath)}.${marca}.part${i}`));
  try {
    let acumulado = 0;
    for (let i = 0; i < n; i++) {
      const start = i * PART_SIZE_BYTES;
      const end = Math.min(size, start + PART_SIZE_BYTES);
      const tmp = temporales[i]!;
      await pipeline(createReadStream(filePath, { start, end: end - 1 }), createWriteStream(tmp));
      // verificación barata: si la copia de la parte salió corta (disco lleno,
      // fichero truncado bajo los pies), subirla dejaría un original corrupto
      // imposible de detectar después.
      const { size: copiado } = await stat(tmp);
      if (copiado !== end - start) {
        throw new Error(`parte ${i} incompleta en disco: ${copiado}/${end - start} bytes`);
      }
      // Marca el ORIGINAL como "en uso": aquí solo se LEE, y leer no refresca
      // el mtime. Sin esto, el barrido de temporales huérfanos de ingest.ts
      // (que se guía por el mtime) podría borrarlo a mitad de una subida
      // troceada de varias horas y dejar sin fichero a las partes que faltan.
      await utimes(filePath, new Date(), new Date()).catch(() => {});
      subidas.push(await tgSendPart(key, i, tmp));
      await rm(tmp, { force: true }).catch(() => {});
      acumulado += copiado;
      onProgress?.(acumulado, i + 1, n);
    }
    // TODO subido: recién ahora se hace visible, de golpe y en una transacción.
    await tgRegisterParts(key, subidas);
  } finally {
    // Si algo lanzó a medias, el `rm` del bucle no llegó a correr para la parte
    // en curso (ni para las siguientes, que ni existen): se barren todos los
    // nombres posibles. `force:true` no se queja de los que no existen.
    await Promise.allSettled(temporales.map((t) => rm(t, { force: true })));
  }
}

/**
 * Guarda el original reenviándolo dentro de Telegram (sin re-subir bytes).
 * Solo válido con STORAGE_DRIVER=telegram y un archivo que YA está en Telegram
 * (ingesta desde el inbox). Si falla, el llamante cae a `put()` normal.
 */
export async function putOriginalByForward(key: string, inboxMsgId: number, filePath: string): Promise<void> {
  if (env.STORAGE_DRIVER !== "telegram") throw new Error("forward solo aplica a STORAGE_DRIVER=telegram");
  const { tgPutByForward } = await import("./telegram.js");
  return tgPutByForward(key, inboxMsgId, filePath);
}

/** URL temporal de lectura para un objeto. */
export async function signedUrl(key: string, opts: SignOpts = {}): Promise<string> {
  if (env.STORAGE_DRIVER === "r2") {
    const { signedGetUrl } = await import("./r2.js");
    return signedGetUrl(key, opts);
  }
  // Redondeamos la expiración a una ventana estable: así la URL firmada es idéntica
  // entre renders sucesivos y el navegador puede cachear la miniatura de verdad.
  const ttl = opts.expiresIn ?? 3600;
  const bucket = Math.max(60, Math.floor(ttl / 4));
  const exp = (Math.floor(Date.now() / 1000 / bucket) + Math.ceil(ttl / bucket)) * bucket;
  const t = blobToken(key, exp);
  const params = new URLSearchParams({ e: String(exp), t });
  if (opts.downloadName) params.set("dl", opts.downloadName);
  const base = env.PUBLIC_API_URL
    .replace(/^(https?:\/\/)(https?:\/\/)+/i, "$1") // corrige "https://https://..."
    .replace(/\/+$/, "");
  return `${base}/v1/blob/${key}?${params}`;
}

/** Borra un objeto del almacenamiento. No falla si no existe. */
export async function remove(key: string): Promise<void> {
  if (env.STORAGE_DRIVER === "r2") {
    const { deleteObject } = await import("./r2.js");
    await deleteObject(key).catch(() => {});
    return;
  }
  if (env.STORAGE_DRIVER === "telegram") {
    const { tgDelete } = await import("./telegram.js");
    await tgDelete(key).catch(() => {});
    return;
  }
  await rm(safeLocalPath(key), { force: true }).catch(() => {});
}

export interface ByteRange {
  start: number;
  end: number; // inclusivo
}

/** Ruta a un archivo local con el contenido entero (descarga del almacén si hace falta). Para el ZIP de "descargar todo". */
export async function blobToLocalFile(key: string): Promise<string> {
  if (env.STORAGE_DRIVER === "telegram") {
    const { tgEnsureLocal } = await import("./telegram.js");
    return tgEnsureLocal(key);
  }
  if (env.STORAGE_DRIVER === "local") return safeLocalPath(key);
  throw new Error("descarga masiva no soportada con este almacenamiento");
}

/**
 * Stream de lectura (motores "local" y "telegram"). Lo usa GET /v1/blob.
 * Si se pasa `range`, devuelve solo esos bytes (para <video> y descargas con reanudación).
 */
export async function readBlob(
  key: string,
  range?: ByteRange,
): Promise<{ stream: Readable; size: number; totalSize: number }> {
  if (env.STORAGE_DRIVER === "telegram") {
    const { tgRead } = await import("./telegram.js");
    return tgRead(key, range);
  }
  const p = safeLocalPath(key);
  const { size } = await stat(p);
  if (range) {
    return {
      stream: createReadStream(p, { start: range.start, end: range.end }),
      size: range.end - range.start + 1,
      totalSize: size,
    };
  }
  return { stream: createReadStream(p), size, totalSize: size };
}

/** Tamaño en bytes de un objeto, sin descargarlo (telegram lo lee de blob_refs). */
export async function blobSize(key: string): Promise<number> {
  if (env.STORAGE_DRIVER === "telegram") {
    const { tgSize } = await import("./telegram.js");
    return tgSize(key);
  }
  const { size } = await stat(safeLocalPath(key));
  return size;
}

export async function ensureStorageDir(): Promise<void> {
  if (env.STORAGE_DRIVER === "local") await mkdir(env.STORAGE_DIR, { recursive: true });
  if (env.STORAGE_DRIVER === "telegram") {
    const { ensureTelegram } = await import("./telegram.js");
    await ensureTelegram();
  }
}

export { createWriteStream, pipeline };
