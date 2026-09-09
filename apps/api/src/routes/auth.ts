import type { FastifyInstance } from "fastify";
import { requireUser, principalOf } from "../auth.js";
import { ingestBindUser, ingestBoundUser } from "../ingest.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/auth/me", { preHandler: requireUser }, async (req) => {
    const p = principalOf(req);
    return { userId: p.userId, email: p.email };
  });

  // "recibir aquí los vídeos de Telegram": ata la ingesta a esta cuenta
  app.post("/v1/ingest/bind", { preHandler: requireUser }, async (req) => {
    const p = principalOf(req);
    await ingestBindUser(p.userId);
    return { ok: true, boundTo: p.userId, email: p.email };
  });
  app.get("/v1/ingest/bind", { preHandler: requireUser }, async (req) => {
    const p = principalOf(req);
    const bound = await ingestBoundUser();
    return { boundTo: bound, you: p.userId, isYou: bound === p.userId };
  });
}
