import { existsSync } from "node:fs";
import type { FastifyReply, FastifyRequest } from "fastify";
import archiver from "archiver";
import { env } from "./env.js";
import { query } from "./db.js";
import { blobToLocalFile } from "./storage.js";

/**
 * Descarga de archivos en ZIP (selección o biblioteca entera).
 *
 * Reglas que se han ido aprendiendo por las malas:
 *  - Un archivo que falla NO tumba el ZIP: se omite y se deja constancia en un
 *    «LEEME» dentro del propio ZIP (así quien descarga sabe qué falta).
 *  - Las cabeceras salen AL INSTANTE, antes del primer archivo: si no, el
 *    navegador no enseña la descarga hasta que Telegram entrega el primero.
 *  - Límite de ZIP simultáneos por persona Y en total (cada uno reserva disco y
 *    ancho de banda). Antes era UNO en todo el servidor: con varias personas, la
 *    segunda recibía un error.
 *  - Zip64 solo cuando hace falta: los ZIP pequeños se abren en cualquier sitio
 *    (Archivos de iOS, Explorador de Windows antiguo, Utilidad de Archivos).
 */

export const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** Nombre seguro dentro del ZIP: sin rutas ni ".." (el nombre viene de la
 *  cabecera X-Filename de quien subió el archivo, no del servidor). */
export function nombreZipSeguro(nm: string): string {
  const base = nm.replace(/[\\/]+/g, "_").replace(/^\.+/, "_").replace(/[\x00-\x1f]/g, "");
  return base.slice(0, 180) || "archivo";
}

// ---------------------------------------------------------------- filtro / filas

export interface ZipFiltro {
  /** ids concretos (selección). null = todo lo que cumpla el resto de filtros */
  ids: string[] | null;
  kind: "photo" | "video" | "audio" | null;
  fav: boolean;
  album: string | null;
  /** mismos filtros que el listado de la galería: lo que se ve filtrado es lo que se baja */
  q: string | null;
  camera: string | null;
  from: string | null;
  to: string | null;
}

export interface ZipFila {
  id: string;
  kind: string;
  filename: string;
  captured_at: Date;
  original_key: string;
  bytes: string;
}

/** Lee el filtro de un body JSON / query. Todo lo raro se descarta. */
export function filtroDe(raw: Record<string, unknown> | undefined | null): ZipFiltro {
  const r = raw ?? {};
  const ids =
    typeof r.ids === "string"
      ? r.ids.split(",")
      : Array.isArray(r.ids)
        ? r.ids.flatMap((x) => (typeof x === "string" ? x.split(",") : []))
        : null;
  const list = ids ? ids.map((s) => s.trim()).filter((s) => ES_UUID.test(s)).slice(0, 50000) : null;
  const kind = r.kind === "photo" || r.kind === "video" || r.kind === "audio" ? r.kind : null;
  const album = typeof r.album === "string" && ES_UUID.test(r.album) ? r.album : null;
  const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
  const fecha = (v: unknown) => {
    const t = txt(v);
    return t && !Number.isNaN(Date.parse(t)) ? t : null;
  };
  return {
    ids: list,
    kind,
    fav: r.fav === true || r.fav === "1" || r.fav === "true",
    album,
    q: txt(r.q),
    camera: txt(r.camera),
    from: fecha(r.from),
    to: fecha(r.to),
  };
}

export async function filasDe(userId: string, f: ZipFiltro): Promise<ZipFila[]> {
  const params: unknown[] = [userId];
  let sql = `select a.id, a.kind, a.filename, a.captured_at, a.original_key, a.bytes
               from assets a where a.user_id = $1 and a.deleted_at is null`;
  if (f.ids) {
    params.push(f.ids);
    sql += ` and a.id = any($${params.length}::uuid[])`;
  }
  if (f.kind) {
    params.push(f.kind);
    sql += ` and a.kind = $${params.length}`;
  }
  if (f.fav) sql += " and a.is_favorite";
  if (f.q) {
    params.push(`%${f.q}%`);
    sql += ` and a.filename ilike $${params.length}`;
  }
  if (f.camera) {
    params.push(f.camera);
    sql += ` and a.camera_make = $${params.length}`;
  }
  if (f.from) {
    params.push(f.from);
    sql += ` and a.captured_at >= $${params.length}::timestamptz`;
  }
  if (f.to) {
    params.push(f.to);
    sql += ` and a.captured_at < $${params.length}::timestamptz`;
  }
  if (f.album) {
    params.push(f.album);
    // la comprobación de dueño va en la propia consulta: un id de álbum ajeno no devuelve nada
    sql += ` and a.id in (select aa.asset_id from album_assets aa join albums al on al.id = aa.album_id
                          where aa.album_id = $${params.length}::uuid and al.user_id = $1)`;
  }
  sql += " order by a.captured_at asc, a.id asc";
  return (await query<ZipFila>(sql, params)).rows;
}

// ---------------------------------------------------------------- partes

export interface ZipParte {
  ids: string[];
  count: number;
  bytes: number;
}

/**
 * Reparte los archivos (en orden) en partes de como mucho `maxBytes`. Un archivo
 * más grande que eso forma su propia parte (no se puede partir un original).
 */
export function repartirEnPartes(rows: Pick<ZipFila, "id" | "bytes">[], maxBytes: number): ZipParte[] {
  const partes: ZipParte[] = [];
  let actual: ZipParte = { ids: [], count: 0, bytes: 0 };
  for (const r of rows) {
    const b = Number(r.bytes) || 0;
    if (actual.count > 0 && actual.bytes + b > maxBytes) {
      partes.push(actual);
      actual = { ids: [], count: 0, bytes: 0 };
    }
    actual.ids.push(r.id);
    actual.count++;
    actual.bytes += b;
  }
  if (actual.count > 0) partes.push(actual);
  return partes;
}

// ---------------------------------------------------------------- cupos

const zipsPorUsuario = new Map<string, number>();
let zipsTotal = 0;

export type Hueco = { ok: true; soltar: () => void } | { ok: false; status: 409 | 429; error: string };

function cogerHuecoZip(userId: string): Hueco {
  const mios = zipsPorUsuario.get(userId) ?? 0;
  if (mios >= env.ZIP_MAX_PER_USER) {
    return { ok: false, status: 409, error: "Ya tienes una descarga en marcha. Espera a que termine (o ciérrala) y vuelve a intentarlo." };
  }
  if (zipsTotal >= env.ZIP_MAX_CONCURRENT) {
    return { ok: false, status: 429, error: "Hay muchas descargas ahora mismo. Inténtalo de nuevo en un minuto." };
  }
  zipsPorUsuario.set(userId, mios + 1);
  zipsTotal++;
  let suelto = false;
  return {
    ok: true,
    soltar: () => {
      if (suelto) return;
      suelto = true;
      zipsTotal--;
      const n = (zipsPorUsuario.get(userId) ?? 1) - 1;
      if (n <= 0) zipsPorUsuario.delete(userId);
      else zipsPorUsuario.set(userId, n);
    },
  };
}

// ---------------------------------------------------------------- el ZIP

export interface ZipOpciones {
  /** «parte 2 de 5»: solo cambia el nombre del archivo descargado */
  parte?: { n: number; de: number } | null;
}

export async function servirZip(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  filtro: ZipFiltro,
  opciones: ZipOpciones = {},
): Promise<void> {
  if (filtro.ids && !filtro.ids.length) {
    reply.code(400).send({ error: "ningún id válido" });
    return;
  }

  const hueco = cogerHuecoZip(userId);
  if (!hueco.ok) {
    reply.code(hueco.status);
    if (hueco.status === 429) reply.header("Retry-After", "60");
    reply.send({ error: hueco.error });
    return;
  }

  let rows: ZipFila[];
  try {
    rows = await filasDe(userId, filtro);
  } catch (e) {
    hueco.soltar();
    req.log.error({ err: (e as Error)?.message }, "zip: consulta");
    reply.code(500).send({ error: "no se pudo preparar la descarga" });
    return;
  }
  if (!rows.length) {
    hueco.soltar();
    reply.code(404).send({ error: "nada que descargar" });
    return;
  }

  const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10);
  const d1 = ymd(rows[0]!.captured_at);
  const d2 = ymd(rows[rows.length - 1]!.captured_at);
  let name = (d1 === d2 ? `Recuerdos ${d1}` : `Recuerdos del ${d1} al ${d2}`).replace(/[^\w .\-]/g, "");
  if (opciones.parte && opciones.parte.de > 1) name += ` (parte ${opciones.parte.n} de ${opciones.parte.de})`;

  // Zip64 solo si hace falta (>= ~3,5 GB en total o algún archivo así de grande).
  const totalBytes = rows.reduce((n, r) => n + (Number(r.bytes) || 0), 0);
  const hayGrande = rows.some((r) => Number(r.bytes) > 3.5 * GB);
  const zip64 = totalBytes > 3.5 * GB || hayGrande;

  try {
    reply.hijack(); // tomamos el socket: escribimos el ZIP a mano en reply.raw
    reply.raw.statusCode = 200;
    reply.raw.setHeader("Content-Type", "application/zip");
    reply.raw.setHeader(
      "Content-Disposition",
      `attachment; filename="${name}.zip"; filename*=UTF-8''${encodeURIComponent(name)}.zip`,
    );
    reply.raw.setHeader("Cache-Control", "no-store");
    reply.raw.setHeader("X-Content-Type-Options", "nosniff");
    // cabeceras YA: el navegador enseña la descarga (y su «preparando…») sin esperar al primer archivo
    reply.raw.flushHeaders();

    const archive = archiver("zip", { store: true, forceZip64: zip64 });
    archive.on("warning", (e) => req.log.warn({ err: e.message }, "zip: warning"));
    archive.on("error", (e) => {
      req.log.error({ err: e.message }, "zip: error");
      reply.raw.destroy();
    });
    archive.pipe(reply.raw);

    const used = new Set<string>();
    let added = 0;
    const omitidos: string[] = [];

    // Si el navegador corta la descarga hay que parar DE VERDAD: sin esto
    // seguían corriendo las descargas de la ventana de prefetch (varios GB cada
    // una) para un ZIP que ya no lee nadie.
    let abortado = false;
    let terminado = false; // el bucle ya no va a usar más archivos
    let despertar: (() => void) | null = null; // para sacar al bucle de la espera de la entrada en curso
    reply.raw.once("close", () => {
      abortado = true;
      // El navegador se fue: se libera el hueco YA (otro ZIP de la misma persona
      // no debe esperar a que acabe la limpieza) y se despierta al bucle.
      hueco.soltar();
      try {
        archive.abort();
      } catch {
        /* ya cerrado */
      }
      despertar?.();
    });

    // La caché de disco de Telegram la limpia pruneCache() por antigüedad y no
    // sabe nada de este ZIP: pinCachedFile() marca el archivo «en uso» mientras
    // dura su entrada. Solo aplica al motor telegram.
    const pin: ((p: string) => () => void) | null =
      env.STORAGE_DRIVER === "telegram"
        ? await import("./telegram.js").then((m) => m.pinCachedFile).catch(() => null)
        : null;

    // Ventana de prefetch: se bajan varios archivos a la vez mientras el ZIP
    // escribe el anterior. Con fotos (lo normal) el tiempo se va en la latencia
    // de cada petición, no en los bytes: por eso hasta 6 en paralelo. Con
    // originales enormes manda el presupuesto de BYTES en vuelo (sacado del
    // espacio libre real, repartido entre los ZIP que puede haber a la vez) y
    // como mucho 2 «grandes» (>256 MB) a la vez.
    const CONC = 6;
    const GRANDE = 256 * MB;
    let presupuesto = 8 * GB; // suelo razonable si statfs falla
    try {
      const { statfs } = await import("node:fs/promises");
      const dir = env.STORAGE_DRIVER === "telegram" ? env.TG_CACHE_DIR : env.STORAGE_DIR;
      const s = await statfs(dir);
      const libre = s.bavail * s.bsize;
      presupuesto = Math.min(64 * GB, Math.max(2 * GB, Math.floor((libre * 0.5) / env.ZIP_MAX_CONCURRENT)));
    } catch {
      /* sistema de archivos raro: nos quedamos con el suelo */
    }

    const inflight = new Map<number, Promise<string | null>>();
    const enVuelo = new Map<number, number>(); // índice -> bytes reservados
    const pins = new Map<number, () => void>(); // índice -> soltar el pin
    const bytesEnVuelo = () => [...enVuelo.values()].reduce((n, x) => n + x, 0);
    const grandesEnVuelo = () => [...enVuelo.values()].filter((x) => x > GRANDE).length;
    const kickoff = (i: number) => {
      if (i >= rows.length || inflight.has(i) || abortado) return;
      const b = Number(rows[i]!.bytes) || 0;
      // SIEMPRE se permite al menos una descarga, aunque ese archivo solo ya se
      // salga del presupuesto — si no, un vídeo más grande que el presupuesto no
      // se descargaría nunca y el ZIP se quedaría colgado.
      if (inflight.size > 0 && bytesEnVuelo() + b > presupuesto) return;
      if (inflight.size > 0 && b > GRANDE && grandesEnVuelo() >= 2) return;
      enVuelo.set(i, b);
      inflight.set(
        i,
        blobToLocalFile(rows[i]!.original_key)
          .then((p) => {
            // pin EN CUANTO está en disco, no al llegarle el turno; y no si el
            // bucle ya cortó (ese pin quedaría colgado para siempre)
            if (p && pin && !terminado && !pins.has(i)) pins.set(i, pin(p));
            return p;
          })
          .catch(() => null),
      );
    };
    const soltarPin = (i: number) => {
      pins.get(i)?.();
      pins.delete(i);
    };
    for (let i = 0; i < CONC; i++) kickoff(i);

    const nameFor = (r: { filename: string; kind: string; id: string }) => {
      let nm = nombreZipSeguro(r.filename || `${r.kind}_${r.id}`);
      if (!/\.[a-z0-9]{2,5}$/i.test(nm)) nm += r.kind === "video" ? ".mov" : r.kind === "audio" ? ".m4a" : ".jpg";
      if (used.has(nm.toLowerCase())) {
        const dot = nm.lastIndexOf(".");
        const stem = dot > 0 ? nm.slice(0, dot) : nm;
        const ext = dot > 0 ? nm.slice(dot) : "";
        let k = 2;
        while (used.has(`${stem}_${k}${ext}`.toLowerCase())) k++;
        nm = `${stem}_${k}${ext}`;
      }
      // en minúsculas: Windows y macOS no distinguen mayúsculas y «IMG_1.JPG» / «img_1.jpg» chocarían
      used.add(nm.toLowerCase());
      return nm;
    };

    for (let i = 0; i < rows.length; i++) {
      if (abortado || reply.raw.destroyed) break;
      const r = rows[i]!;
      if (!inflight.has(i)) kickoff(i); // el presupuesto pudo dejarlo fuera antes
      const local = await inflight.get(i)!;
      inflight.delete(i);
      enVuelo.delete(i);
      // rellenar la ventana: puede entrar más de uno si los que acaban de salir liberaron presupuesto
      for (let j = i + 1; j < Math.min(rows.length, i + 1 + CONC); j++) kickoff(j);

      // El archivo puede haber desaparecido entre la descarga y su turno (limpieza
      // de caché agresiva, borrado manual): se reintenta una vez y, si aún no
      // está, se salta y el ZIP continúa con el resto.
      let ruta = local;
      if (ruta && !existsSync(ruta)) {
        req.log.warn({ id: r.id }, "zip: el original ya no estaba en disco, se rebaja de nuevo");
        ruta = await blobToLocalFile(r.original_key).catch(() => null);
        if (ruta && pin && !pins.has(i)) pins.set(i, pin(ruta));
        if (ruta && !existsSync(ruta)) ruta = null;
      }
      if (!ruta) {
        soltarPin(i);
        omitidos.push(r.filename || `${r.kind}_${r.id}`);
        req.log.warn({ id: r.id }, "zip: archivo omitido");
        continue;
      }
      const local2 = ruta;
      const nm = nameFor(r);
      try {
        await new Promise<void>((resolve) => {
          // Espera a que archiver TERMINE esta entrada antes de seguir: es lo que
          // mantiene la ventana de prefetch en su sitio. El criterio para
          // abandonar es PROGRESO, no tiempo: mientras el ZIP siga escribiendo
          // bytes se espera lo que haga falta (20 GB no caben en 2 minutos);
          // solo se abandona tras 10 minutos sin escribir ni un byte.
          let ultimo = archive.pointer();
          let quieto = 0;
          let iv: ReturnType<typeof setInterval> | null = null;
          const done = () => {
            if (iv) clearInterval(iv);
            iv = null;
            despertar = null;
            archive.off("entry", done);
            archive.off("error", done);
            resolve();
          };
          iv = setInterval(() => {
            if (abortado || reply.raw.destroyed) return done();
            const ahora = archive.pointer();
            if (ahora > ultimo) {
              ultimo = ahora;
              quieto = 0;
              return;
            }
            if (++quieto >= 20) {
              req.log.warn({ id: r.id, nm }, "zip: entrada sin progreso 10 min, se abandona");
              omitidos.push(nm);
              done();
            }
          }, 30_000);
          despertar = done;
          archive.once("entry", done);
          archive.once("error", done);
          archive.file(local2, { name: nm, date: new Date(r.captured_at) });
        });
      } finally {
        soltarPin(i);
      }
      added++;
    }

    // soltar los pines que queden (ventana de prefetch al cortar, archivos
    // saltados): si no, quedarían intocables para el limpiador de caché PARA SIEMPRE
    terminado = true;
    for (const i of [...pins.keys()]) soltarPin(i);
    req.log.info({ userId, added, omitidos: omitidos.length, zip64 }, "zip: finalizando");

    try {
      if (abortado || reply.raw.destroyed) archive.abort();
      else {
        if (omitidos.length) {
          // constancia dentro del propio ZIP: qué no pudo incluirse y qué hacer
          const lista = omitidos.slice(0, 500).map((n) => `  - ${n}`).join("\r\n");
          const resto = omitidos.length > 500 ? `\r\n  … y ${omitidos.length - 500} más` : "";
          const txt =
            `Algunos archivos no se pudieron incluir en este ZIP (${omitidos.length}).\r\n` +
            `Suele ser algo temporal: vuelve a pedir la descarga de esos archivos y entrarán.\r\n\r\n` +
            `${lista}${resto}\r\n`;
          archive.append(Buffer.from(txt, "utf8"), { name: "LEEME - archivos omitidos.txt" });
        }
        await archive.finalize();
      }
    } catch (e) {
      req.log.warn({ err: (e as Error)?.message }, "zip: cierre con incidencias");
      if (!reply.raw.destroyed) reply.raw.destroy();
    }
  } catch (e) {
    // ya se mandaron cabeceras: lo único honesto es cortar (el navegador lo ve como descarga fallida)
    req.log.error({ err: (e as Error)?.message }, "zip: fallo inesperado");
    if (!reply.raw.destroyed) reply.raw.destroy();
  } finally {
    hueco.soltar();
  }
}
