import { execFile } from "node:child_process";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ping, one, query, poolStats } from "../db.js";
import { env, VERSION } from "../env.js";
import { requireUploadToken, principalOf } from "../auth.js";
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

/**
 * Todo lo de /v1/diag/* y /v1/ingest/* exige identidad. Antes NO la exigía, y
 * eso era un agujero de verdad, no teórico:
 *  - /v1/diag/signedurl?key=orig/<cualquiera> devolvía a CUALQUIERA en
 *    internet una URL firmada válida para descargar ese archivo (la firma la
 *    pone el servidor: no hace falta conocer BLOB_SECRET).
 *  - /v1/ingest/skip (POST, sin cuerpo) descartaba el inbox pendiente →
 *    pérdida de datos a un `curl` de distancia.
 *  - /v1/diag/speedtest?mb=2000 bajaba 2 GB de Telegram por llamada.
 *  - /v1/diag/tools lanzaba 7 procesos por llamada.
 * Se usa requireUploadToken (sesión Supabase O `X-Upload-Token`) a propósito:
 * cierra el acceso anónimo sin romper el diagnóstico por curl, que puede
 * seguir usando el mismo token del Atajo de iOS que ya existe.
 */
const soloDueno = { preHandler: requireUploadToken } as const;

/** ¿esa key es de un archivo de ESTE usuario? (evita firmar/inspeccionar lo ajeno) */
async function keyDelUsuario(userId: string, key: string): Promise<boolean> {
  const r = await one<{ x: number }>(
    // `$2::text` explícito: sin el cast, Postgres no puede inferir el tipo del
    // parámetro dentro de un IN (...) y falla con "could not determine data
    // type of parameter $2" — el .catch() se lo tragaría y ?key= dejaría de
    // funcionar en silencio.
    `select 1 x from assets
      where user_id = $1 and deleted_at is null
        and $2::text in (original_key, thumb_key, coalesce(poster_key, ''),
                         coalesce(preview_key, ''), coalesce(live_video_key, ''))
      limit 1`,
    [userId, key],
  ).catch(() => null);
  return !!r;
}

/**
 * Key a diagnosticar: la de `?key=` (solo si es del propio usuario) o, si no
 * se pasa ninguna, el vídeo más pesado (`?big=1`) o el más reciente DE ESTE
 * USUARIO. Antes cogía el último vídeo de la tabla entera, de quien fuera.
 */
async function keyDiag(req: FastifyRequest): Promise<string | null> {
  const { userId } = principalOf(req);
  const q = req.query as { key?: string; big?: string };
  if (typeof q.key === "string" && q.key) {
    return (await keyDelUsuario(userId, q.key)) ? q.key : null;
  }
  const r = await one<{ k: string }>(
    `select original_key k from assets
       where user_id = $1 and kind = 'video' and stored = true and deleted_at is null
       order by ${q.big ? "bytes desc" : "uploaded_at desc"} limit 1`,
    [userId],
  ).catch(() => null);
  return r?.k ?? null;
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/healthz", async (_req, reply) => {
    const db = await ping();
    return reply.code(db ? 200 : 503).send({ ok: db, version: VERSION });
  });

  // qué herramientas de imagen hay en el contenedor (para depurar HEIC/rotación)
  app.get("/v1/diag/tools", soloDueno, async () => ({
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
  app.get("/v1/diag/storage", soloDueno, async (req) => {
    const { tgDiag } = await import("../telegram.js");
    // ?big=1: el vídeo más pesado de verdad (para probar sostenida con algo
    // de cientos de MB), en vez del último subido (que puede ser pequeño).
    const key = (await keyDiag(req)) ?? undefined;
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
    // originales troceados (superaron el tope de Telegram por documento y se
    // subieron en varias partes, ver putSplit/blob_parts) — para comprobar
    // en producción que el troceado se está usando de verdad.
    const troceados = await one<{ n: string; partes: string }>(
      `select count(distinct key) as n, count(*) as partes from blob_parts`,
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
            originalesTroceados: troceados ? { archivos: Number(troceados.n), partes: Number(troceados.partes) } : null,
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
  app.get("/v1/diag/speedtest", soloDueno, async (req, reply) => {
    const { tgSustainedSpeedTest } = await import("../telegram.js");
    const q = req.query as { mb?: string; streams?: string };
    const key = await keyDiag(req);
    if (!key) return reply.code(404).send({ error: "no hay ningún vídeo para probar" });
    const mb = Math.max(8, Math.min(2000, Number(q.mb) || 300));
    // ?streams=N: para MEDIR con distintos números de conexiones paralelas
    // antes de decidir el valor por defecto real, en vez de adivinar.
    const streams = q.streams ? Math.max(1, Math.min(32, Number(q.streams) || 0)) : undefined;

    reply.header("Content-Type", "application/x-ndjson");
    reply.header("Cache-Control", "no-cache");
    reply.raw.writeHead(200, reply.getHeaders() as Record<string, string>);
    reply.raw.write(JSON.stringify({ key, mb, streams: streams ?? "env" }) + "\n");
    try {
      for await (const m of tgSustainedSpeedTest(key, mb, streams)) {
        // Si quien lanzó la prueba cierra la pestaña, parar YA: sin esto, el
        // generador seguía bajando hasta 2 GB de Telegram para nadie, comiendo
        // el ancho de banda de quien sí esté viendo algo.
        if (reply.raw.destroyed) break;
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
  app.get("/v1/diag/signedurl", soloDueno, async (req, reply) => {
    const { signedUrl } = await import("../storage.js");
    const key = await keyDiag(req);
    if (!key) return reply.code(404).send({ error: "no hay ningún vídeo" });
    return { key, url: await signedUrl(key, { expiresIn: 600 }) };
  });


  // TEMPORAL: inspección directa del estado real de un asset (solo campos de
  // la cola de previews, nada sensible) — para verificar sin adivinar.
  app.get("/v1/diag/asset/:id", soloDueno, async (req, reply) => {
    const { userId } = principalOf(req);
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(400).send({ error: "id inválido" });
    const r = await one(
      `select id, filename, bytes, duration_s, preview_key is not null as tiene_preview,
              preview_state, preview_locked_at, preview_next_attempt_at, preview_bump_at,
              preview_last_error, extract(epoch from now() - preview_locked_at) as candado_hace_s
         from assets where id = $1 and user_id = $2`,
      [id, userId],
    ).catch((e) => ({ error: (e as Error).message }));
    if (!r) return reply.code(404).send({ error: "no existe" });
    return r;
  });

  // diagnóstico de la ingesta desde Telegram (sin datos sensibles)
  app.get("/v1/ingest/status", soloDueno, async () => {
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
  app.post("/v1/ingest/run", soloDueno, async () => {
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
  app.post("/v1/ingest/skip", soloDueno, async () => {
    const r = await ingestSkipPending(app.log);
    return { ok: true, ...r };
  });

  // quita la pausa por FLOOD_WAIT y hace una vuelta ya
  app.post("/v1/ingest/resume", soloDueno, async () => {
    ingestResume();
    await ingestTickNow(app.log);
    return { ok: true, lastTickError: ingestState.lastTickError, totalImported: ingestState.totalImported };
  });

  // reabre las copias de reproducción que se habían rendido (preview_state=-1)
  // tras agotar sus reintentos — pensado para después de un fix real en el
  // descargador (antes, un solo fallo transitorio en cualquiera de las
  // conexiones paralelas tiraba TODO el progreso de un original grande, así
  // que los vídeos más largos/pesados eran los que más fácil acababan aquí).
  // Solo del propio usuario, y solo vídeos sin copia todavía.
  app.post("/v1/diag/previews/reabrir", soloDueno, async (req) => {
    const { userId } = principalOf(req);
    const r = await query(
      `update assets set preview_state = 0, preview_next_attempt_at = now(), preview_last_error = null
         where user_id = $1 and kind = 'video' and preview_key is null and preview_state = -1 and deleted_at is null`,
      [userId],
    );
    return { reabiertos: r.rowCount ?? 0 };
  });

  // vídeos cuyo contenedor llegó roto de origen (duration_s nunca se pudo
  // rellenar, ni siquiera con el barrido de fondo que reintenta durante días)
  // — el mismo patrón confirmado a mano con ffprobe ("moov atom not found")
  // en varios archivos de nombre no-iPhone. Solo lectura: no borra nada.
  app.get("/v1/diag/videos-rotos", soloDueno, async (req) => {
    const { userId } = principalOf(req);
    const rows = await query<{ id: string; filename: string; bytes: string; uploaded_at: Date }>(
      `select id, filename, bytes, uploaded_at from assets
         where user_id = $1 and kind = 'video' and duration_s is null and deleted_at is null
         order by uploaded_at desc`,
      [userId],
    );
    return { n: rows.rowCount ?? 0, items: rows.rows.map((r) => ({ id: r.id, filename: r.filename, bytes: Number(r.bytes) })) };
  });
}
