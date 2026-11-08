import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { one, query } from "../db.js";
import { env } from "../env.js";
import { requireUser, principalOf } from "../auth.js";
import { readBlob } from "../storage.js";

/**
 * «Revisar mis archivos»: explica POR QUÉ algo no carga o no se descarga, con datos reales de ESTA cuenta.
 *  1. Cuenta, por causa, los archivos con algo raro en la base de datos (sin miniatura, sin original registrado…).
 *  2. Prueba de verdad una muestra al azar: lee un byte del original en el almacén y lo mide.
 *  3. Dice cómo está la caché del servidor (si se vació en el último despliegue, las miniaturas tardan en volver).
 * Es de solo lectura; arreglar es otra llamada, explícita (`/repair`). Solo toca los archivos del propio usuario.
 */

type Ejemplo = { id: string; nombre: string };
type Problema = { codigo: string; titulo: string; detalle: string; n: number; ejemplos: Ejemplo[]; arreglable: boolean };

const MUESTRA = 16;
const PLAZO_MS = 20_000;
const ultimaPasada = new Map<string, number>();

/** Mensaje técnico → frase que entiende cualquiera. */
export function motivoDe(msg: string): string {
  if (/tiempo|timeout|timed out/i.test(msg)) return "El almacén tarda demasiado en responder";
  if (/flood|wait of \d+/i.test(msg)) return "Telegram pide esperar un poco antes de seguir";
  if (/no registrado/i.test(msg)) return "El archivo no está registrado en el almacén";
  if (/mensaje.*no encontrado|MESSAGE_ID|not found/i.test(msg)) return "El archivo ya no está en el almacén";
  if (/AUTH|SESSION|unauthor/i.test(msg)) return "La conexión con el almacén está caída";
  if (/ENOENT/i.test(msg)) return "Falta el archivo en el disco";
  return "El almacén no lo entregó";
}

async function probarOriginal(key: string): Promise<{ ms: number; bytes: number; total: number }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const plazo = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("tiempo de espera agotado")), PLAZO_MS);
  });
  try {
    const leer = (async () => {
      let stream: NodeJS.ReadableStream & { destroy?: () => void };
      let total = 0;
      if (env.STORAGE_DRIVER === "telegram") {
        // lectura directa de UN trozo: sin readBlob/tgRead para no lanzar la precarga completa del original
        const { tgReadRangeLive } = await import("../telegram.js");
        const r = await tgReadRangeLive(key, 0, 0);
        stream = r.stream;
        total = r.totalSize;
      } else {
        const r = await readBlob(key, { start: 0, end: 0 });
        stream = r.stream;
        total = r.totalSize;
      }
      let bytes = 0;
      for await (const chunk of stream) {
        bytes += (chunk as Buffer).length;
        break;
      }
      stream.destroy?.();
      return { ms: Date.now() - t0, bytes, total };
    })();
    return await Promise.race([leer, plazo]);
  } finally {
    clearTimeout(timer);
  }
}

async function estadoCache(): Promise<{ archivos: number; mb: number }> {
  let archivos = 0;
  let bytes = 0;
  for (const dir of [env.TG_CACHE_DIR, join(env.TG_CACHE_DIR, "thumbs")]) {
    const nombres = await readdir(dir).catch(() => [] as string[]);
    for (const n of nombres) {
      const s = await stat(join(dir, n)).catch(() => null);
      if (s?.isFile()) {
        archivos++;
        bytes += s.size;
      }
    }
  }
  return { archivos, mb: Math.round(bytes / 1048576) };
}

export async function fileCheckRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/me/files/check", { preHandler: requireUser }, async (req, reply) => {
    const { userId } = principalOf(req);
    const hace = Date.now() - (ultimaPasada.get(userId) ?? 0);
    if (hace < 20_000) {
      return reply.code(429).send({ error: `Espera ${Math.ceil((20_000 - hace) / 1000)} s antes de volver a revisar.` });
    }
    ultimaPasada.set(userId, Date.now());

    const tot = await one<{ total: string; fotos: string; videos: string; audios: string }>(
      `select count(*) total,
              count(*) filter (where kind = 'photo') fotos,
              count(*) filter (where kind = 'video') videos,
              count(*) filter (where kind = 'audio') audios
         from assets where user_id = $1 and deleted_at is null`,
      [userId],
    );

    // cada causa: cuántos + 5 ejemplos. Las condiciones van aparte para contar y para listar con la misma regla.
    const reglas: { codigo: string; titulo: string; detalle: string; arreglable: boolean; donde: string }[] = [
      {
        codigo: "sin_guardar",
        titulo: "Todavía se están guardando",
        detalle: "Aún no han terminado de pasar al almacén. Es normal justo después de subirlos; si pasan horas, avísanos.",
        arreglable: false,
        donde: "not stored",
      },
      {
        codigo: "original_perdido",
        titulo: "Sin original en el almacén",
        detalle: "La ficha existe pero el almacén no tiene el original registrado: al descargarlos da error.",
        arreglable: false,
        donde: `stored and not unrecoverable
          and not exists (select 1 from blob_refs br where br.key = a.original_key)
          and not exists (select 1 from blob_parts bp where bp.key = a.original_key)`,
      },
      {
        codigo: "sin_miniatura",
        titulo: "Sin miniatura",
        detalle: "Se ven en blanco o con un cuadro gris en la biblioteca.",
        arreglable: false,
        donde: `kind in ('photo','video') and not unrecoverable
          and octet_length(coalesce(thumb_webp, ''::bytea)) <= 4
          and not exists (select 1 from blob_refs br where br.key = a.thumb_key)`,
      },
      {
        codigo: "danados",
        titulo: "Marcados como dañados",
        detalle: "Upscale no consiguió leerlos tras varios intentos (suelen llegar rotos desde el móvil). Se pueden volver a intentar.",
        arreglable: true,
        donde: "unrecoverable and kind in ('photo','video')",
      },
      {
        codigo: "sin_copia_ligera",
        titulo: "Vídeos sin vista previa",
        detalle: "Se abren lento o se cortan porque no tienen copia ligera. Se pueden volver a intentar.",
        arreglable: true,
        donde: "kind = 'video' and preview_key is null and preview_state = -1",
      },
    ];
    const problemas: Problema[] = [];
    for (const r of reglas) {
      const base = `from assets a where user_id = $1 and deleted_at is null and (${r.donde})`;
      const n = Number((await one<{ n: string }>(`select count(*) n ${base}`, [userId]).catch(() => null))?.n ?? 0);
      if (!n) continue;
      const ej = await query<{ id: string; filename: string }>(
        `select id, filename ${base} order by uploaded_at desc limit 5`,
        [userId],
      ).catch(() => ({ rows: [] as { id: string; filename: string }[] }));
      problemas.push({
        codigo: r.codigo,
        titulo: r.titulo,
        detalle: r.detalle,
        n,
        ejemplos: ej.rows.map((x) => ({ id: x.id, nombre: x.filename })),
        arreglable: r.arreglable,
      });
    }

    // prueba real sobre una muestra al azar
    const muestra = (
      await query<{ id: string; filename: string; kind: string; original_key: string; bytes: string }>(
        `select id, filename, kind, original_key, bytes from assets
          where user_id = $1 and deleted_at is null and stored and not unrecoverable
          order by random() limit ${MUESTRA}`,
        [userId],
      ).catch(() => ({ rows: [] as { id: string; filename: string; kind: string; original_key: string; bytes: string }[] }))
    ).rows;
    const items: { nombre: string; tipo: string; ok: boolean; ms: number; motivo?: string; tecnico?: string }[] = [];
    const cola = [...muestra];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        for (let a = cola.shift(); a; a = cola.shift()) {
          try {
            const r = await probarOriginal(a.original_key);
            const distinto = r.total > 0 && Number(a.bytes) > 0 && r.total !== Number(a.bytes);
            items.push({
              nombre: a.filename,
              tipo: a.kind,
              ok: r.bytes > 0 && !distinto,
              ms: r.ms,
              ...(distinto
                ? { motivo: "El tamaño guardado no coincide con el de la ficha", tecnico: `almacén ${r.total} B · ficha ${a.bytes} B` }
                : r.bytes === 0
                  ? { motivo: "El almacén respondió vacío", tecnico: "0 bytes" }
                  : {}),
            });
          } catch (e) {
            const m = (e as Error)?.message ?? String(e);
            items.push({ nombre: a.filename, tipo: a.kind, ok: false, ms: 0, motivo: motivoDe(m), tecnico: m.slice(0, 160) });
          }
        }
      }),
    );

    const cache = await estadoCache();
    return {
      resumen: {
        total: Number(tot?.total ?? 0),
        fotos: Number(tot?.fotos ?? 0),
        videos: Number(tot?.videos ?? 0),
        audios: Number(tot?.audios ?? 0),
      },
      problemas,
      muestra: { probados: items.length, fallidos: items.filter((i) => !i.ok).length, items },
      servidor: {
        almacen: env.STORAGE_DRIVER,
        minutosEncendido: Math.round(process.uptime() / 60),
        cacheArchivos: cache.archivos,
        cacheMB: cache.mb,
      },
    };
  });

  /** Vuelve a intentar lo que se rindió. Solo del propio usuario y con tope. */
  app.post("/v1/me/files/repair", { preHandler: requireUser }, async (req) => {
    const { userId } = principalOf(req);
    const previews = await query(
      `update assets set preview_state = 0, preview_next_attempt_at = now(), preview_last_error = null
        where user_id = $1 and kind = 'video' and preview_key is null and preview_state = -1 and deleted_at is null`,
      [userId],
    );
    // dañados: se quita la marca y la miniatura de aviso para que el barrido de fondo los regenere (3 intentos más)
    const ids = (
      await query<{ id: string }>(
        `select id from assets
          where user_id = $1 and unrecoverable and stored and kind in ('photo','video') and deleted_at is null
          order by uploaded_at desc limit 200`,
        [userId],
      )
    ).rows.map((r) => r.id);
    if (ids.length) {
      await query(
        "update assets set unrecoverable = false, poster_jpg = null, thumb_webp = null where id = any($1::uuid[])",
        [ids],
      );
      await query("delete from kv where k = any($1::text[])", [ids.map((id) => `ingest:bf:${id}`)]).catch(() => {});
    }
    return { previewsReabiertas: previews.rowCount ?? 0, danadosReintentados: ids.length };
  });
}
