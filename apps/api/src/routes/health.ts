import type { FastifyInstance } from "fastify";
import { ping, one } from "../db.js";
import { env, VERSION } from "../env.js";
import { ingestSnapshot, ingestState, ingestTickNow, ingestSkipPending, ingestResume } from "../ingest.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/healthz", async (_req, reply) => {
    const db = await ping();
    return reply.code(db ? 200 : 503).send({ ok: db, version: VERSION });
  });

  // diagnóstico de la ingesta desde Telegram (sin datos sensibles)
  app.get("/v1/ingest/status", async () => {
    const lastId = await one<{ v: string }>("select v from kv where k = 'ingest:last_id'").catch(() => null);
    const inited = await one<{ v: string }>("select v from kv where k = 'ingest:inited'").catch(() => null);
    const users = await import("../db.js")
      .then((m) =>
        m.query<{ user_id: string; n: string }>(
          "select user_id, count(*) n from assets where deleted_at is null group by user_id order by n desc",
        ),
      )
      .then((r) => r.rows.map((x) => ({ user: `${x.user_id.slice(0, 8)}…`, assets: Number(x.n) })))
      .catch(() => []);
    return {
      version: VERSION,
      storageDriver: env.STORAGE_DRIVER,
      ...ingestSnapshot(),
      inited: !!inited,
      lastId: lastId ? Number(lastId.v) : null,
      ingestUserIdSet: !!env.INGEST_USER_ID,
      pollSeconds: env.INGEST_POLL_SECONDS,
      usersConBiblioteca: users,
    };
  });

  // fuerza una vuelta ahora y devuelve el estado
  app.post("/v1/ingest/run", async () => {
    await ingestTickNow(app.log);
    return {
      ran: true,
      lastSeen: ingestState.lastSeen,
      lastImported: ingestState.lastImported,
      lastTickError: ingestState.lastTickError,
      totalImported: ingestState.totalImported,
    };
  });

  // salta lo que hay atascado ahora en el inbox (luego reenvías lo que quieras)
  app.post("/v1/ingest/skip", async () => {
    const r = await ingestSkipPending(app.log);
    return { ok: true, ...r };
  });

  // quita la pausa por FLOOD_WAIT y hace una vuelta ya
  app.post("/v1/ingest/resume", async () => {
    ingestResume();
    await ingestTickNow(app.log);
    return { ok: true, lastTickError: ingestState.lastTickError, totalImported: ingestState.totalImported };
  });
}
