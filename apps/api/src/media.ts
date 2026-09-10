import { execFile } from "node:child_process";
import { extname } from "node:path";
import sharp from "sharp";
import { env } from "./env.js";
import type { AssetKind } from "./types.js";

const RUN_OPTS = { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 };

/**
 * Ejecuta un binario y GARANTIZA que la promesa se resuelve como muy tarde a los
 * `timeout` ms: al vencer, mata el hijo (SIGKILL) y rechaza YA, sin esperar a que
 * cierre sus pipes. `execFile` de Node con `timeout` puede quedarse colgado si el
 * hijo no cierra stdio tras el kill (pasa con ffprobe/ffmpeg en vídeos 4K/HEVC
 * pesados) — esto lo evita.
 */
function run(
  file: string,
  args: string[],
  opts: { maxBuffer: number; timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = execFile(file, args, { maxBuffer: opts.maxBuffer }, (err, stdout, stderr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ya muerto */
      }
      reject(new Error(`${file}: timeout ${opts.timeout}ms`));
    }, opts.timeout);
  });
}

const VIDEO_EXT = new Set([".mov", ".mp4", ".m4v", ".hevc", ".avci", ".3gp", ".avi", ".mkv", ".webm"]);
const IMAGE_EXT = new Set([".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".tiff", ".dng", ".avif"]);
const EXT_MIME: Record<string, string> = {
  ".heic": "image/heic", ".heif": "image/heif", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".tiff": "image/tiff",
  ".dng": "image/x-adobe-dng", ".mov": "video/quicktime", ".mp4": "video/mp4",
  ".m4v": "video/x-m4v", ".avi": "video/x-msvideo", ".mkv": "video/x-matroska", ".webm": "video/webm",
};

/**
 * Extensión real del archivo. Si el nombre no trae una extensión conocida
 * (p. ej. el Atajo de iOS no manda X-Filename → "IMG.bin"), se deduce del
 * Content-Type. Clave para que un vídeo se guarde y se sirva como vídeo.
 */
export function extFor(filename: string, contentType?: string): string {
  const e = extname(filename).toLowerCase();
  if (VIDEO_EXT.has(e) || IMAGE_EXT.has(e)) return e;
  const byMime = Object.entries(EXT_MIME).find(([, m]) => m === contentType)?.[0];
  if (byMime) return byMime;
  if (contentType?.startsWith("video/")) return ".mov";
  if (contentType?.startsWith("image/")) return ".jpg";
  return e || ".bin";
}

export function mimeFor(ext: string, contentType?: string): string {
  return EXT_MIME[ext] ?? contentType ?? "application/octet-stream";
}

export interface Probe {
  kind: AssetKind;
  width: number | null;
  height: number | null;
  durationS: number | null;
  fps: number | null;
  videoBitrate: number | null;
  codec: string | null;
  capturedAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  lat: number | null;
  lon: number | null;
}

/** Convierte una fecha arbitraria a ISO. Devuelve null si no se puede parsear (no lanza). */
export function safeIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function parseRate(r: string | undefined): number | null {
  if (!r || !r.includes("/")) return null;
  const [a, b] = r.split("/").map(Number);
  if (!a || !b) return null;
  return Math.round((a / b) * 100) / 100;
}

/** ISO6709 -> {lat, lon}. Ej: "+40.4168-003.7038+015.000/" */
function parseIso6709(s: string | undefined): { lat: number | null; lon: number | null } {
  if (!s) return { lat: null, lon: null };
  const m = s.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
  if (!m) return { lat: null, lon: null };
  return { lat: parseFloat(m[1]!), lon: parseFloat(m[2]!) };
}

export async function probe(path: string, filename: string, contentType?: string): Promise<Probe> {
  const ext = extFor(filename, contentType);
  const looksVideo = VIDEO_EXT.has(ext) || (contentType?.startsWith("video/") ?? false);

  let data: any = {};
  try {
    const { stdout } = await run(env.FFPROBE_PATH, [
      "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path,
    ], RUN_OPTS);
    data = JSON.parse(stdout || "{}");
  } catch {
    data = {};
  }

  const streams: any[] = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const fmt = data.format ?? {};
  const tags = { ...(fmt.tags ?? {}), ...(v?.tags ?? {}) } as Record<string, string>;

  const durationS = Number(fmt.duration) > 0 ? Math.round(Number(fmt.duration) * 100) / 100 : null;
  const nbFrames = Number(v?.nb_frames) || 0;

  // Ground truth = ffprobe. Una FOTO también aparece como stream "video" (mjpeg/hevc/png),
  // pero sin duración, sin pista de audio y con 1 solo frame. Un VÍDEO real tiene
  // duración > 0.3 s, o audio, o varios frames.
  const looksVideoByProbe =
    (durationS ?? 0) > 0.3 || !!audio || nbFrames > 1;
  const kind: AssetKind = looksVideo || looksVideoByProbe ? "video" : "photo";

  const fps = kind === "video" ? (parseRate(v?.avg_frame_rate) ?? parseRate(v?.r_frame_rate)) : null;
  const videoBitrate = kind === "video"
    ? Number(v?.bit_rate) || Number(fmt.bit_rate) || null
    : null;

  const loc = parseIso6709(
    tags["com.apple.quicktime.location.ISO6709"] ?? tags["location"] ?? tags["location-eng"],
  );

  const capturedAt =
    tags["creation_time"] ??
    tags["com.apple.quicktime.creationdate"] ??
    tags["date"] ??
    (fmt.tags?.creation_time as string | undefined) ??
    null;

  return {
    kind,
    width: v?.width ?? null,
    height: v?.height ?? null,
    durationS,
    fps,
    videoBitrate,
    codec: v?.codec_name ?? null,
    capturedAt: safeIso(capturedAt),
    cameraMake: tags["com.apple.quicktime.make"] ?? tags["make"] ?? null,
    cameraModel: tags["com.apple.quicktime.model"] ?? tags["model"] ?? null,
    lens: tags["com.apple.quicktime.lens"] ?? null,
    lat: loc.lat,
    lon: loc.lon,
  };
}

/** Miniatura/imagen reescalada a `maxW` px (WebP). Prueba sharp; si no puede
 *  (sharp NO trae decodificador HEIC por licencia → casi todo el carrete iPhone
 *  fallaba), tira de ffmpeg, que en Debian sí lee HEIC. */
export async function sharpThumb(srcImage: string, out: string, maxW = 640): Promise<void> {
  try {
    await sharp(srcImage, { failOn: "none" })
      .rotate()
      .resize(maxW, maxW, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(out);
    return;
  } catch {
    /* sharp no pudo (HEIC/HEIF/formato raro) → ffmpeg */
  }
  await run(
    env.FFMPEG_PATH,
    ["-y", "-i", srcImage, "-frames:v", "1", "-vf", `scale='min(${maxW},iw)':-2`, "-c:v", "libwebp", "-quality", "80", out],
    RUN_OPTS,
  );
}

/** Versión grande (JPEG ~1600px) de una FOTO, para verla nítida a pantalla completa.
 *  sharp primero; si no puede (HEIC), ffmpeg. */
export async function imagePoster(srcImage: string, out: string, maxW = 1600): Promise<void> {
  try {
    await sharp(srcImage, { failOn: "none" })
      .rotate()
      .resize(maxW, maxW, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(out);
    return;
  } catch {
    /* HEIC/raro → ffmpeg */
  }
  await run(
    env.FFMPEG_PATH,
    ["-y", "-i", srcImage, "-frames:v", "1", "-vf", `scale='min(${maxW},iw)':-2`, "-q:v", "3", out],
    RUN_OPTS,
  );
}

/** Extrae un fotograma de un vídeo a JPEG (ffmpeg siempre trae mjpeg). */
export async function extractFrame(src: string, out: string, maxW = 1600): Promise<void> {
  // Sin "-ss": cogemos el primer fotograma. Así funciona también con vídeos < 1 s
  // (MOV de Live Photo, ráfagas) que antes se quedaban sin póster.
  await run(
    env.FFMPEG_PATH,
    ["-y", "-i", src, "-frames:v", "1", "-vf", `scale='min(${maxW},iw)':-2`, "-q:v", "3", out],
    RUN_OPTS,
  );
}

export const makePoster = extractFrame;

/** Miniatura de reserva: cuadro oscuro. Nunca falla (sharp la crea de cero). */
export async function placeholderThumb(out: string, kind: AssetKind): Promise<void> {
  const bg = kind === "video" ? { r: 18, g: 23, b: 38 } : { r: 26, g: 30, b: 45 };
  await sharp({ create: { width: 640, height: 640, channels: 3, background: bg } })
    .webp({ quality: 60 })
    .toFile(out);
}
