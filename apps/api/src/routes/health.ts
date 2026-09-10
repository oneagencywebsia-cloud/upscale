import { execFile } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { ping, one } from "../db.js";
import { env, VERSION } from "../env.js";
import { ingestSnapshot, ingestState, ingestTickNow, ingestSkipPending, ingestResume } from "../ingest.js";

function firstLine(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const c = execFile(cmd, args, { timeout: 5000 }, (err, out, e) => {
      if (err && !out && !e) return resolve(`NO: ${err.message.split("\n")[0]}`);
      resolve(((out || e || "").split("\n")[0] || "ok").slice(0, 120));
    });
    c.on("error", (er) => resolve(`NO: ${er.message}`));
  });
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/healthz", async (_req, reply) => {
    const db = await ping();
    return reply.code(db ? 200 : 503).send({ ok: db, version: VERSION });
  });

  // qué herramientas de imagen hay en el contenedor (para depurar HEIC/rotación)
  app.get("/v1/diag/tools", async () => ({
    version: VERSION,
    convert: await firstLine("convert", ["-version"]),
    vips: await firstLine("vips", ["--version"]),
    vipsheader: await firstLine("vipsheader", ["--help"]),
    "heif-convert": await firstLine("heif-convert", ["--version"]),
    "heif-info": await firstLine("heif-info", ["--version"]),
    ffmpeg: await firstLine("ffmpeg", ["-version"]),
    ffprobe: await firstLine("ffprobe", ["-version"]),
  }));

  // ¿va rápido Telegram? conexiones vivas, caché y prueba de velocidad real.
  // ?key=orig/... para medir con un original concreto; si no, coge el último vídeo.
  app.get("/v1/diag/storage", async (req) => {
    const { tgDiag } = await import("../telegram.js");
    const q = req.query as { key?: string };
    let key = q.key;
    if (!key) {
      const r = await one<{ k: string }>(
        `select original_key k from assets
           where kind = 'video' and stored = true and deleted_at is null
           order by uploaded_at desc limit 1`,
      ).catch(() => null);
      key = r?.k;
    }
    // peso de la BD: lo que decide si la biblioteca escala a millones de archivos
    const db = await one<{ total: string; posters: string; thumbs: string; n: string; pend: string }>(
      `select pg_size_pretty(pg_total_relation_size('assets')) as total,
              pg_size_pretty(coalesce(sum(octet_length(poster_jpg)),0)) as posters,
              pg_size_pretty(coalesce(sum(octet_length(thumb_webp)),0)) as thumbs,
              count(*) as n,
              count(*) filter (where octet_length(coalesce(poster_jpg,''::bytea)) > 4) as pend
         from assets where deleted_at is null`,
    ).catch(() => null);
    return {
      version: VERSION,
      bd: db
        ? { tablaAssets: db.total, postersEnBd: db.posters, miniaturasEnBd: db.thumbs, archivos: Number(db.n), postersPorDescargar: Number(db.pend) }
        : null,
      ...(await tgDiag(key)),
    };
  });

  // diagnóstico de la ingesta desde Telegram (sin datos sensibles)
  app.get("/v1/ingest/status", async () => {
    const lastId = await one<{ v: string }>("select v from kv where k = 'ingest:last_id'").catch(() => null);
    const inited = await one<{ v: string }>("select v from kv where k = 'ingest:inited'").catch(() => null);
    const pend = await one<{ n: string }>("select count(*) n from assets where not stored and deleted_at is null").catch(() => null);
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
      pendingStore: pend ? Number(pend.n) : 0,
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
