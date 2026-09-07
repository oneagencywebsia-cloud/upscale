import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { ensureStorageDir } from "./storage.js";
import { runMigrations } from "./run-migrations.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { assetRoutes } from "./routes/assets.js";
import { tokenRoutes } from "./routes/tokens.js";
import { activityRoutes } from "./routes/activity.js";
import { blobRoutes } from "./routes/blob.js";
import { storageRoutes } from "./routes/storage.js";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 8 * 1024 * 1024 * 1024, // 8 GB — vídeos 4K
  trustProxy: true,
});

// Cuerpos binarios (fotos/vídeos): pasar el stream tal cual, sin parsear.
app.addContentTypeParser("*", (_req, payload, done) => done(null, payload));

await runMigrations().catch((e) => {
  console.error("[migrate] fallo:", e);
  process.exit(1);
});
await ensureStorageDir();

await app.register(cors, {
  origin: env.WEB_ORIGIN.split(",").map((s) => s.trim()),
  credentials: true,
});

await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(assetRoutes);
await app.register(tokenRoutes);
await app.register(activityRoutes);
await app.register(blobRoutes);
await app.register(storageRoutes);

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`Upscale API (${env.STORAGE_DRIVER}) en http://0.0.0.0:${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
