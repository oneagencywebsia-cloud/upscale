// Genera las imágenes y el vídeo de la portada: ilustraciones propias (sin fotos de nadie,
// sin servicios externos). Uso: cd apps/api && node ../../tools/generar-portada.mjs
// Salida: apps/web/public/landing/{foto-1..4.webp, biblioteca.mp4, biblioteca.jpg}
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

// cada «foto»: paleta de cielo, sol/luna, capas de colinas
const PALETAS = {
  atardecer: { cielo: ["#ffd27a", "#ff8a6b", "#a24b8f"], astro: "#fff3c9", capas: ["#c4506f", "#7b3a7a", "#3d2a62"] },
  montanas: { cielo: ["#bfe6ff", "#8fb7f5", "#6a62f2"], astro: "#ffffff", capas: ["#6f8fd8", "#4a62b8", "#2b3a85"] },
  mar: { cielo: ["#c8fff0", "#6fe0d6", "#2aa3c8"], astro: "#fffbe0", capas: ["#1d93b5", "#12709a", "#0b4a73"] },
  bosque: { cielo: ["#fff2b8", "#a8e08a", "#3f9c72"], astro: "#fffbe6", capas: ["#2f8a5f", "#1f6a52", "#124538"] },
  noche: { cielo: ["#2a2f7a", "#4a3a9a", "#7a4fb0"], astro: "#f3f0ff", capas: ["#3b2f7c", "#2a2260", "#1a1546"] },
  desierto: { cielo: ["#ffe9b0", "#ffb36b", "#e0705a"], astro: "#fff7d6", capas: ["#d9774f", "#a8523f", "#6d3236"] },
};
const NOMBRES = Object.keys(PALETAS);

function escena(nombre, w, h, seed) {
  const p = PALETAS[nombre];
  const ax = w * (0.25 + R(seed, 1) * 0.5);
  const ay = h * (0.18 + R(seed, 2) * 0.22);
  const ar = Math.min(w, h) * (0.07 + R(seed, 3) * 0.05);
  let capas = "";
  p.capas.forEach((c, i) => {
    const base = h * (0.52 + i * 0.14);
    const amp = h * (0.07 + R(seed, 10 + i) * 0.06);
    const fase = R(seed, 20 + i) * 6.28;
    let d = `M0 ${h} L0 ${base}`;
    for (let x = 0; x <= w; x += w / 24) d += ` L${x.toFixed(1)} ${(base + Math.sin(x / w * (3 + i) * 3.14 + fase) * amp).toFixed(1)}`;
    d += ` L${w} ${h} Z`;
    capas += `<path d="${d}" fill="${c}" opacity="${0.92}"/>`;
  });
  let estrellas = "";
  if (nombre === "noche") for (let i = 0; i < 40; i++) estrellas += `<circle cx="${(R(seed, 40 + i) * w).toFixed(1)}" cy="${(R(seed, 90 + i) * h * 0.5).toFixed(1)}" r="${(0.8 + R(seed, 140 + i) * 1.8).toFixed(1)}" fill="#fff" opacity="${(0.4 + R(seed, 190 + i) * 0.6).toFixed(2)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.cielo[2]}"/><stop offset="0.55" stop-color="${p.cielo[1]}"/><stop offset="1" stop-color="${p.cielo[0]}"/></linearGradient>
      <radialGradient id="a"><stop offset="0" stop-color="${p.astro}"/><stop offset="1" stop-color="${p.astro}" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#c)"/>${estrellas}
    <circle cx="${ax}" cy="${ay}" r="${ar * 3.2}" fill="url(#a)" opacity="0.55"/>
    <circle cx="${ax}" cy="${ay}" r="${ar}" fill="${p.astro}"/>
    ${capas}
  </svg>`;
}
const png = (nombre, w, h, seed) => sharp(Buffer.from(escena(nombre, w, h, seed))).png().toBuffer();

// 1) las cuatro «fotos» de las formas (cuadradas; las formas las recortan)
for (let i = 0; i < 4; i++) {
  const b = await png(["atardecer", "montanas", "mar", "bosque"][i], 640, 640, 3 + i * 7);
  await sharp(b).webp({ quality: 74 }).toFile(join(OUT, `foto-${i + 1}.webp`));
}

// 2) la biblioteca: una rejilla de 3 columnas con fotos verticales, horizontales y cuadradas
const COLS = 3, W = 1080, G = 14, CW = (W - G * (COLS + 1)) / COLS;
const formas = [1.33, 0.75, 1, 0.75, 1.33, 1, 1, 0.75, 1.33, 0.75, 1, 1.33, 1.33, 1, 0.75, 1, 0.75, 1.33, 0.75, 1.33, 1, 1.33, 0.75, 1];
const alto = Array(COLS).fill(G);
const piezas = [];
for (let i = 0; i < formas.length; i++) {
  const col = alto.indexOf(Math.min(...alto));
  const h = Math.round(CW / formas[i]);
  const nombre = NOMBRES[i % NOMBRES.length];
  const b = await sharp(await png(nombre, Math.round(CW), h, i * 5 + 1)).composite([{ input: Buffer.from(`<svg width="${Math.round(CW)}" height="${h}"><rect width="100%" height="100%" rx="22" ry="22" fill="#fff"/></svg>`), blend: "dest-in" }]).png().toBuffer();
  piezas.push({ input: b, left: Math.round(G + col * (CW + G)), top: alto[col] });
  alto[col] += h + G;
}
const H = Math.max(...alto);
const rejilla = join(OUT, "_rejilla.png");
await sharp({ create: { width: W, height: H, channels: 4, background: "#eef1f7" } }).composite(piezas).png().toFile(rejilla);

// 3) el vídeo: la rejilla desplazándose despacio dentro de un «móvil» (9:16), en bucle
const VW = 540, VH = 960, SEG = 12, FPS = 24;
const recorrido = Math.max(1, H * (VW / W) - VH); // alto de la rejilla escalada menos la ventana
const y = `${recorrido.toFixed(0)}*(0.5-0.5*cos(2*PI*t/${SEG}))`; // sube y baja suave: el bucle no salta
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-loop", "1", "-framerate", String(FPS), "-i", rejilla,
  "-t", String(SEG),
  "-vf", `scale=${VW}:-1,crop=${VW}:${VH}:0:'${y}',format=yuv420p`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-movflags", "+faststart", "-an",
  join(OUT, "biblioteca.mp4"),
]);
await sharp(rejilla).resize(VW).extract({ left: 0, top: 0, width: VW, height: VH }).jpeg({ quality: 70 }).toFile(join(OUT, "biblioteca.jpg"));
rmSync(rejilla);
writeFileSync(join(OUT, "LEEME.txt"), "Generado por tools/generar-portada.mjs. Ilustraciones propias; no son fotos de personas.\n");
console.log("listo", OUT);
