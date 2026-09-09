import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { verifyBlobToken, readBlob, blobSize } from "../storage.js";

const MIME: Record<string, string> = {
  ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".heic": "image/heic", ".heif": "image/heif", ".gif": "image/gif", ".tiff": "image/tiff",
  ".mov": "video/quicktime", ".mp4": "video/mp4", ".m4v": "video/x-m4v",
};

/**
 * Sirve archivos de los motores "local" y "telegram". No usa sesión: el enlace
 * lleva un token HMAC temporal (?e=&t=) generado por storage.signedUrl().
 * Soporta `Range` (necesario para reproducir vídeo en Safari/iOS y para reanudar descargas).
 */
export async function blobRoutes(app: FastifyInstance): Promise<void> {
  if (env.STORAGE_DRIVER === "r2") return;

  app.get("/v1/blob/*", async (req, reply) => {
    const key = (req.params as Record<string, string>)["*"] ?? "";
    const q = req.query as { e?: string; t?: string; dl?: string };
    const exp = Number(q.e);

    if (!key || !q.t || !verifyBlobToken(key, exp, q.t)) {
      return reply.code(403).send({ error: "enlace inválido o caducado" });
    }

    const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
    const contentType = MIME[ext] ?? "application/octet-stream";
    const disposition = q.dl
      ? `attachment; filename="${q.dl.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(q.dl)}`
      : null;

    const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : null;

    try {
      if (rangeHeader) {
        const total = await blobSize(key);
        const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= total) end = total - 1;
        if (start > end || start >= total) {
          reply.code(416).header("Content-Range", `bytes */${total}`);
          return reply.send();
        }
        // Limitamos cada respuesta: el reproductor pedirá el siguiente trozo.
        // 16 MB = menos "costuras" entre trozos que 8 (menos micro-tirones) sin
        // descargar de más si el usuario hace seek. Cuando el archivo ya está en
        // caché de disco esto ni se aplica (se sirve el rango completo).
        const MAX_SLICE = 16 * 1024 * 1024;
        if (end - start + 1 > MAX_SLICE) end = start + MAX_SLICE - 1;
        const { stream } = await readBlob(key, { start, end });
        reply.code(206);
        reply.header("Content-Type", contentType);
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("Accept-Ranges", "bytes");
        reply.header("Content-Range", `bytes ${start}-${end}/${total}`);
        reply.header("Content-Length", end - start + 1);
        reply.header("Cache-Control", "private, max-age=86400");
        if (disposition) reply.header("Content-Disposition", disposition);
        return reply.send(stream);
      }

      const file = await readBlob(key);
      reply.header("Content-Type", contentType);
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Length", file.size);
      reply.header("Cache-Control", "private, max-age=86400, immutable");
      if (disposition) reply.header("Content-Disposition", disposition);
      return reply.send(file.stream);
    } catch {
      return reply.code(404).send({ error: "no existe" });
    }
  });
}
