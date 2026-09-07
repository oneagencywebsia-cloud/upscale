import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser, principalOf } from "../auth.js";

/** Tokens de subida para el Atajo de iOS. */
export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/tokens", { preHandler: requireUser }, async (req) => {
    const { userId } = principalOf(req);
    const res = await query<{ token: string; label: string | null; created_at: Date; last_used: Date | null }>(
      "select token, label, created_at, last_used from upload_tokens where user_id = $1 order by created_at desc",
      [userId],
    );
    return { tokens: res.rows };
  });

  app.post("/v1/tokens", { preHandler: requireUser }, async (req) => {
    const { userId } = principalOf(req);
    const label = (req.body as { label?: string } | undefined)?.label?.slice(0, 60) ?? "iPhone";
    const token = "upl_" + randomBytes(24).toString("base64url");
    await query("insert into upload_tokens (token, user_id, label) values ($1, $2, $3)", [token, userId, label]);
    return { token, label };
  });

  app.delete("/v1/tokens/:token", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { token } = req.params as { token: string };
    await query("delete from upload_tokens where token = $1 and user_id = $2", [token, userId]);
    return reply.code(204).send();
  });
}
