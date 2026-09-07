import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extname } from "node:path";
import sharp from "sharp";
import { env } from "./env.js";
import type { AssetKind } from "./types.js";

const run = promisify(execFile);

const VIDEO_EXT = new Set([".mov", ".mp4", ".m4v", ".hevc", ".avci", ".3gp", ".avi", ".mkv"]);
const EXT_MIME: Record<string, string> = {
  ".heic": "image/heic", ".heif": "image/heif", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".tiff": "image/tiff",
  ".dng": "image/x-adobe-dng", ".mov": "video/quicktime", ".mp4": "video/mp4",
  ".m4v": "video/x-m4v", ".avi": "video/x-msvideo", ".mkv": "video/x-matroska",
};

export function extFor(filename: string, contentType?: string): string {
  const e = extname(filename).toLowerCase();
  if (e) return e;
  const fromMime = Object.entries(EXT_MIME).find(([, m]) => m === contentType)?.[0];
  return fromMime ?? ".bin";
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
    ], { maxBuffer: 8 * 1024 * 1024 });
    data = JSON.parse(stdout || "{}");
  } catch {
    data = {};
  }

  const streams: any[] = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const fmt = data.format ?? {};
  const tags = { ...(fmt.tags ?? {}), ...(v?.tags ?? {}) } as Record<string, string>;

  const hasRealVideo = !!v && Number(v.nb_frames ?? 0) !== 1 && Number(fmt.duration ?? 0) > 0.05;
  const kind: AssetKind = looksVideo && hasRealVideo ? "video" : "photo";

  const durationS = Number(fmt.duration) > 0 ? Math.round(Number(fmt.duration) * 100) / 100 : null;
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
    capturedAt: capturedAt ? new Date(capturedAt).toISOString() : null,
    cameraMake: tags["com.apple.quicktime.make"] ?? tags["make"] ?? null,
    cameraModel: tags["com.apple.quicktime.model"] ?? tags["model"] ?? null,
    lens: tags["com.apple.quicktime.lens"] ?? null,
    lat: loc.lat,
    lon: loc.lon,
  };
}

/** Miniatura WebP ~640px. Para fotos usa sharp; si falla (HEIC sin libheif) tira de ffmpeg. */
export async function makeThumb(src: string, kind: AssetKind, out: string): Promise<void> {
  if (kind === "photo") {
    try {
      await sharp(src, { failOn: "none" })
        .rotate()
        .resize(640, 640, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(out);
      return;
    } catch {
      // fallback ffmpeg
    }
  }
  await run(env.FFMPEG_PATH, [
    "-y", "-ss", kind === "video" ? "1" : "0", "-i", src,
    "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", out,
  ], { maxBuffer: 8 * 1024 * 1024 });
}

/** Póster JPEG ~1600px de un fotograma del vídeo. */
export async function makePoster(src: string, out: string): Promise<void> {
  await run(env.FFMPEG_PATH, [
    "-y", "-ss", "1", "-i", src, "-frames:v", "1",
    "-vf", "scale='min(1600,iw)':-2", "-q:v", "3", out,
  ], { maxBuffer: 8 * 1024 * 1024 });
}
