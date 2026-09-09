import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, rename, copyFile, rm } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
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
