import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser, principalOf } from "../auth.js";

/** Tokens de subida para el Atajo de iOS. La web nunca recibe el token completo. */
export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/tokens", { preHandler: requireUser }, async (req) => {
    const { userId } = principalOf(req);
    const res = await query<{
      id: string;
      preview: string;
      label: string | null;
      created_at: Date;
      last_used: Date | null;
    }>(
      `select id,
              left(token, 8) || '…' || right(token, 4) as preview,
              label, created_at, last_used
       from upload_tokens where user_id = $1 order by created_at desc`,
      [userId],
    );
    return { tokens: res.rows };
  });

  app.post("/v1/tokens", { preHandler: requireUser }, async (req) => {
    const { userId } = principalOf(req);
    const label = (req.body as { label?: string } | undefined)?.label?.slice(0, 60) ?? "iPhone";
    const token = "upl_" + randomBytes(24).toString("base64url");
    const row = await query<{ id: string }>(
      "insert into upload_tokens (token, user_id, label) values ($1, $2, $3) returning id",
      [token, userId, label],
    );
    // el token completo se devuelve UNA sola vez, al crearlo
    return { id: row.rows[0]!.id, token, label };
  });

  app.delete("/v1/tokens/:id", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(400).send({ error: "id inválido" });
    await query("delete from upload_tokens where id = $1 and user_id = $2", [id, userId]);
    return reply.code(204).send();
  });
}
