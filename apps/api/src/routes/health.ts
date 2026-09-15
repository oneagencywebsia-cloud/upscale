import { execFile } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { ping, one, poolStats } from "../db.js";
import { env, VERSION } from "../env.js";
import { ingestSnapshot, ingestState, ingestTickNow, ingestSkipPending, ingestResume, previewWorkerMetrics } from "../ingest.js";

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
    const q = req.query as { key?: string; mb?: string };
    let key = q.key;
    const sampleMb = q.mb ? Math.max(8, Math.min(500, Number(q.mb) || 0)) : undefined;
    if (!key) {
      const r = await one<{ k: string }>(
        `select original_key k from assets
           where kind = 'video' and stored = true and deleted_at is null
           order by uploaded_at desc limit 1`,
      ).catch(() => null);
      key = r?.k;
    }
    // peso de la BD: lo que decide si la biblioteca escala a millones de archivos
    const db = await one<{ total: string; posters: string; thumbs: string; n: string; pend: string; rotos: string }>(
      `select pg_size_pretty(pg_total_relation_size('assets')) as total,
              pg_size_pretty(coalesce(sum(octet_length(poster_jpg)),0)) as posters,
              pg_size_pretty(coalesce(sum(octet_length(thumb_webp)),0)) as thumbs,
              count(*) as n,
              count(*) filter (where octet_length(coalesce(poster_jpg,''::bytea)) > 4) as pend,
              count(*) filter (where unrecoverable) as rotos
         from assets where deleted_at is null`,
    ).catch(() => null);
    // copias ligeras de reproducción: cuántas hechas / pendientes y cuánto ahorran.
    // "enEspera" = en backoff tras un fallo transitorio (no cuentan como backlog
    // activo: ese hueco lo ocupa mientras tanto otro vídeo). "atascados" = con
    // candado de "procesando" más viejo que el timeout — se autocuran solos en
    // el próximo intento de reclamo (ver generarPreviews en ingest.ts), esto es
    // solo el número visto en este instante. "rendidos" = agotaron los
    // reintentos con backoff y se quedan viendo el original tal cual.
    const workerMx = previewWorkerMetrics();
    const pv = await one<{
      listas: string;
      pend: string;
      enEspera: string;
      atascados: string;
      rendidos: string;
      orig: string | null;
      prev: string | null;
    }>(
      `select count(*) filter (where preview_key is not null) as listas,
              count(*) filter (
                where preview_key is null and preview_state >= 0 and preview_next_attempt_at <= now()
                  and (preview_locked_at is null or preview_locked_at < now() - make_interval(mins => $1::int))
              ) as pend,
              count(*) filter (where preview_key is null and preview_state >= 0 and preview_next_attempt_at > now()) as "enEspera",
              count(*) filter (where preview_locked_at is not null and preview_locked_at < now() - make_interval(mins => $1::int)) as atascados,
              count(*) filter (where preview_state = -1 and preview_last_error is not null) as rendidos,
              pg_size_pretty(coalesce(sum(bytes) filter (where preview_key is not null),0)) as orig,
              pg_size_pretty(coalesce(sum(preview_bytes) filter (where preview_key is not null),0)) as prev
         from assets where kind = 'video' and deleted_at is null`,
      [workerMx.candadoHuerfanoMin],
    ).catch(() => null);
    // Salud de la tabla a escala: todo esto sale de catálogos/contadores que
    // Postgres ya mantiene solo (pg_stat_user_tables / pg_statio_user_tables /
    // pg_class) — coste O(1), NO recorre `assets` fila a fila. Sirve para ver
    // venir el "se pone lento al crecer" antes de que duela: tabla hinchada
    // (dead tuples sin vacuum), tamaño real de los BYTEA en TOAST, y si
    // heap/índices siguen cayendo en caché o ya empiezan a ir a disco.
    const salud = await one<{
      n_live: string; n_dead: string; seq_scan: string; idx_scan: string | null;
      last_autovacuum: Date | null; last_vacuum: Date | null; autovacuum_count: string;
      heap_size: string; toast_size: string;
      heap_hit: string; heap_read: string; idx_hit: string; idx_read: string;
    }>(
      `select s.n_live_tup::text as n_live, s.n_dead_tup::text as n_dead,
              s.seq_scan::text as seq_scan, s.idx_scan::text as idx_scan,
              s.last_autovacuum, s.last_vacuum, s.autovacuum_count::text as autovacuum_count,
              pg_size_pretty(pg_relation_size('assets'::regclass)) as heap_size,
              pg_size_pretty(coalesce(pg_total_relation_size(c.reltoastrelid),0)) as toast_size,
              coalesce(io.heap_blks_hit,0)::text as heap_hit, coalesce(io.heap_blks_read,0)::text as heap_read,
              coalesce(io.idx_blks_hit,0)::text as idx_hit, coalesce(io.idx_blks_read,0)::text as idx_read
         from pg_stat_user_tables s
         join pg_class c on c.oid = 'assets'::regclass
         left join pg_statio_user_tables io on io.relid = s.relid
        where s.relname = 'assets'`,
    ).catch(() => null);
    const hitRatio = (hit: string, read: string) => {
      const h = Number(hit), r = Number(read);
      return h + r > 0 ? Math.round((h / (h + r)) * 1000) / 10 : null; // %, null si aún no hay lecturas
    };
    return {
      version: VERSION,
      copiasDeReproduccion: pv
        ? {
            listas: Number(pv.listas),
            pendientesAhora: Number(pv.pend),
            enEsperaPorBackoff: Number(pv.enEspera),
            atascadosPendientesDeAutocurar: Number(pv.atascados),
            rendidosTrasReintentos: Number(pv.rendidos),
            pesoOriginales: pv.orig,
            pesoCopias: pv.prev,
            worker: workerMx,
          }
        : null,
      bd: db
        ? {
            tablaAssets: db.total,
            postersEnBd: db.posters,
            miniaturasEnBd: db.thumbs,
            archivos: Number(db.n),
            postersPorDescargar: Number(db.pend),
            // dañados de origen (p. ej. sin átomo moov) — confirmado con ffmpeg,
            // ningún reintento los arregla; se descargan bien pero sin vista previa
            irrecuperables: Number(db.rotos),
          }
        : null,
      saludBd: salud
        ? {
            filasVivas: Number(salud.n_live),
            filasMuertas: Number(salud.n_dead), // muchas = autovacuum no da abasto
            autovacuumEjecutado: Number(salud.autovacuum_count),
            ultimoAutovacuum: salud.last_autovacuum,
            ultimoVacuum: salud.last_vacuum,
            seqScans: Number(salud.seq_scan), // si sube rápido = falta un índice en alguna query
            idxScans: salud.idx_scan ? Number(salud.idx_scan) : 0,
            tablaSinToast: salud.heap_size, // fila "normal" sin los BYTEA grandes
            toast: salud.toast_size, // bytes reales de poster_jpg/thumb_webp en disco
            cacheHitHeap: hitRatio(salud.heap_hit, salud.heap_read), // % — cayendo = la tabla ya no cabe en RAM
            cacheHitIndices: hitRatio(salud.idx_hit, salud.idx_read),
          }
        : null,
      pool: poolStats(), // conexiones vivas/libres/en espera — si "waiting" no baja de 0, el pool se queda corto
      ...(await tgDiag(key, sampleMb)),
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
