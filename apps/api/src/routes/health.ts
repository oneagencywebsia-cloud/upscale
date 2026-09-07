import type { FastifyInstance } from "fastify";
import { ping } from "../db.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/healthz", async (_req, reply) => {
    const db = await ping();
    return reply.code(db ? 200 : 503).send({ ok: db });
  });
}
