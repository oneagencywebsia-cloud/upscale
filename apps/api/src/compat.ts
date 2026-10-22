import { join } from "node:path";
import { rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { env } from "./env.js";
import { blobToLocalFile } from "./storage.js";
import { convertirAJpegCompatible, convertirAMp3 } from "./media.js";

/**
 * Descargas «compatibles con todo».
 *
 * El original se guarda SIEMPRE tal cual (HEIC, HEVC, CAF…). Pero un HEIC de
 * iPhone no se abre en muchos Windows/Android/programas, un vídeo HEVC tampoco,
 * ni un audio CAF/AMR. En modo «compatible» la descarga entrega una versión que
 * se abre en cualquier sitio:
 *   · fotos HEIC/HEIF/AVIF/TIFF/DNG  → JPEG a resolución completa, con sus metadatos
 *   · vídeos HEVC/ProRes/MKV/AVI…    → MP4 H.264 (la «copia ligera» que ya existe, 1080p)
 *   · audios CAF/AMR/WMA/AIFF/OGG…   → MP3
 *   · lo que ya se abre en todas partes (JPG, PNG, GIF, MP3, M4A, WAV, MP4 H.264…) → tal cual
 * «Original» sigue entregando el archivo exacto.
 */

export type AccionCompat = "original" | "jpeg" | "mp3" | "copia-video";

export interface FilaCompat {
  kind: string;
  filename: string;
  bytes: string | number;
  codec?: string | null;
  duration_s?: string | number | null;
  preview_key?: string | null;
  preview_bytes?: string | number | null;
}

const ext = (n: string) => /\.[a-z0-9]{1,6}$/i.exec(n)?.[0].toLowerCase() ?? "";

const FOTO_A_JPEG = new Set([".heic", ".heif", ".avif", ".tif", ".tiff", ".dng"]);
const AUDIO_A_MP3 = new Set([".caf", ".amr", ".wma", ".aif", ".aiff", ".ogg", ".oga", ".opus"]);
const VIDEO_OK_EXT = new Set([".mp4", ".mov", ".m4v"]);
const VIDEO_OK_CODEC = /^(h264|avc1|avc)$/i;

/** Qué hay que hacer con este archivo para que se abra en cualquier sitio. */
export function planCompat(f: FilaCompat): AccionCompat {
  const e = ext(f.filename);
  if (f.kind === "photo") return FOTO_A_JPEG.has(e) ? "jpeg" : "original";
  if (f.kind === "audio") return AUDIO_A_MP3.has(e) ? "mp3" : "original";
  if (f.kind === "video") {
    const yaCompatible = VIDEO_OK_EXT.has(e) && !!f.codec && VIDEO_OK_CODEC.test(f.codec);
    if (yaCompatible) return "original";
    // sin copia ligera todavía → no se puede ofrecer una compatible: va el original
    return f.preview_key ? "copia-video" : "original";
  }
  return "original";
}

/** Nombre del archivo ya convertido: mismo nombre con la extensión nueva. */
export function nombreCompat(filename: string, accion: AccionCompat): string {
  if (accion === "original") return filename;
  const nuevo = accion === "jpeg" ? ".jpg" : accion === "mp3" ? ".mp3" : ".mp4";
  const e = ext(filename);
  const base = e ? filename.slice(0, -e.length) : filename;
  return `${base || "archivo"}${nuevo}`;
}

/** Tamaño estimado de lo que se va a entregar (para el tamaño y las partes). */
export function bytesCompat(f: FilaCompat, accion = planCompat(f)): number {
  const b = Number(f.bytes) || 0;
  if (accion === "jpeg") {
    // HEIC/HEIF/AVIF ya van muy comprimidos: el JPEG pesa ~1,5-2× más. TIFF/DNG
    // son enormes (sin comprimir o RAW): el JPEG es bastante más pequeño.
    return Math.round(b * (/\.(tiff?|dng)$/i.test(f.filename) ? 0.5 : 1.7));
  }
  if (accion === "copia-video") return Number(f.preview_bytes) || Math.round(b * 0.2);
  if (accion === "mp3") return Math.max(200_000, Math.round((Number(f.duration_s) || b / 100_000) * 24_000)); // ~190 kbps
  return b;
}

// ---------------------------------------------------------------- conversión

class Cola {
  private libres: number;
  private espera: (() => void)[] = [];
  constructor(n: number) {
    this.libres = n;
  }
  async tomar(): Promise<() => void> {
    if (this.libres > 0) this.libres--;
    else await new Promise<void>((r) => this.espera.push(r));
    let hecho = false;
    return () => {
      if (hecho) return;
      hecho = true;
      const s = this.espera.shift();
      if (s) s();
      else this.libres++;
    };
  }
}
// convertir fotos es CPU: de dos en dos, para que la app siga respondiendo
const colaConversion = new Cola(Math.max(1, Number(process.env.COMPAT_CONCURRENCY) || 2));

export interface ArchivoEntregable {
  /** archivo local que hay que entregar */
  ruta: string;
  /** nombre con el que entregarlo */
  nombre: string;
  /** si se creó un archivo temporal, aquí se borra al terminar */
  temporal: string | null;
  /** ruta de la caché de Telegram que usa esta entrega (para el pin) */
  enCache: string | null;
  convertido: boolean;
}

/**
 * Prepara el archivo que se entrega según el modo (baja de Telegram lo que haga
 * falta). Si convertir falla, se entrega el ORIGINAL (nunca se pierde un archivo
 * por no poder convertirlo) y `nota` lo cuenta. Lanza solo si ni el original se
 * puede obtener.
 */
export async function prepararEntrega(
  f: FilaCompat & { id: string; original_key: string },
  compat: boolean,
): Promise<{ entrega: ArchivoEntregable; nota: string | null }> {
  const conOriginal = async (nota: string | null) => {
    const ruta = await blobToLocalFile(f.original_key);
    return { entrega: { ruta, nombre: f.filename, temporal: null, enCache: ruta, convertido: false } as ArchivoEntregable, nota };
  };
  const accion = compat ? planCompat(f) : "original";
  if (accion === "original") return conOriginal(null);

  const nombre = nombreCompat(f.filename, accion);
  if (accion === "copia-video") {
    try {
      const ruta = await blobToLocalFile(f.preview_key!);
      return { entrega: { ruta, nombre, temporal: null, enCache: ruta, convertido: true }, nota: null };
    } catch {
      return conOriginal(`${f.filename}: la copia compatible no estaba disponible; se incluye el original`);
    }
  }

  const rutaOriginal = await blobToLocalFile(f.original_key);
  const out = join(env.TMP_DIR, `dl-${f.id.slice(0, 8)}-${randomBytes(4).toString("hex")}${accion === "jpeg" ? ".jpg" : ".mp3"}`);
  const soltar = await colaConversion.tomar();
  try {
    if (accion === "jpeg") await convertirAJpegCompatible(rutaOriginal, out);
    else await convertirAMp3(rutaOriginal, out);
    return { entrega: { ruta: out, nombre, temporal: out, enCache: rutaOriginal, convertido: true }, nota: null };
  } catch {
    await rm(out, { force: true }).catch(() => {});
    return {
      entrega: { ruta: rutaOriginal, nombre: f.filename, temporal: null, enCache: rutaOriginal, convertido: false },
      // sin el mensaje del sistema: lleva rutas internas del servidor
      nota: `${f.filename}: no se pudo convertir; se incluye el original`,
    };
  } finally {
    soltar();
  }
}
