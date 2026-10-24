import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { env } from "./env.js";
import { one } from "./db.js";
import { blobToLocalFile } from "./storage.js";

/**
 * Reconocimiento de texto (OCR) de una captura, con Tesseract: libre, local y sin
 * enviar nada a ningún servicio externo.
 *
 * - Se lee el ORIGINAL (las miniaturas no tienen resolución para texto pequeño).
 * - Antes de Tesseract se prepara la imagen: orientación EXIF, transparencias sobre
 *   blanco, escala de grises y un tamaño razonable (se amplía lo pequeño y se reduce
 *   lo enorme). Nada más: Tesseract 5 ya lleva bien el modo oscuro y el texto pequeño.
 * - Como mucho `OCR_CONCURRENCY` a la vez y `OCR_TIMEOUT_MS` cada una; el resto espera.
 */

export class OcrNoDisponible extends Error {}
export class OcrNoSePuede extends Error {}

export interface ResultadoOcr {
  texto: string;
  ms: number;
}

let disponible: Promise<boolean> | null = null;
function tesseractInstalado(): Promise<boolean> {
  disponible ??= new Promise((res) => execFile(env.TESSERACT_PATH, ["--version"], { timeout: 8000 }, (e) => res(!e)));
  return disponible;
}

// Cola sencilla: un contador de huecos y una lista de esperas.
let ocupados = 0;
const esperando: (() => void)[] = [];
async function turno<T>(f: () => Promise<T>): Promise<T> {
  if (ocupados >= env.OCR_CONCURRENCY) await new Promise<void>((r) => esperando.push(r));
  ocupados++;
  try {
    return await f();
  } finally {
    ocupados--;
    esperando.shift()?.();
  }
}

const ANCHO_MIN = 1000; // por debajo se amplía (el texto pequeño lo agradece)
const ANCHO_MAX = 3200; // por encima se reduce (más píxeles no ayudan y tardan)

async function prepararImagen(origen: string, destino: string): Promise<void> {
  const meta = await sharp(origen, { limitInputPixels: 120e6, failOn: "none" }).metadata();
  let p = sharp(origen, { limitInputPixels: 120e6, failOn: "none" }).rotate().flatten({ background: "#ffffff" }).grayscale();
  const w = meta.width ?? 0;
  if (w && w < ANCHO_MIN) p = p.resize({ width: Math.min(w * 2, ANCHO_MIN * 2), kernel: "lanczos3" });
  else if (w > ANCHO_MAX) p = p.resize({ width: ANCHO_MAX });
  await p.png({ compressionLevel: 1 }).toFile(destino);
}

function ejecutarTesseract(png: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      env.TESSERACT_PATH,
      [png, "stdout", "-l", env.OCR_LANGS, "--psm", "3"],
      { timeout: env.OCR_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, killSignal: "SIGKILL" },
      (err, stdout) => {
        if (err) return reject(new OcrNoSePuede(err.killed ? "el reconocimiento tardó demasiado" : "no se pudo leer el texto de la imagen"));
        resolve(stdout);
      },
    );
  });
}

/** Limpia lo que Tesseract suele ensuciar: espacios finales, saltos de página, 3+ líneas en blanco. */
export function limpiarTextoOcr(t: string): string {
  return t
    .replace(/\r/g, "")
    .replace(/\f/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** OCR de una imagen de la biblioteca del usuario. */
export async function ocrDeAsset(userId: string, assetId: string): Promise<ResultadoOcr> {
  if (!(await tesseractInstalado())) throw new OcrNoDisponible("El reconocimiento de texto no está disponible en este servidor");
  const a = await one<{ kind: string; original_key: string; bytes: string }>(
    "select kind, original_key, bytes from assets where id = $1 and user_id = $2 and deleted_at is null",
    [assetId, userId],
  );
  if (!a) throw new OcrNoSePuede("no existe esa imagen");
  if (a.kind !== "photo") throw new OcrNoSePuede("solo se puede leer el texto de imágenes");
  if (Number(a.bytes) > 60 * 1024 * 1024) throw new OcrNoSePuede("la imagen es demasiado grande para leer su texto");

  return turno(async () => {
    const t0 = Date.now();
    const origen = await blobToLocalFile(a.original_key); // ¡es la copia del almacén/caché: NO se borra!
    const dir = join(env.TMP_DIR, "ocr");
    await mkdir(dir, { recursive: true });
    const png = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
    try {
      await prepararImagen(origen, png).catch(() => {
        throw new OcrNoSePuede("no se pudo abrir la imagen");
      });
      const texto = limpiarTextoOcr(await ejecutarTesseract(png));
      return { texto, ms: Date.now() - t0 };
    } finally {
      await rm(png, { force: true });
    }
  });
}
