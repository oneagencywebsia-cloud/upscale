// Genera las imágenes y el vídeo de la portada: ilustraciones propias (sin fotos de nadie,
// sin servicios externos). Uso: cd apps/api && node ../../tools/generar-portada.mjs
// Salida: apps/web/public/landing/{foto-1..4.webp, roto.webp, biblioteca.mp4, biblioteca.jpg}
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(join(aqui, "..", "apps", "api", "package.json"))("sharp");
const OUT = join(aqui, "..", "apps", "web", "public", "landing");
mkdirSync(OUT, { recursive: true });

const frac = (n) => n - Math.floor(n);
const R = (seed, i) => frac(Math.sin(seed * 127.1 + i * 311.7) * 43758.5453);

import { ESCENAS, ALEGRES } from "./ilustraciones.mjs";

const render = (nombre, t = 0, px = 1600) => sharp(Buffer.from(ESCENAS[nombre](t)), { density: 96 }).resize(px, px).png().toBuffer();

// 1) las cuatro «fotos» de las formas (cuadradas; las formas las recortan): momentos que se sienten
for (const [i, n] of ["mano", "velas", "balcon", "alza"].entries()) {
  await sharp(await render(n, 0, 1600)).webp({ quality: 92, effort: 6, smartSubsample: false }).toFile(join(OUT, `foto-${i + 1}.webp`));
}
// y el móvil roto, para el capítulo del miedo (proporción de móvil)
await sharp(await render("roto", 0, 1600)).extract({ left: 267, top: 107, width: 1067, height: 1387 }).resize(960, 1248).webp({ quality: 92, effort: 6 }).toFile(join(OUT, "roto.webp"));

// 2) la biblioteca: una rejilla de 3 columnas con fotos verticales, horizontales y cuadradas
const COLS = 3, W = 1440, G = 18, CW = (W - G * (COLS + 1)) / COLS;
const formas = [1.33, 0.75, 1, 0.75, 1.33, 1, 1, 0.75, 1.33, 0.75, 1, 1.33, 1.33, 1, 0.75, 1, 0.75, 1.33, 0.75, 1.33, 1, 1.33, 0.75, 1];
const alto = Array(COLS).fill(G);
const piezas = [];
for (let i = 0; i < formas.length; i++) {
  const col = alto.indexOf(Math.min(...alto));
  const w = Math.round(CW), h = Math.round(CW / formas[i]);
  const nombre = ALEGRES[i % ALEGRES.length];
  // cada escena se recorta a la forma pedida (apaisada, vertical o cuadrada) centrada en las caras
  const base = await render(nombre, Math.floor(i / ALEGRES.length) + i % 3, 1600);
    const cw = formas[i] >= 1 ? 1600 : Math.round(1600 * formas[i]);
  const ch = formas[i] >= 1 ? Math.round(1600 / formas[i]) : 1600;
  const left = Math.round((1600 - cw) / 2);
  const top = Math.min(1600 - ch, Math.max(0, Math.round(1600 * 0.46 - ch / 2)));
  const rec = await sharp(base).extract({ left, top, width: cw, height: ch }).resize(w, h).modulate({ hue: (i * 23) % 40 - 12 }).png().toBuffer();
  const b = await sharp(rec).composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><rect width="100%" height="100%" rx="22" ry="22" fill="#fff"/></svg>`), blend: "dest-in" }]).png().toBuffer();
  piezas.push({ input: b, left: Math.round(G + col * (CW + G)), top: alto[col] });
  alto[col] += h + G;
}
const H = Math.max(...alto);
const rejilla = join(OUT, "_rejilla.png");
await sharp({ create: { width: W, height: H, channels: 4, background: "#f4efe9" } }).composite(piezas).png().toFile(rejilla);

// 3) el vídeo: la rejilla desplazándose despacio dentro de un «móvil» (9:16), en bucle
const VW = 720, VH = 1280, SEG = 12, FPS = 30;
const recorrido = Math.max(1, H * (VW / W) - VH); // alto de la rejilla escalada menos la ventana
const y = `${recorrido.toFixed(0)}*(0.5-0.5*cos(2*PI*t/${SEG}))`; // sube y baja suave: el bucle no salta
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-loop", "1", "-framerate", String(FPS), "-i", rejilla,
  "-t", String(SEG),
  "-vf", `scale=${VW}:-1,crop=${VW}:${VH}:0:'${y}',format=yuv420p`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high", "-movflags", "+faststart", "-an",
  join(OUT, "biblioteca.mp4"),
]);
await sharp(rejilla).resize(VW).extract({ left: 0, top: 0, width: VW, height: VH }).jpeg({ quality: 90, mozjpeg: true }).toFile(join(OUT, "biblioteca.jpg"));
rmSync(rejilla);
writeFileSync(join(OUT, "LEEME.txt"), "Generado por tools/generar-portada.mjs. Ilustraciones propias (ver tools/ilustraciones.mjs); no son fotos de personas reales.\n");
console.log("listo", OUT);
