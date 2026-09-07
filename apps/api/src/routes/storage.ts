import { statfs } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { one } from "../db.js";
import { requireUser, principalOf } from "../auth.js";

/** Uso de espacio del usuario + espacio libre del disco (modo local). */
export async function storageRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/storage", { preHandler: requireUser }, async (req) => {
    const { userId } = principalOf(req);
    const agg = await one<{ bytes: string | null; n: string }>(
      "select coalesce(sum(bytes),0) as bytes, count(*) as n from assets where user_id = $1 and deleted_at is null",
      [userId],
    );

    let diskFree: number | null = null;
    let diskTotal: number | null = null;
    if (env.STORAGE_DRIVER === "local") {
      try {
        const s = await statfs(env.STORAGE_DIR);
        diskFree = s.bsize * s.bavail;
        diskTotal = s.bsize * s.blocks;
      } catch {
        /* ignore */
      }
    }

    return {
      driver: env.STORAGE_DRIVER,
      usedBytes: Number(agg?.bytes ?? 0),
      count: Number(agg?.n ?? 0),
      diskFreeBytes: diskFree,
      diskTotalBytes: diskTotal,
    };
  });
}
