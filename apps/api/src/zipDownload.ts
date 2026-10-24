import { existsSync } from "node:fs";
import type { FastifyReply, FastifyRequest } from "fastify";
import archiver from "archiver";
import { env } from "./env.js";
import { query } from "./db.js";
import { blobToLocalFile } from "./storage.js";
import { prepararEntrega, planCompat, bytesCompat, type ArchivoEntregable } from "./compat.js";
import { rm } from "node:fs/promises";

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
  orientation: "vertical" | "horizontal" | "cuadrada" | null;
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
  codec: string | null;
  duration_s: string | null;
  preview_key: string | null;
  preview_bytes: string | null;
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
    orientation: r.orientation === "vertical" || r.orientation === "horizontal" || r.orientation === "cuadrada" ? r.orientation : null,
    from: fecha(r.from),
    to: fecha(r.to),
  };
}

export async function filasDe(userId: string, f: ZipFiltro): Promise<ZipFila[]> {
  const params: unknown[] = [userId];
  let sql = `select a.id, a.kind, a.filename, a.captured_at, a.original_key, a.bytes,
                      a.codec, a.duration_s, a.preview_key, a.preview_bytes
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
  if (f.orientation) {
    params.push(f.orientation);
    sql += ` and a.orientation = $${params.length}`;
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

// ---------------------------------------------------------------- progreso

/**
 * Progreso de cada ZIP, para la barra de la web. La descarga la gestiona el
 * navegador (en iPhone, el gestor de descargas del sistema) y la página no
 * puede medirla, así que lo mide el servidor: la web manda un `job` (uuid) con
 * la petición y pregunta por él cada poco. Los bytes «enviados» salen del propio
 * ZIP, que solo avanza al ritmo de quien descarga (contrapresión del socket).
 */
export type EtapaZip = "preparando" | "enviando" | "listo" | "error" | "cancelado";

export interface ProgresoZip {
  etapa: EtapaZip;
  /** archivos que entran en el ZIP / ya metidos */
  total: number;
  hechos: number;
  /** bytes de los archivos / ya escritos en el ZIP */
  bytesTotal: number;
  bytesEnviados: number;
  omitidos: number;
  parte: { n: number; de: number } | null;
  error: string | null;
}

interface Trabajo extends ProgresoZip {
  userId: string;
  t: number;
}

const trabajos = new Map<string, Trabajo>();
const TTL_MS = 15 * 60 * 1000;
setInterval(() => {
  const limite = Date.now() - TTL_MS;
  for (const [id, j] of trabajos) if (j.t < limite) trabajos.delete(id);
}, 60_000).unref();

function nuevoTrabajo(job: string | null, userId: string, parte: ZipOpciones["parte"]): Trabajo | null {
  if (!job) return null;
  const j: Trabajo = {
    userId,
    t: Date.now(),
    etapa: "preparando",
    total: 0,
    hechos: 0,
    bytesTotal: 0,
    bytesEnviados: 0,
    omitidos: 0,
    parte: parte ?? null,
    error: null,
  };
  trabajos.set(job, j);
  return j;
}

function fallar(j: Trabajo | null, error: string): void {
  if (!j) return;
  j.etapa = "error";
  j.error = error;
  j.t = Date.now();
}

/** Lo que ve la web. null = no existe o no es tuyo (misma respuesta: no se filtra nada). */
export function progresoDe(job: string, userId: string): ProgresoZip | null {
  const j = trabajos.get(job);
  if (!j || j.userId !== userId) return null;
  const { userId: _u, t: _t, ...pub } = j;
  void _u;
  void _t;
  return pub;
}

// ---------------------------------------------------------------- LEEME

/** Texto del LEEME.txt que acompaña al ZIP (solo si hay algo que contar). */
export function textoLeeme(o: { compat: boolean; convertidos: number; notas: string[]; omitidos: string[] }): string | null {
  const partes: string[] = [];
  if (o.compat && o.convertidos > 0) {
    partes.push(
      `Descarga en formato COMPATIBLE: ${o.convertidos === 1 ? "1 archivo se convirtió" : `${o.convertidos} archivos se convirtieron`} para que se abra en cualquier aparato ` +
        `(fotos HEIC/HEIF/AVIF/TIFF/DNG a JPG, vídeos HEVC/otros a MP4, audios CAF/AMR/WMA… a MP3).\r\n` +
        `Si necesitas el archivo EXACTO (para editar o archivar), vuelve a descargar eligiendo «Originales».`,
    );
  }
  if (o.notas.length) {
    partes.push(`No se pudieron convertir (se incluye el original):\r\n${o.notas.slice(0, 200).map((n) => `  - ${n}`).join("\r\n")}`);
  }
  if (o.omitidos.length) {
    const resto = o.omitidos.length > 500 ? `\r\n  … y ${o.omitidos.length - 500} más` : "";
    partes.push(
      `Algunos archivos no se pudieron incluir en este ZIP (${o.omitidos.length}).\r\n` +
        `Suele ser algo temporal: vuelve a pedir la descarga de esos archivos y entrarán.\r\n` +
        `${o.omitidos.slice(0, 500).map((n) => `  - ${n}`).join("\r\n")}${resto}`,
    );
  }
  return partes.length ? `${partes.join("\r\n\r\n")}\r\n` : null;
}

// ---------------------------------------------------------------- el ZIP

export interface ZipOpciones {
  /** «parte 2 de 5»: solo cambia el nombre del archivo descargado */
  parte?: { n: number; de: number } | null;
  /** id (uuid) que manda la web para poder preguntar por el progreso */
  job?: string | null;
  /** «compatible con todo»: HEIC→JPG, HEVC→MP4, CAF/AMR→MP3 (ver compat.ts) */
  compat?: boolean;
}

export async function servirZip(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  filtro: ZipFiltro,
  opciones: ZipOpciones = {},
): Promise<void> {
  const trabajo = nuevoTrabajo(opciones.job && ES_UUID.test(opciones.job) ? opciones.job : null, userId, opciones.parte);

  if (filtro.ids && !filtro.ids.length) {
    fallar(trabajo, "No hay nada válido que descargar.");
    reply.code(400).send({ error: "ningún id válido" });
    return;
  }

  const hueco = cogerHuecoZip(userId);
  if (!hueco.ok) {
    fallar(trabajo, hueco.error);
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
    fallar(trabajo, "No se pudo preparar la descarga.");
    req.log.error({ err: (e as Error)?.message }, "zip: consulta");
    reply.code(500).send({ error: "no se pudo preparar la descarga" });
    return;
  }
  if (!rows.length) {
    hueco.soltar();
    fallar(trabajo, "No hay nada que descargar con este filtro.");
    reply.code(404).send({ error: "nada que descargar" });
    return;
  }

  const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10);
  const d1 = ymd(rows[0]!.captured_at);
  const d2 = ymd(rows[rows.length - 1]!.captured_at);
  let name = (d1 === d2 ? `Recuerdos ${d1}` : `Recuerdos del ${d1} al ${d2}`).replace(/[^\w .\-]/g, "");
  if (opciones.parte && opciones.parte.de > 1) name += ` (parte ${opciones.parte.n} de ${opciones.parte.de})`;

  // Zip64 solo si hace falta (>= ~3,5 GB en total o algún archivo así de grande).
  const compat = opciones.compat === true;
  const tam = (r: ZipFila) => (compat ? bytesCompat(r) : Number(r.bytes) || 0);
  const totalBytes = rows.reduce((n, r) => n + tam(r), 0);
  const hayGrande = rows.some((r) => tam(r) > 3.5 * GB);
  const zip64 = totalBytes > 3.5 * GB || hayGrande;
  if (trabajo) {
    trabajo.total = rows.length;
    trabajo.bytesTotal = totalBytes;
    trabajo.t = Date.now();
  }

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
    // Bytes que de verdad han salido: lo escrito en el ZIP menos lo que aún espera
    // en la cola del socket (si no, la barra iría por delante de la descarga real).
    const enviado = () => Math.max(0, archive.pointer() - reply.raw.writableLength);
    const tick = setInterval(() => {
      if (trabajo) {
        trabajo.bytesEnviados = enviado();
        trabajo.t = Date.now();
      }
    }, 400);
    reply.raw.once("finish", () => {
      // todo el ZIP ya salió por el socket
      clearInterval(tick);
      if (trabajo && trabajo.etapa !== "cancelado") {
        trabajo.etapa = "listo";
        trabajo.bytesEnviados = Math.max(trabajo.bytesEnviados, archive.pointer());
        trabajo.t = Date.now();
      }
    });
    reply.raw.once("close", () => {
      clearInterval(tick);
      if (trabajo && trabajo.etapa !== "listo") trabajo.etapa = "cancelado";
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

    type Preparado = { entrega: ArchivoEntregable; nota: string | null } | null;
    const inflight = new Map<number, Promise<Preparado>>();
    const temporales = new Set<string>(); // archivos convertidos: se borran SIEMPRE al acabar
    const notas: string[] = [];
    let convertidos = 0;
    const enVuelo = new Map<number, number>(); // índice -> bytes reservados
    const pins = new Map<number, () => void>(); // índice -> soltar el pin
    const bytesEnVuelo = () => [...enVuelo.values()].reduce((n, x) => n + x, 0);
    const grandesEnVuelo = () => [...enVuelo.values()].filter((x) => x > GRANDE).length;
    const kickoff = (i: number) => {
      if (i >= rows.length || inflight.has(i) || abortado) return;
      const b = tam(rows[i]!);
      // SIEMPRE se permite al menos una descarga, aunque ese archivo solo ya se
      // salga del presupuesto — si no, un vídeo más grande que el presupuesto no
      // se descargaría nunca y el ZIP se quedaría colgado.
      if (inflight.size > 0 && bytesEnVuelo() + b > presupuesto) return;
      if (inflight.size > 0 && b > GRANDE && grandesEnVuelo() >= 2) return;
      enVuelo.set(i, b);
      inflight.set(
        i,
        prepararEntrega(rows[i]!, compat)
          .then((p) => {
            // pin EN CUANTO está en disco, no al llegarle el turno; y no si el
            // bucle ya cortó (ese pin quedaría colgado para siempre)
            if (p.entrega.enCache && pin && !terminado && !pins.has(i)) pins.set(i, pin(p.entrega.enCache));
            if (p.entrega.temporal) {
              temporales.add(p.entrega.temporal);
              // una conversión que acaba DESPUÉS de cortar el bucle no deja restos
              if (terminado) void rm(p.entrega.temporal, { force: true }).catch(() => {});
            }
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
    if (trabajo) trabajo.etapa = "enviando";

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
      let prep = await inflight.get(i)!;
      inflight.delete(i);
      enVuelo.delete(i);
      // rellenar la ventana: puede entrar más de uno si los que acaban de salir liberaron presupuesto
      for (let j = i + 1; j < Math.min(rows.length, i + 1 + CONC); j++) kickoff(j);

      // El archivo puede haber desaparecido entre la descarga y su turno (limpieza
      // de caché agresiva, borrado manual): se reintenta una vez y, si aún no
      // está, se salta y el ZIP continúa con el resto.
      if (prep && !existsSync(prep.entrega.ruta)) {
        req.log.warn({ id: r.id }, "zip: el archivo ya no estaba en disco, se prepara de nuevo");
        prep = await prepararEntrega(r, compat).catch(() => null);
        if (prep?.entrega.enCache && pin && !pins.has(i)) pins.set(i, pin(prep.entrega.enCache));
        if (prep?.entrega.temporal) temporales.add(prep.entrega.temporal);
        if (prep && !existsSync(prep.entrega.ruta)) prep = null;
      }
      if (!prep) {
        soltarPin(i);
        omitidos.push(r.filename || `${r.kind}_${r.id}`);
        if (trabajo) {
          trabajo.omitidos = omitidos.length;
          trabajo.hechos++;
        }
        req.log.warn({ id: r.id }, "zip: archivo omitido");
        continue;
      }
      const local2 = prep.entrega.ruta;
      if (prep.nota) notas.push(prep.nota);
      if (prep.entrega.convertido) convertidos++;
      const nm = nameFor({ filename: prep.entrega.nombre, kind: r.kind, id: r.id });
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
        if (prep.entrega.temporal) {
          temporales.delete(prep.entrega.temporal);
          void rm(prep.entrega.temporal, { force: true }).catch(() => {});
        }
      }
      added++;
      if (trabajo) {
        trabajo.hechos++;
        trabajo.bytesEnviados = enviado();
        // Con conversión el tamaño final solo es una estimación: a partir de unos
        // cuantos archivos se proyecta con lo que de verdad ha salido
        if (compat && trabajo.hechos >= 3 && trabajo.total > 0) {
          trabajo.bytesTotal = Math.max(trabajo.bytesEnviados, Math.round((trabajo.bytesEnviados / trabajo.hechos) * trabajo.total));
        }
        trabajo.t = Date.now();
      }
    }

    // soltar los pines que queden (ventana de prefetch al cortar, archivos
    // saltados): si no, quedarían intocables para el limpiador de caché PARA SIEMPRE
    terminado = true;
    for (const i of [...pins.keys()]) soltarPin(i);
    for (const t of temporales) void rm(t, { force: true }).catch(() => {});
    temporales.clear();
    req.log.info({ userId, added, omitidos: omitidos.length, zip64 }, "zip: finalizando");

    try {
      if (abortado || reply.raw.destroyed) archive.abort();
      else {
        const txt = textoLeeme({ compat, convertidos, notas, omitidos });
        if (txt) archive.append(Buffer.from(txt, "utf8"), { name: "LEEME.txt" });
        await archive.finalize();
      }
    } catch (e) {
      req.log.warn({ err: (e as Error)?.message }, "zip: cierre con incidencias");
      if (!reply.raw.destroyed) reply.raw.destroy();
    }
  } catch (e) {
    // ya se mandaron cabeceras: lo único honesto es cortar (el navegador lo ve como descarga fallida)
    req.log.error({ err: (e as Error)?.message }, "zip: fallo inesperado");
    fallar(trabajo, "La descarga se interrumpió. Vuelve a intentarlo.");
    if (!reply.raw.destroyed) reply.raw.destroy();
  } finally {
    hueco.soltar();
  }
}
