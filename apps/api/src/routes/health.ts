import type { FastifyInstance } from "fastify";
import { ping } from "../db.js";
import { VERSION } from "../env.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/healthz", async () => ({ ok: true, db: await ping(), version: VERSION }));
}
