import sharp, { type Sharp, type OverlayOptions } from "sharp";
import { query, one } from "../db.js";
import { cuotaDe } from "../accounts.js";
import type { NoteStyle } from "@upscale/shared";
import type { ConfigWidget, Rotacion, Tipo } from "./config.js";

/**
 * Dibuja un widget como imagen. Solo usa los derivados que ya están en la base de
 * datos (miniatura 640 px y «póster» 1600 px): nunca toca los originales ni Telegram,
 * así que es rápido y no puede filtrar nada más grande.
 */

export interface FilaWidget {
  id: string;
  user_id: string;
  name: string;
  kind: Tipo;
  config: ConfigWidget;
}
export interface Medidas {
  w: number;
  h: number;
  /** pensado como fondo de pantalla: el contenido baja para no taparlo el reloj */
  /** forzar la rotación (el modo marco pide «vez») */
  rot?: Rotacion;
}
export interface Dibujo {
  buf: Buffer;
  tipo: "image/png" | "image/jpeg";
}

export const MIN_LADO = 64;
export const MAX_LADO = 2800;
export const PRESETS: Record<string, { w: number; h: number }> = {
  small: { w: 400, h: 400 },
  medium: { w: 800, h: 380 },
  large: { w: 800, h: 840 },
  full: { w: 1600, h: 1000 },
};

const AZUL = "#14214d";
const hex = (c: unknown, def: string) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : def);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* --------------------------------------------------------------- utilidades */

function indice(rot: Rotacion | undefined, n: number, fuerza?: Rotacion): number {
  if (n <= 1) return 0;
  const r = fuerza ?? rot ?? "fija";
  if (r === "vez") return Math.floor(Math.random() * n);
  if (r === "hora") return Math.floor(Date.now() / 3.6e6) % n;
  if (r === "dia") return Math.floor(Date.now() / 8.64e7) % n;
  return 0;
}

/** Recorta las esquinas (PNG con transparencia). */
async function redondear(buf: Buffer, w: number, h: number, radio: number): Promise<Buffer> {
  if (radio <= 0) return buf;
  const r = Math.min(radio, Math.min(w, h) / 2);
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
  return sharp(buf).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

async function salida(img: Sharp, w: number, h: number, cfg: ConfigWidget, prefierePng: boolean): Promise<Dibujo> {
  const radio = Math.round(((cfg.esquinas ?? 0) * Math.min(w, h)) / 380);
  if (prefierePng || radio > 0) {
    const png = await img.png({ compressionLevel: 6 }).toBuffer();
    return { buf: await redondear(png, w, h, radio), tipo: "image/png" };
  }
  return { buf: await img.jpeg({ quality: 86 }).toBuffer(), tipo: "image/jpeg" };
}

async function fondoSvg(w: number, h: number, svgInterior: string): Promise<Sharp> {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svgInterior}</svg>`));
}

/** Texto con ajuste de línea real (Pango). Devuelve el PNG con transparencia y su alto. */
async function texto(markup: string, font: string, ancho: number, align: "left" | "centre" | "right", spacing = 0): Promise<{ buf: Buffer; h: number; w: number }> {
  const { data, info } = await sharp({ text: { text: markup, font, width: Math.max(8, Math.round(ancho)), rgba: true, wrap: "word", align, spacing } })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { buf: data, h: info.height, w: info.width };
}

/* ------------------------------------------------------------------- fotos */

async function bytesFoto(id: string, grande: boolean): Promise<Buffer | null> {
  const r = await one<{ b: Buffer | null; t: Buffer | null }>(
    "select poster_jpg as b, thumb_webp as t from assets where id = $1 and deleted_at is null",
    [id],
  );
  if (!r) return null;
  const pick = grande ? (r.b && r.b.length > 4 ? r.b : r.t) : r.t && r.t.length > 4 ? r.t : r.b;
  return pick && pick.length > 4 ? pick : null;
}

async function idsDe(w: FilaWidget, n: number): Promise<{ ids: string[]; texto?: string }> {
  const c = w.config;
  const u = w.user_id;
  if (w.kind === "foto" || (w.kind === "coleccion" && c.origen === "seleccion")) return { ids: (c.assetIds ?? []).slice(0, 30) };
  if (w.kind === "coleccion" && c.origen === "favoritas") {
    const { rows } = await query<{ id: string }>(
      "select id from assets where user_id = $1 and is_favorite and kind = 'photo' and deleted_at is null order by random() limit $2",
      [u, Math.max(n * 3, 12)],
    );
    return { ids: rows.map((r) => r.id) };
  }
  if (w.kind === "coleccion" && c.origen === "album") {
    const { rows } = await query<{ id: string }>(
      `select a.id from album_assets aa join assets a on a.id = aa.asset_id
        where aa.album_id = $2 and a.user_id = $1 and a.kind = 'photo' and a.deleted_at is null order by random() limit $3`,
      [u, c.albumId, Math.max(n * 3, 12)],
    );
    return { ids: rows.map((r) => r.id) };
  }
  // recientes
  const { rows } = await query<{ id: string }>(
    "select id from assets where user_id = $1 and kind = 'photo' and deleted_at is null order by uploaded_at desc limit $2",
    [u, Math.max(n * 3, 12)],
  );
  return { ids: rows.map((r) => r.id) };
}

function vacio(w: number, h: number, titulo: string, sub: string): Promise<Sharp> {
  const s = Math.min(w, h);
  return fondoSvg(
    w,
    h,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d3068"/><stop offset="1" stop-color="#0f1a3f"/></linearGradient></defs>
     <rect width="100%" height="100%" fill="url(#g)"/>
     <text x="50%" y="${h * 0.46}" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="${s * 0.075}" fill="#eef3ff">${esc(titulo)}</text>
     <text x="50%" y="${h * 0.46 + s * 0.11}" text-anchor="middle" font-family="DejaVu Sans" font-size="${s * 0.05}" fill="#a9b6d6">${esc(sub)}</text>`,
  );
}

/** Texto inferior sobre degradado (álbum, recuerdos). */
function pie(w: number, h: number, linea1: string, linea2?: string): Buffer {
  const s = Math.min(w, h);
  const f1 = Math.round(s * 0.085);
  const f2 = Math.round(s * 0.052);
  const alto = Math.round(s * (linea2 ? 0.34 : 0.26));
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050a1e" stop-opacity="0"/><stop offset="1" stop-color="#050a1e" stop-opacity="0.78"/></linearGradient></defs>
      <rect x="0" y="${h - alto}" width="${w}" height="${alto}" fill="url(#d)"/>
      <text x="${s * 0.06}" y="${h - s * (linea2 ? 0.115 : 0.07)}" font-family="DejaVu Sans" font-weight="700" font-size="${f1}" fill="#fff">${esc(linea1.slice(0, 40))}</text>
      ${linea2 ? `<text x="${s * 0.06}" y="${h - s * 0.05}" font-family="DejaVu Sans" font-size="${f2}" fill="#dbe6ff">${esc(linea2.slice(0, 50))}</text>` : ""}
    </svg>`,
  );
}

async function conMarco(foto: Buffer, w: number, h: number, marco: ConfigWidget["marco"]): Promise<Sharp> {
  const base = sharp(foto).rotate();
  if (marco === "fino") {
    const b = Math.max(4, Math.round(Math.min(w, h) * 0.025));
    const dentro = await base.resize(w - b * 2, h - b * 2, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 90 }).toBuffer();
    return sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } }).composite([{ input: dentro, left: b, top: b }]);
  }
  if (marco === "polaroid") {
    const lado = Math.round(Math.min(w, h) * 0.05);
    const abajo = Math.round(Math.min(w, h) * 0.17);
    const dentro = await base
      .resize(w - lado * 2, h - lado - abajo, { fit: "cover", position: sharp.strategy.attention })
      .jpeg({ quality: 90 })
      .toBuffer();
    return sharp({ create: { width: w, height: h, channels: 3, background: "#fbf8f1" } }).composite([{ input: dentro, left: lado, top: lado }]);
  }
  return base.resize(w, h, { fit: "cover", position: sharp.strategy.attention });
}

async function dibujarFoto(w: FilaWidget, m: Medidas): Promise<Dibujo> {
  const { ids } = await idsDe(w, 1);
  if (!ids.length) return salida(await vacio(m.w, m.h, "Aún no hay fotos", "Sube alguna a Upscale"), m.w, m.h, w.config, true);
  const pick = ids[indice(w.config.rotar, ids.length, m.rot)]!;
  const foto = await bytesFoto(pick, true);
  if (!foto) return salida(await vacio(m.w, m.h, "Foto no disponible", "Elige otra en el widget"), m.w, m.h, w.config, true);
  return salida(await conMarco(foto, m.w, m.h, w.config.marco), m.w, m.h, w.config, false);
}

async function dibujarColeccion(w: FilaWidget, m: Medidas): Promise<Dibujo> {
  const n = w.config.celdas ?? 4;
  const { ids } = await idsDe(w, n);
  if (!ids.length) return salida(await vacio(m.w, m.h, "Aún no hay fotos", "Sube alguna a Upscale"), m.w, m.h, w.config, true);
  // con rotación se parte de otro punto de la lista; sin rotación, las primeras
  const desde = ids.length > n ? indice(w.config.rotar, ids.length, m.rot) : 0;
  const elegidas = Array.from({ length: Math.min(n, ids.length) }, (_, i) => ids[(desde + i) % ids.length]);
  // cuadrícula según la forma del widget
  const horizontal = m.w >= m.h * 1.25;
  const total = elegidas.length;
  const cols = total === 1 ? 1 : horizontal ? Math.ceil(total / (total > 4 ? 2 : total > 2 ? 2 : 1)) : total <= 2 ? 1 : total <= 4 ? 2 : total <= 6 ? 2 : 3;
  const filas = Math.ceil(total / cols);
  const hueco = Math.round(((w.config.hueco ?? 6) * Math.min(m.w, m.h)) / 380);
  const ch = Math.floor((m.h - hueco * (filas + 1)) / filas);
  const piezas: OverlayOptions[] = [];
  for (let i = 0; i < total; i++) {
    const fila = Math.floor(i / cols);
    // la última fila, si queda incompleta, reparte todo el ancho entre sus fotos (sin huecos vacíos)
    const enFila = fila === filas - 1 ? total - cols * (filas - 1) : cols;
    const cw = Math.floor((m.w - hueco * (enFila + 1)) / enFila);
    const b = await bytesFoto(elegidas[i]!, false);
    if (!b) continue;
    const c = await sharp(b).rotate().resize(cw, ch, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 85 }).toBuffer();
    piezas.push({ input: c, left: hueco + (i - fila * cols) * (cw + hueco), top: hueco + fila * (ch + hueco) });
  }
  const lienzo = sharp({ create: { width: m.w, height: m.h, channels: 3, background: AZUL } }).composite(piezas);
  return salida(lienzo, m.w, m.h, w.config, false);
}

async function dibujarAlbum(w: FilaWidget, m: Medidas): Promise<Dibujo> {
  const a = await one<{ name: string; n: string }>(
    `select al.name, (select count(*) from album_assets aa join assets s on s.id = aa.asset_id where aa.album_id = al.id and s.deleted_at is null) as n
       from albums al where al.id = $1 and al.user_id = $2`,
    [w.config.albumId, w.user_id],
  );
  if (!a) return salida(await vacio(m.w, m.h, "Álbum no encontrado", "Elige otro en el widget"), m.w, m.h, w.config, true);
  const { rows } = await query<{ id: string }>(
    `select s.id from album_assets aa join assets s on s.id = aa.asset_id
      where aa.album_id = $1 and s.user_id = $2 and s.kind = 'photo' and s.deleted_at is null order by aa.added_at desc limit 30`,
    [w.config.albumId, w.user_id],
  );
  const n = Number(a.n);
  const sub = `${n.toLocaleString("es-ES")} ${n === 1 ? "elemento" : "elementos"}`;
  if (!rows.length) return salida(await vacio(m.w, m.h, a.name.slice(0, 28), "Álbum sin fotos"), m.w, m.h, w.config, true);
  const foto = await bytesFoto(rows[indice(w.config.rotar, rows.length, m.rot)]!.id, true);
  if (!foto) return salida(await vacio(m.w, m.h, a.name.slice(0, 28), sub), m.w, m.h, w.config, true);
  const base = await sharp(foto).rotate().resize(m.w, m.h, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 88 }).toBuffer();
  const img = w.config.mostrarNombre === false ? sharp(base) : sharp(base).composite([{ input: pie(m.w, m.h, a.name, sub) }]);
  return salida(img, m.w, m.h, w.config, false);
}

async function dibujarRecuerdos(w: FilaWidget, m: Medidas): Promise<Dibujo> {
  const hoy = new Date();
  const { rows } = await query<{ id: string; anios: number }>(
    `select id, (extract(year from now())::int - extract(year from captured_at)::int) as anios
       from assets
      where user_id = $1 and kind = 'photo' and deleted_at is null
        and to_char(captured_at, 'MM-DD') = $2 and extract(year from captured_at) < extract(year from now())
      order by captured_at desc limit 30`,
    [w.user_id, `${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`],
  );
  let id: string | undefined;
  let leyenda = "Un día como hoy";
  let sub: string | undefined;
  if (rows.length) {
    const r = rows[indice(w.config.rotar, rows.length, m.rot)]!;
    id = r.id;
    sub = r.anios === 1 ? "Hace 1 año" : `Hace ${r.anios} años`;
  } else {
    // sin recuerdos de esta fecha: una foto cualquiera, para que el widget nunca quede vacío
    const x = await one<{ id: string }>("select id from assets where user_id = $1 and kind = 'photo' and deleted_at is null order by random() limit 1", [w.user_id]);
    id = x?.id;
    leyenda = "Tus recuerdos";
    sub = "Hoy no hay fotos de otros años";
  }
  const foto = id ? await bytesFoto(id, true) : null;
  if (!foto) return salida(await vacio(m.w, m.h, "Recuerdos", "Sube fotos para verlas aquí"), m.w, m.h, w.config, true);
  const base = await sharp(foto).rotate().resize(m.w, m.h, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 88 }).toBuffer();
  return salida(sharp(base).composite([{ input: pie(m.w, m.h, leyenda, sub) }]), m.w, m.h, w.config, false);
}

/* -------------------------------------------------------------------- nota */

const FUENTES: Record<string, string> = { sans: "DejaVu Sans", serif: "DejaVu Serif", mono: "DejaVu Sans Mono", display: "DejaVu Sans Bold" };

async function dibujarNota(w: FilaWidget, m: Medidas): Promise<Dibujo> {
  const n = await one<{ title: string; body_text: string; style: NoteStyle }>(
    "select title, body_text, style from notes where id = $1 and user_id = $2 and deleted_at is null",
    [w.config.noteId, w.user_id],
  );
  if (!n) return salida(await vacio(m.w, m.h, "Nota no encontrada", "Elige otra en el widget"), m.w, m.h, w.config, true);
  const st = n.style ?? {};
  const escala = Math.min(m.w, m.h) / 380;
  const pad = Math.round((st.padding ?? 22) * escala * 0.9);
  const radio = st.border?.radius !== undefined ? Math.round(st.border.radius * escala) : Math.round(16 * escala);
  const tinta = hex(st.text, "#eef3ff");
  const fuente = FUENTES[st.font ?? "sans"] ?? FUENTES.sans;
  const bg =
    st.bg?.type === "solid"
      ? `<rect width="100%" height="100%" fill="${hex(st.bg.color, "#1c2b5c")}"/>`
      : st.bg?.type === "gradient"
        ? (() => {
            const a = (st.bg.angle * Math.PI) / 180;
            const x2 = 0.5 + Math.sin(a) / 2, y2 = 0.5 - Math.cos(a) / 2, x1 = 1 - x2, y1 = 1 - y2;
            return `<defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${hex(st.bg.from, "#1b2c63")}"/><stop offset="1" stop-color="${hex(st.bg.to, "#0b1230")}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`;
          })()
        : `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#243569"/><stop offset="1" stop-color="#14224f"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`;
  const borde = st.border && st.border.style !== "none" && st.border.width > 0
    ? `<rect x="${(st.border.width * escala) / 2}" y="${(st.border.width * escala) / 2}" width="${m.w - st.border.width * escala}" height="${m.h - st.border.width * escala}" rx="${radio}" fill="none" stroke="${hex(st.border.color, "#7a8fc4")}" stroke-width="${st.border.width * escala}" ${st.border.style === "dashed" ? `stroke-dasharray="${10 * escala} ${7 * escala}"` : st.border.style === "dotted" ? `stroke-dasharray="1 ${6 * escala}" stroke-linecap="round"` : ""}/>`
    : "";
  // el fondo de pantalla baja el contenido para no tapar el reloj de la pantalla de bloqueo
  const arriba = pad;
  const abajo = pad;
  const ancho = m.w - pad * 2;
  const alto = m.h - arriba - abajo;
  const align = st.align === "center" ? "centre" : st.align === "right" ? "right" : "left";
  const tam0 = Math.round((st.size ?? 16) * escala * 1.15);

  const limpio = (n.body_text || "").replace(/^(\s*)(?:- )?\[x\] /gm, "$1☑ ").replace(/^(\s*)(?:- )?\[ \] /gm, "$1☐ ").replace(/^- /gm, "• ").replace(/\n{3,}/g, "\n\n").trim();
  const tit = w.config.mostrarTitulo === false ? "" : n.title.trim();

  const pintar = async (tam: number, cuerpo: string) => {
    const piezas: { buf: Buffer; h: number }[] = [];
    if (tit) piezas.push({ ...(await texto(`<span foreground="${tinta}" font="${FUENTES.display} ${Math.round(tam * 1.3)}">${esc(tit)}</span>`, `${FUENTES.display} ${Math.round(tam * 1.3)}`, ancho, align)), });
    if (cuerpo) piezas.push({ ...(await texto(`<span foreground="${tinta}">${esc(cuerpo)}</span>`, `${fuente} ${tam}`, ancho, align, Math.round(tam * ((st.lineHeight ?? 1.5) - 1) * 0.9))) });
    const sep = tit && cuerpo ? Math.round(tam * 0.6) : 0;
    return { piezas, alto: piezas.reduce((s, p) => s + p.h, 0) + sep, sep };
  };

  // el tamaño más grande que quepa (búsqueda binaria: el texto crece hasta llenar el widget, sin pasarse)
  const minimo = Math.max(10, Math.round(11 * escala));
  const maximo = Math.round(tam0 * 2.2);
  let lo = minimo, hi = maximo;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((await pintar(mid, limpio)).alto <= alto) lo = mid; else hi = mid - 1;
  }
  let tam = lo;
  let cuerpo = limpio;
  let r = await pintar(tam, cuerpo);
  if (r.alto > alto) {
    // aun al mínimo no cabe: se corta con «…» (búsqueda por mitades)
    let a = 0, b2 = cuerpo.length;
    while (a < b2) {
      const mid = Math.ceil((a + b2) / 2);
      const t = await pintar(tam, `${limpio.slice(0, mid).trimEnd()}…`);
      if (t.alto <= alto) a = mid; else b2 = mid - 1;
    }
    cuerpo = `${limpio.slice(0, a).trimEnd()}…`;
    r = await pintar(tam, cuerpo);
  }
  if (!tit && !cuerpo) r = await pintar(tam, "Nota vacía");

  const capas: OverlayOptions[] = [];
  let y = arriba;
  r.piezas.forEach((p, i) => {
    capas.push({ input: p.buf, left: pad, top: y });
    y += p.h + (i === 0 ? r.sep : 0);
  });
  const lienzo = (await fondoSvg(m.w, m.h, `${bg}${borde}`)).composite(capas);
  // el radio de la propia nota se aplica aquí (PNG con transparencia); como fondo de pantalla, a sangre
  const png = await lienzo.png().toBuffer();
  return { buf: await redondear(png, m.w, m.h, radio), tipo: "image/png" };
}

/* ------------------------------------------------------------------ espacio */

const GB = 1024 ** 3;
const humano = (b: number) => (b >= 1024 * GB ? `${(b / 1024 / GB).toLocaleString("es-ES", { maximumFractionDigits: 1 })} TB` : `${(b / GB).toLocaleString("es-ES", { maximumFractionDigits: b / GB < 10 ? 1 : 0 })} GB`);

async function dibujarEspacio(w: FilaWidget, m: Medidas): Promise<Dibujo> {
  const [cuota, c] = await Promise.all([
    cuotaDe({ userId: w.user_id, email: null }),
    one<{ fotos: string; videos: string; audios: string; notas: string }>(
      `select (select count(*) from assets where user_id = $1 and kind = 'photo' and deleted_at is null) as fotos,
              (select count(*) from assets where user_id = $1 and kind = 'video' and deleted_at is null) as videos,
              (select count(*) from assets where user_id = $1 and kind = 'audio' and deleted_at is null) as audios,
              (select count(*) from notes where user_id = $1 and deleted_at is null) as notas`,
      [w.user_id],
    ),
  ]);
  const usado = cuota.usedBytes;
  const limite = cuota.limitBytes;
  const frac = Math.min(1, limite > 0 ? usado / limite : 0);
  const s = Math.min(m.w, m.h);
  const horizontal = m.w >= m.h * 1.25;
  const r = (horizontal ? s * 0.34 : s * 0.3);
  const cx = horizontal ? r + s * 0.12 : m.w / 2;
  const cy = horizontal ? m.h / 2 : m.h * 0.36;
  const circ = 2 * Math.PI * r;
  const sw = r * 0.22;
  const tx = horizontal ? cx + r + s * 0.12 : m.w / 2;
  const anc = horizontal ? "start" : "middle";
  const color = frac > 0.9 ? "#f16b6b" : frac > 0.7 ? "#ffc98a" : "#4fc5dc";
  const lineas = [
    ["Fotos", Number(c?.fotos ?? 0)],
    ["Vídeos", Number(c?.videos ?? 0)],
    ["Audio", Number(c?.audios ?? 0)],
    ["Notas", Number(c?.notas ?? 0)],
  ] as const;
  const f1 = s * 0.085, f2 = s * 0.052;
  const ty = horizontal ? m.h * 0.3 : cy + r + s * 0.14;
  const conteo = lineas.filter(([, n]) => n > 0).map(([k, n]) => `${n.toLocaleString("es-ES")} ${k.toLowerCase()}`).join("  ·  ");
  const svg = `
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d3068"/><stop offset="1" stop-color="#0f1a3f"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="${sw}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${Math.max(0.001, circ * (cuota.unlimited ? 0.08 : frac))} ${circ}" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy + r * 0.12}" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="${r * 0.5}" fill="#eef3ff">${cuota.unlimited ? "∞" : `${Math.round(frac * 100)}%`}</text>
    <text x="${tx}" y="${ty}" text-anchor="${anc}" font-family="DejaVu Sans" font-weight="700" font-size="${f1}" fill="#fff">${esc(humano(usado))}${cuota.unlimited ? "" : ` de ${esc(humano(limite))}`}</text>
    <text x="${tx}" y="${ty + f2 * 1.7}" text-anchor="${anc}" font-family="DejaVu Sans" font-size="${f2}" fill="#a9b6d6">Plan ${esc(cuota.plan.name)}</text>
    <text x="${tx}" y="${ty + f2 * 3.2}" text-anchor="${anc}" font-family="DejaVu Sans" font-size="${f2 * 0.85}" fill="#93a1c6">${esc(conteo.slice(0, 60))}</text>`;
  return salida(await fondoSvg(m.w, m.h, svg), m.w, m.h, w.config, true);
}

/* ------------------------------------------------------------------- común */

// como mucho 4 dibujos a la vez: una avalancha de peticiones no puede comerse el procesador
const MAX_A_LA_VEZ = 4;
let dibujando = 0;
const cola: (() => void)[] = [];
async function turno<T>(f: () => Promise<T>): Promise<T> {
  if (dibujando >= MAX_A_LA_VEZ) await new Promise<void>((r) => cola.push(r));
  dibujando++;
  try {
    return await f();
  } finally {
    dibujando--;
    cola.shift()?.();
  }
}

export function dibujarWidget(w: FilaWidget, m: Medidas): Promise<Dibujo> {
  return turno(() => dibujar(w, m));
}

async function dibujar(w: FilaWidget, m: Medidas): Promise<Dibujo> {
  const medidas: Medidas = { ...m, w: Math.min(MAX_LADO, Math.max(MIN_LADO, Math.round(m.w))), h: Math.min(MAX_LADO, Math.max(MIN_LADO, Math.round(m.h))) };
  switch (w.kind) {
    case "foto": return dibujarFoto(w, medidas);
    case "coleccion": return dibujarColeccion(w, medidas);
    case "album": return dibujarAlbum(w, medidas);
    case "nota": return dibujarNota(w, medidas);
    case "espacio": return dibujarEspacio(w, medidas);
    case "recuerdos": return dibujarRecuerdos(w, medidas);
  }
}
