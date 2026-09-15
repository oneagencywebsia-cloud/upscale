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
    const q = req.query as { key?: string; big?: string };
    let key = q.key;
    if (!key) {
      // ?big=1: el vídeo más pesado de verdad (para probar sostenida con algo
      // de cientos de MB), en vez del último subido (que puede ser pequeño).
      const r = await one<{ k: string }>(
        q.big
          ? `select original_key k from assets
               where kind = 'video' and stored = true and deleted_at is null
               order by bytes desc limit 1`
          : `select original_key k from assets
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
      ...(await tgDiag(key)),
    };
  });

  // Prueba de velocidad SOSTENIDA por el camino REAL de una descarga (mismo
  // generador con ventana deslizante que /v1/blob/*), transmitiendo una línea
  // JSON por muestra (cada ~3s) a medida que se produce — NO se espera a
  // tenerlo todo antes de responder, porque el proxy delante de la API corta
  // la conexión si no ve ningún byte salir durante ~30s, y una prueba de
  // cientos de MB tarda mucho más que eso. ?mb=N (por defecto 300, máx 2000).
  // ?big=1 usa el vídeo más pesado de la biblioteca; ?key=orig/... uno concreto.
  app.get("/v1/diag/speedtest", async (req, reply) => {
    const { tgSustainedSpeedTest } = await import("../telegram.js");
    const q = req.query as { key?: string; big?: string; mb?: string };
    let key = q.key;
    if (!key) {
      const r = await one<{ k: string }>(
        q.big
          ? `select original_key k from assets
               where kind = 'video' and stored = true and deleted_at is null
               order by bytes desc limit 1`
          : `select original_key k from assets
               where kind = 'video' and stored = true and deleted_at is null
               order by uploaded_at desc limit 1`,
      ).catch(() => null);
      key = r?.k;
    }
    if (!key) return reply.code(404).send({ error: "no hay ningún vídeo para probar" });
    const mb = Math.max(8, Math.min(2000, Number(q.mb) || 300));

    reply.header("Content-Type", "application/x-ndjson");
    reply.header("Cache-Control", "no-cache");
    reply.raw.writeHead(200, reply.getHeaders() as Record<string, string>);
    reply.raw.write(JSON.stringify({ key, mb }) + "\n");
    try {
      for await (const m of tgSustainedSpeedTest(key, mb)) {
        reply.raw.write(JSON.stringify(m) + "\n");
      }
    } catch (e) {
      reply.raw.write(JSON.stringify({ error: (e as Error).message }) + "\n");
    }
    reply.raw.end();
    return reply;
  });

  // URL firmada real (la MISMA que genera la app) para un original concreto —
  // sirve para reproducir exactamente lo que descarga un usuario y verificar
  // el archivo con ffmpeg/ffprobe fuera de la app. ?key=orig/... o ?big=1.
  app.get("/v1/diag/signedurl", async (req, reply) => {
    const { signedUrl } = await import("../storage.js");
    const q = req.query as { key?: string; big?: string };
    let key = q.key;
    if (!key) {
      const r = await one<{ k: string }>(
        q.big
          ? `select original_key k from assets
               where kind = 'video' and stored = true and deleted_at is null
               order by bytes desc limit 1`
          : `select original_key k from assets
               where kind = 'video' and stored = true and deleted_at is null
               order by uploaded_at desc limit 1`,
      ).catch(() => null);
      key = r?.k;
    }
    if (!key) return reply.code(404).send({ error: "no hay ningún vídeo" });
    return { key, url: await signedUrl(key, { expiresIn: 600 }) };
  });

  // TEMPORAL: fuerza preview_bump_at en un vídeo concreto (sin copia lista)
  // para verificar en vivo que el carril urgente de generarPreviews() lo
  // recoge de verdad, incluso simulando que hay "reproducción activa". Quitar
  // una vez confirmado — no debe quedar accesible sin auth a largo plazo.
  app.post("/v1/diag/bump", async (req, reply) => {
    const q = req.query as { key?: string; big?: string };
    let key = q.key;
    if (!key) {
      // preview_state >= 0: si ya se rindió (-1) generarPreviews() nunca lo
      // reclamará, marcarlo con bump sería un test que parece funcionar pero
      // no prueba nada real.
      const r = await one<{ k: string }>(
        `select original_key k from assets
           where kind = 'video' and stored = true and deleted_at is null and preview_key is null
             and preview_state >= 0
             and duration_s is not null and duration_s > 0 and bytes::float8 / duration_s > 1400000
           order by ${q.big ? "bytes" : "uploaded_at"} desc limit 1`,
      ).catch(() => null);
      key = r?.k;
    }
    if (!key) return reply.code(404).send({ error: "no hay ningún vídeo sin copia lista que califique" });
    // si estaba rendido (-1) lo reabre a 0, y preview_next_attempt_at = now()
    // salta el backoff si ya había fallado antes: un bump manual es "quiero
    // que se reintente esto YA", no "en su turno dentro de 30 min".
    const r = await one<{ id: string; preview_state: number }>(
      `update assets set preview_bump_at = now(), preview_state = greatest(preview_state, 0), preview_next_attempt_at = now()
         where original_key = $1 and preview_key is null
         returning id, preview_state`,
      [key],
    ).catch(() => null);
    if (!r) return reply.code(404).send({ error: "no se pudo marcar (ya tiene copia o no existe)" });
    return { ok: true, key, id: r.id, preview_state: r.preview_state };
  });

  // TEMPORAL: inspección directa del estado real de un asset (solo campos de
  // la cola de previews, nada sensible) — para verificar sin adivinar.
  app.get("/v1/diag/asset/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await one(
      `select id, filename, bytes, duration_s, preview_key is not null as tiene_preview,
              preview_state, preview_locked_at, preview_next_attempt_at, preview_bump_at,
              preview_last_error, extract(epoch from now() - preview_locked_at) as candado_hace_s
         from assets where id = $1`,
      [id],
    ).catch((e) => ({ error: (e as Error).message }));
    if (!r) return reply.code(404).send({ error: "no existe" });
    return r;
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
