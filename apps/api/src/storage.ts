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

const SECRET = (env.BLOB_SECRET ?? env.SUPABASE_JWT_SECRET ?? "upscale-dev-secret") as string;

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

/** URL temporal de lectura para un objeto. */
export async function signedUrl(key: string, opts: SignOpts = {}): Promise<string> {
  if (env.STORAGE_DRIVER === "r2") {
    const { signedGetUrl } = await import("./r2.js");
    return signedGetUrl(key, opts);
  }
  const exp = Math.floor(Date.now() / 1000) + (opts.expiresIn ?? 3600);
  const t = blobToken(key, exp);
  const params = new URLSearchParams({ e: String(exp), t });
  if (opts.downloadName) params.set("dl", opts.downloadName);
  return `${env.PUBLIC_API_URL.replace(/\/$/, "")}/v1/blob/${key}?${params}`;
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

/** Stream de lectura (motores "local" y "telegram"). Lo usa GET /v1/blob. */
export async function readBlob(key: string): Promise<{ stream: Readable; size: number }> {
  if (env.STORAGE_DRIVER === "telegram") {
    const { tgRead } = await import("./telegram.js");
    return tgRead(key);
  }
  const p = safeLocalPath(key);
  const { size } = await stat(p);
  return { stream: createReadStream(p), size };
}

export async function ensureStorageDir(): Promise<void> {
  if (env.STORAGE_DRIVER === "local") await mkdir(env.STORAGE_DIR, { recursive: true });
  if (env.STORAGE_DRIVER === "telegram") {
    const { ensureTelegram } = await import("./telegram.js");
    await ensureTelegram();
  }
}

export { createWriteStream, pipeline };
