import type { NoteStyle } from "@upscale/shared";

/**
 * Validación de la personalización de una nota. Todo son valores acotados
 * (colores hexadecimales, números con rango, listas cerradas): nada de CSS libre,
 * así que un estilo nunca puede inyectar nada en la página.
 */

export class EstiloInvalido extends Error {}

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const BORDES = new Set(["none", "solid", "dashed", "dotted", "double"]);
const SOMBRAS = new Set(["none", "soft", "medium", "strong"]);
const FUENTES = new Set(["sans", "serif", "mono", "display"]);
const ALINEACIONES = new Set(["left", "center", "right"]);

function fail(msg: string): never {
  throw new EstiloInvalido(msg);
}

const color = (v: unknown, campo: string): string => (typeof v === "string" && HEX.test(v) ? v : fail(`color no válido en «${campo}»`));
function numero(v: unknown, min: number, max: number, campo: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) fail(`«${campo}» debe estar entre ${min} y ${max}`);
  return Math.round(n * 100) / 100;
}

export function normalizarEstilo(raw: unknown): NoteStyle {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) fail("estilo no válido");
  const s = raw as Record<string, unknown>;
  const out: NoteStyle = {};

  if (s.preset !== undefined) {
    if (typeof s.preset !== "string" || !/^[a-z0-9-]{1,30}$/.test(s.preset)) fail("estilo predefinido no válido");
    out.preset = s.preset;
  }
  if (s.bg !== undefined && s.bg !== null) {
    const b = s.bg as Record<string, unknown>;
    if (b.type === "solid") out.bg = { type: "solid", color: color(b.color, "fondo") };
    else if (b.type === "gradient")
      out.bg = { type: "gradient", from: color(b.from, "degradado (inicio)"), to: color(b.to, "degradado (final)"), angle: numero(b.angle ?? 135, 0, 360, "ángulo") };
    else fail("tipo de fondo no válido");
  }
  if (s.text !== undefined && s.text !== null) out.text = color(s.text, "texto");
  if (s.border !== undefined && s.border !== null) {
    const b = s.border as Record<string, unknown>;
    if (typeof b.style !== "string" || !BORDES.has(b.style)) fail("estilo de borde no válido");
    out.border = {
      width: numero(b.width ?? 0, 0, 8, "grosor del borde"),
      style: b.style as NonNullable<NoteStyle["border"]>["style"],
      color: color(b.color ?? "#000000", "borde"),
      radius: numero(b.radius ?? 0, 0, 40, "esquinas"),
    };
  }
  if (s.shadow !== undefined && s.shadow !== null) {
    if (typeof s.shadow !== "string" || !SOMBRAS.has(s.shadow)) fail("sombra no válida");
    out.shadow = s.shadow as NoteStyle["shadow"];
  }
  if (s.font !== undefined && s.font !== null) {
    if (typeof s.font !== "string" || !FUENTES.has(s.font)) fail("tipo de letra no válido");
    out.font = s.font as NoteStyle["font"];
  }
  if (s.size !== undefined && s.size !== null) out.size = numero(s.size, 13, 24, "tamaño de letra");
  if (s.lineHeight !== undefined && s.lineHeight !== null) out.lineHeight = numero(s.lineHeight, 1.2, 2, "interlineado");
  if (s.align !== undefined && s.align !== null) {
    if (typeof s.align !== "string" || !ALINEACIONES.has(s.align)) fail("alineación no válida");
    out.align = s.align as NoteStyle["align"];
  }
  if (s.padding !== undefined && s.padding !== null) out.padding = numero(s.padding, 8, 48, "margen interior");
  return out;
}

/** Etiquetas: hasta 10, de 1 a 30 caracteres, sin duplicados (ignorando mayúsculas). */
export function normalizarEtiquetas(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new EstiloInvalido("las etiquetas deben ser una lista");
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const limpia = t.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!limpia) continue;
    const k = limpia.toLocaleLowerCase("es");
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push(limpia);
  }
  if (out.length > 10) throw new EstiloInvalido("como máximo 10 etiquetas");
  return out;
}
