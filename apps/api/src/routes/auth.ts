import type { FastifyInstance } from "fastify";
import { requireUser, principalOf } from "../auth.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/auth/me", { preHandler: requireUser }, async (req) => {
    const p = principalOf(req);
    return { userId: p.userId, email: p.email };
  });
}
