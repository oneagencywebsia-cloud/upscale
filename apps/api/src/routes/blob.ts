import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { verifyBlobToken, readBlob } from "../storage.js";

const MIME: Record<string, string> = {
  ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".heic": "image/heic", ".heif": "image/heif", ".gif": "image/gif", ".tiff": "image/tiff",
  ".mov": "video/quicktime", ".mp4": "video/mp4", ".m4v": "video/x-m4v",
};

/**
 * Sirve archivos de los motores "local" y "telegram". No usa sesión: el enlace
 * lleva un token HMAC temporal (?e=&t=) generado por storage.signedUrl().
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

    let file;
    try {
      file = await readBlob(key);
    } catch {
      return reply.code(404).send({ error: "no existe" });
    }

    const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
    reply.header("Content-Type", MIME[ext] ?? "application/octet-stream");
    reply.header("Content-Length", file.size);
    reply.header("Cache-Control", "private, max-age=3600");
    if (q.dl) reply.header("Content-Disposition", `attachment; filename="${q.dl.replace(/"/g, "")}"`);
    return reply.send(file.stream);
  });
}
