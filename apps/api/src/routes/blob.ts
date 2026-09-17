import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { verifyBlobToken, readBlob, blobSize } from "../storage.js";

const MIME: Record<string, string> = {
  ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".heic": "image/heic", ".heif": "image/heif", ".gif": "image/gif", ".tiff": "image/tiff",
  ".mov": "video/quicktime", ".mp4": "video/mp4", ".m4v": "video/x-m4v",
};

/**
 * Rango HTTP pedido, ya resuelto contra el tamaño real del archivo.
 * Devuelve:
 *   - `null`   → la cabecera Range no es interpretable (unidad desconocida,
 *                multi-rango, sintaxis rara): por RFC 9110 se IGNORA y se
 *                responde 200 con el archivo entero.
 *   - `{ noSatisfiable: true }` → sintaxis válida pero fuera del archivo → 416.
 *   - `{ start, end }` → rango cerrado, inclusivo, ya recortado a [0, total-1].
 *
 * Soporta las TRES formas de RFC 9110, incluida `bytes=-N` (los últimos N
 * bytes), que antes se interpretaba como "los primeros N": un reproductor o
 * un `ffprobe` que pide la COLA de un .mov para encontrar el átomo `moov`
 * (que en los originales del iPhone está al final, no al principio) recibía
 * la CABECERA en su lugar, con un `Content-Range: bytes 0-N/total` que
 * además mentía sobre qué trozo era. Resultado: el archivo parecía ilegible
 * aunque estuviera perfecto.
 */
export function parseRange(header: string, total: number): { start: number; end: number } | { noSatisfiable: true } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-rango u otra unidad → se ignora (200)
  const rawStart = m[1] ?? "";
  const rawEnd = m[2] ?? "";
  if (!rawStart && !rawEnd) return null; // "bytes=-" no es nada
  if (total <= 0) return { noSatisfiable: true };

  let start: number;
  let end: number;
  if (!rawStart) {
    // sufijo: los últimos N bytes. N mayor que el archivo = archivo entero.
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n <= 0) return { noSatisfiable: true };
    start = Math.max(0, total - n);
    end = total - 1;
  } else {
    start = Number(rawStart);
    // Un valor absurdamente grande (más dígitos de los que caben en un double)
    // se vuelve impreciso o Infinity: se trata como "fuera del archivo".
    if (!Number.isFinite(start) || start < 0 || start >= total) return { noSatisfiable: true };
    end = rawEnd ? Number(rawEnd) : total - 1;
    if (!Number.isFinite(end) || end < start) return { noSatisfiable: true };
    if (end >= total) end = total - 1;
  }
  return { start, end };
}

/** Un parámetro repetido (?dl=a&dl=b) llega como array: quedarse con el primero
 *  en vez de petar con "x.replace is not a function". */
function firstStr(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

/**
 * Sirve archivos de los motores "local" y "telegram". No usa sesión: el enlace
 * lleva un token HMAC temporal (?e=&t=) generado por storage.signedUrl().
 * Soporta `Range` (necesario para reproducir vídeo en Safari/iOS y para reanudar descargas).
 */
export async function blobRoutes(app: FastifyInstance): Promise<void> {
  if (env.STORAGE_DRIVER === "r2") return;

  app.get("/v1/blob/*", async (req, reply) => {
    const key = (req.params as Record<string, string>)["*"] ?? "";
    const raw = req.query as Record<string, unknown>;
    const q = { e: firstStr(raw.e), t: firstStr(raw.t), dl: firstStr(raw.dl) };
    const exp = Number(q.e);

    if (!key || !q.t || !verifyBlobToken(key, exp, q.t)) {
      return reply.code(403).send({ error: "enlace inválido o caducado" });
    }

    const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
    const contentType = MIME[ext] ?? "application/octet-stream";
    // miniatura/póster: contenido inmutable (la key lleva el sha256) → el
    // navegador puede guardarlo semanas y no re-pedirlo en cada sesión.
    const derivative = key.endsWith("/thumb.webp") || key.endsWith("/poster.jpg");
    const cacheHdr = derivative
      ? "private, max-age=1209600, immutable"
      : "private, max-age=86400, immutable";
    const disposition = q.dl
      ? `attachment; filename="${q.dl.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(q.dl)}`
      : null;

    const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : null;

    try {
      // blobSize() puede consultar la BD: una sola vez por petición.
      const total = rangeHeader ? await blobSize(key) : 0;
      const parsed = rangeHeader ? parseRange(rangeHeader, total) : null;
      if (parsed) {
        if ("noSatisfiable" in parsed) {
          reply.code(416).header("Content-Range", `bytes */${total}`);
          return reply.send();
        }
        const start = parsed.start;
        let end = parsed.end;
        // Limitamos cada respuesta: el reproductor pedirá el siguiente trozo.
        // 16 MB = menos "costuras" entre trozos que 8 (menos micro-tirones) sin
        // descargar de más si el usuario hace seek. Cuando el archivo ya está en
        // caché de disco esto ni se aplica (se sirve el rango completo).
        const MAX_SLICE = 16 * 1024 * 1024;
        if (end - start + 1 > MAX_SLICE) end = start + MAX_SLICE - 1;
        // El almacén puede servir MENOS de lo pedido (p. ej. el trozo cae justo
        // en el borde de lo que hay en disco). Es válido en HTTP Range, pero las
        // cabeceras tienen que decir lo que se envía DE VERDAD o el navegador
        // corta la conexión y reintenta en bucle.
        const { stream, size } = await readBlob(key, { start, end });
        const realEnd = size > 0 ? start + size - 1 : end;
        reply.code(206);
        reply.header("Content-Type", contentType);
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("Accept-Ranges", "bytes");
        reply.header("Content-Range", `bytes ${start}-${realEnd}/${total}`);
        reply.header("Content-Length", realEnd - start + 1);
        reply.header("Cache-Control", cacheHdr);
        if (disposition) reply.header("Content-Disposition", disposition);
        return reply.send(stream);
      }

      const file = await readBlob(key);
      reply.header("Content-Type", contentType);
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Length", file.size);
      reply.header("Cache-Control", cacheHdr);
      if (disposition) reply.header("Content-Disposition", disposition);
      return reply.send(file.stream);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      // "no registrado" = de verdad no existe → 404 definitivo.
      // Cualquier otra cosa (Telegram lento, fileReference caducado, corte de
      // red) es TRANSITORIA: con 404 el <video> se rendía para siempre; con 503
      // + Retry-After el navegador vuelve a pedirlo y la reproducción continúa.
      const permanente = /no registrado|no encontrado/i.test(msg);
      req.log.warn({ key, err: msg, permanente }, "blob: no se pudo servir");
      if (permanente) return reply.code(404).send({ error: "no existe" });
      reply.header("Retry-After", "1");
      return reply.code(503).send({ error: "no disponible ahora mismo, reintenta" });
    }
  });
}
