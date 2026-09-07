import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.js";

// Este módulo solo se importa cuando STORAGE_DRIVER=r2 (env.ts ya validó que existen).
const s3 = new S3Client({
  region: "auto",
  endpoint: env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
  },
});

/** Sube un archivo del disco a R2 con longitud conocida (streaming, sin cargarlo en RAM). */
export async function putFile(key: string, filePath: string, contentType: string): Promise<void> {
  const { size } = await stat(filePath);
  await s3.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: size,
      ContentType: contentType,
    }),
  );
}

export async function putBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: env.R2_BUCKET!, Key: key, Body: body, ContentType: contentType }),
  );
}

interface SignOpts {
  expiresIn?: number; // segundos
  downloadName?: string; // fuerza descarga con este nombre
}

/** URL temporal de lectura para un objeto de R2. */
export async function signedGetUrl(key: string, opts: SignOpts = {}): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: env.R2_BUCKET!,
    Key: key,
    ...(opts.downloadName
      ? { ResponseContentDisposition: `attachment; filename="${opts.downloadName.replace(/"/g, "")}"` }
      : {}),
  });
  return getSignedUrl(s3, cmd, { expiresIn: opts.expiresIn ?? 3600 });
}
