import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "./env.js";
import { ensureStorageDir } from "./storage.js";
import { runMigrations } from "./run-migrations.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { assetRoutes } from "./routes/assets.js";
import { albumRoutes } from "./routes/albums.js";
import { tokenRoutes } from "./routes/tokens.js";
import { activityRoutes } from "./routes/activity.js";
import { blobRoutes } from "./routes/blob.js";
import { storageRoutes } from "./routes/storage.js";
import { startInboxIngest } from "./ingest.js";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  // Los cuerpos JSON son minúsculos; las subidas van por el parser "*" (stream
  // crudo, sin bufferizar) y validan su tamaño con sizeLimiter (MAX_UPLOAD_BYTES
  // en routes/assets.ts). Este techo tiene que ser AL MENOS ese mismo límite —
  // si no, Fastify corta la petición antes de que sizeLimiter llegue a verla.
  // 200 GB: un original ya no está limitado al tope de Telegram por documento
  // (putSplit lo trocea en varias partes automáticamente al guardarlo).
  bodyLimit: 200 * 1024 * 1024 * 1024,
  trustProxy: true,
  // subidas MUY grandes (decenas de GB) pueden tardar bastante según el ancho
  // de banda de SUBIDA del usuario (nada que ver con el techo de descarga de
  // Telegram, que es un tramo totalmente distinto) — margen amplio en vez de
  // cortar una subida que va avanzando pero despacio.
  requestTimeout: 6 * 60 * 60_000,
  keepAliveTimeout: 75_000,
  disableRequestLogging: false,
});

// Cuerpos binarios (fotos/vídeos): pasar el stream tal cual, sin parsear.
app.addContentTypeParser("*", (_req, payload, done) => done(null, payload));

await runMigrations().catch((e) => {
  console.error("[migrate] fallo:", e);
  process.exit(1);
});
await ensureStorageDir();

// Cabeceras de seguridad. Sin CSP (esto es una API JSON; la web tiene la suya).
await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "same-site" },
});

// Límite de peticiones por IP (la API es alcanzable desde el navegador vía /_api/*).
await app.register(rateLimit, {
  max: 800,
  timeWindow: "1 minute",
  // el blob va con token HMAC y son muchas miniaturas; healthz es para el orquestador
  allowList: (req) => req.url === "/v1/healthz" || req.url.startsWith("/v1/blob/"),
  keyGenerator: (req) => req.ip,
});

await app.register(cors, {
  origin: env.WEB_ORIGIN.split(",").map((s) => s.trim()),
  credentials: true,
});

// No revelar detalles internos en los errores 500.
app.setErrorHandler((err: { statusCode?: number; message?: string }, req, reply) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) req.log.error(err);
  reply.code(status).send({ error: status >= 500 ? "error interno" : (err.message ?? "error") });
});

await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(assetRoutes);
await app.register(albumRoutes);
await app.register(tokenRoutes);
await app.register(activityRoutes);
await app.register(blobRoutes);
await app.register(storageRoutes);

const close = async (sig: string) => {
  app.log.info(`${sig} recibido, cerrando…`);
  await app.close().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", () => void close("SIGTERM"));
process.on("SIGINT", () => void close("SIGINT"));

// El bucle de updates de GramJS y algún stream de Telegram pueden lanzar rechazos
// sueltos ("TIMEOUT", etc.). Se registran y se ignoran: no deben tumbar la API.
process.on("unhandledRejection", (reason) => {
  app.log.warn({ reason: reason instanceof Error ? reason.message : String(reason) }, "unhandledRejection (ignorado)");
});
process.on("uncaughtException", (err) => {
  app.log.error({ err: err?.message, stack: err?.stack }, "uncaughtException (la API sigue)");
});

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`Upscale API (${env.STORAGE_DRIVER}) en http://0.0.0.0:${env.PORT}`);
  startInboxIngest(app.log);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
