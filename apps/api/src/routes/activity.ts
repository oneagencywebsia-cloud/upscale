import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { requireUser, principalOf } from "../auth.js";

/** Registro de lo que el usuario ha visto / descargado. */
export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/activity", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const q = req.query as { limit?: string; before?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 60, 1), 200);
    const params: unknown[] = [userId];
    let sql = `
      select l.id, l.action, l.at, l.asset_id, a.filename, a.thumb_key, a.kind
      from access_log l
      left join assets a on a.id = l.asset_id
      where l.user_id = $1
    `;
    if (q.before !== undefined && q.before !== "") {
      // `l.id` es bigint: cualquier cosa que no sea un entero hacía fallar la
      // consulta y devolver un 500 en vez de un 400 (la actividad es lo
      // primero que se abre tras un error, así que el ruido molestaba doble).
      const before = Number(q.before);
      if (!Number.isSafeInteger(before) || before < 0) {
        return reply.code(400).send({ error: "parámetro 'before' inválido" });
      }
      params.push(before);
      sql += ` and l.id < $${params.length}`;
    }
    params.push(limit + 1);
    sql += ` order by l.id desc limit $${params.length}`;

    const res = await query(sql, params);
    const rows = res.rows;
    const hasMore = rows.length > limit;
    return {
      items: (hasMore ? rows.slice(0, limit) : rows).map((r: Record<string, unknown>) => ({
        id: Number(r.id),
        action: r.action,
        at: (r.at as Date).toISOString(),
        assetId: r.asset_id,
        filename: r.filename,
        thumbKey: r.thumb_key,
        kind: r.kind,
      })),
      nextBefore: hasMore ? Number(rows[limit - 1]!.id) : null,
    };
  });
}
