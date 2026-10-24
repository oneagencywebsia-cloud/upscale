import type { CSSProperties } from "react";
import type { Note, NoteListItem, NoteStyle, NoteListResponse, NoteAttachment } from "@upscale/shared";

export type { Note, NoteListItem, NoteStyle, NoteListResponse, NoteAttachment };

/* ------------------------------------------------------------- llamadas */

export class ErrorApi extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api/notes${path}`, {
    cache: "no-store",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErrorApi(res.status, (data as { error?: string }).error ?? "No se pudo completar la acción", data);
  return data as T;
}

/* --------------------------------------------------------------- estilo */

const FUENTES: Record<NonNullable<NoteStyle["font"]>, string> = {
  sans: "var(--font-body), system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "var(--font-mono), ui-monospace, Menlo, monospace",
  display: "var(--font-display), system-ui, sans-serif",
};
const SOMBRAS: Record<NonNullable<NoteStyle["shadow"]>, string> = {
  none: "none",
  soft: "0 1px 2px rgba(10,20,60,.18), 0 6px 14px -6px rgba(10,20,60,.28)",
  medium: "0 2px 4px rgba(10,20,60,.2), 0 12px 24px -8px rgba(10,20,60,.38)",
  strong: "0 4px 8px rgba(10,20,60,.24), 0 22px 44px -12px rgba(10,20,60,.55)",
};
export const FUENTE_NOMBRES: Record<NonNullable<NoteStyle["font"]>, string> = {
  sans: "Moderna",
  serif: "Clásica",
  mono: "Máquina",
  display: "Titular",
};

/** Convierte el estilo guardado en CSS. Lo que falta cae al tema (variables de la app). */
export function estiloCss(s: NoteStyle | undefined, opts?: { compacto?: boolean }): CSSProperties {
  const e = s ?? {};
  const css: Record<string, string | number> = {};
  if (e.bg?.type === "solid") css.background = e.bg.color;
  else if (e.bg?.type === "gradient") css.background = `linear-gradient(${e.bg.angle}deg, ${e.bg.from}, ${e.bg.to})`;
  if (e.text) css["--note-ink"] = e.text;
  if (e.border) {
    css.border = e.border.style === "none" || e.border.width === 0 ? "none" : `${e.border.width}px ${e.border.style} ${e.border.color}`;
    css.borderRadius = e.border.radius;
  }
  if (e.shadow) css.boxShadow = SOMBRAS[e.shadow];
  if (e.font) css["--note-font"] = FUENTES[e.font];
  if (e.size) css["--note-size"] = `${opts?.compacto ? Math.min(e.size, 15) : e.size}px`;
  if (e.lineHeight) css["--note-lh"] = e.lineHeight;
  if (e.align) css["--note-align"] = e.align;
  if (e.padding && !opts?.compacto) css["--note-pad"] = `${e.padding}px`;
  return css as CSSProperties;
}

/* ------------------------------------------------------------ predefinidos */

export interface Preset {
  id: string;
  name: string;
  style: NoteStyle;
}
const b = (color: string, width = 1, style: "solid" | "dashed" | "dotted" | "double" = "solid", radius = 14) => ({ width, style, color, radius });

export const PRESETS: Preset[] = [
  { id: "tema", name: "Tema", style: {} },
  { id: "postit", name: "Post-it", style: { preset: "postit", bg: { type: "solid", color: "#fff3b0" }, text: "#3b3200", border: b("#e8d570", 1, "solid", 6), shadow: "soft", font: "display" } },
  { id: "menta", name: "Menta", style: { preset: "menta", bg: { type: "solid", color: "#d9f7e8" }, text: "#0f3d2a", border: b("#9fdcc0"), shadow: "soft" } },
  { id: "cielo", name: "Cielo", style: { preset: "cielo", bg: { type: "solid", color: "#dbeafe" }, text: "#0c2a5a", border: b("#9dbdf0"), shadow: "soft" } },
  { id: "rosa", name: "Rosa", style: { preset: "rosa", bg: { type: "solid", color: "#fde2ec" }, text: "#5a1030", border: b("#f3a9c4"), shadow: "soft" } },
  { id: "lavanda", name: "Lavanda", style: { preset: "lavanda", bg: { type: "solid", color: "#e9e1ff" }, text: "#2c1a66", border: b("#bfaef0"), shadow: "soft" } },
  { id: "papel", name: "Papel", style: { preset: "papel", bg: { type: "solid", color: "#fbf6e9" }, text: "#3a3220", border: b("#e2d6b8", 1, "solid", 4), shadow: "medium", font: "serif", lineHeight: 1.7 } },
  { id: "cuaderno", name: "Cuaderno", style: { preset: "cuaderno", bg: { type: "solid", color: "#ffffff" }, text: "#1d2a4a", border: b("#7a8fc4", 2, "dashed", 12), shadow: "none", font: "display" } },
  { id: "pizarra", name: "Pizarra", style: { preset: "pizarra", bg: { type: "solid", color: "#1f2937" }, text: "#f1f5f9", border: b("#374151", 1, "solid", 10), shadow: "medium", font: "mono", size: 15 } },
  { id: "medianoche", name: "Medianoche", style: { preset: "medianoche", bg: { type: "gradient", from: "#1b2c63", to: "#0b1230", angle: 160 }, text: "#eef3ff", border: b("#3b4f95"), shadow: "strong" } },
  { id: "atardecer", name: "Atardecer", style: { preset: "atardecer", bg: { type: "gradient", from: "#ffb27a", to: "#ff7a85", angle: 135 }, text: "#2b0d0a", border: b("#ffffff", 0), shadow: "medium", font: "display" } },
  { id: "oceano", name: "Océano", style: { preset: "oceano", bg: { type: "gradient", from: "#7adcec", to: "#8d9bff", angle: 145 }, text: "#04121a", border: b("#ffffff", 0), shadow: "medium" } },
];

/* ---------------------------------------------------------------- contraste */

function luminancia(hex: string): number {
  const h = hex.replace("#", "").slice(0, 6);
  const [r, g, b2] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
}
export function contraste(a: string, b2: string): number {
  const [x, y] = [luminancia(a), luminancia(b2)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Peor contraste del texto sobre el fondo (en degradado, el de su extremo más flojo). null = usa el tema. */
export function contrasteNota(s: NoteStyle): number | null {
  if (!s.text || !s.bg) return null;
  const fondos = s.bg.type === "solid" ? [s.bg.color] : [s.bg.from, s.bg.to];
  return Math.min(...fondos.map((f) => contraste(s.text!, f)));
}

/* -------------------------------------------------------------------- texto */

/** Texto plano de una nota (exportar / copiar). Recorre el documento del editor. */
export function textoDeDoc(doc: unknown): string {
  const out: string[] = [];
  const hijos = (n: unknown): unknown[] => ((n as { content?: unknown[] })?.content ?? []);
  const inline = (n: unknown): string =>
    hijos(n)
      .map((c) => {
        const t = c as { type?: string; text?: string };
        return t.type === "text" ? t.text ?? "" : t.type === "hardBreak" ? "\n" : inline(c);
      })
      .join("");
  const bloque = (n: unknown, prefijo = "", nivel = 0) => {
    const t = (n as { type?: string; attrs?: { checked?: boolean; level?: number } }) ?? {};
    const sangria = "  ".repeat(nivel);
    switch (t.type) {
      case "bulletList":
      case "orderedList":
      case "taskList":
        hijos(n).forEach((li, i) => {
          const marca = t.type === "orderedList" ? `${i + 1}. ` : t.type === "taskList" ? ((li as { attrs?: { checked?: boolean } }).attrs?.checked ? "[x] " : "[ ] ") : "- ";
          const [primero, ...resto] = hijos(li);
          out.push(`${sangria}${marca}${primero ? inline(primero) : ""}`);
          resto.forEach((r) => bloque(r, prefijo, nivel + 1));
        });
        break;
      case "blockquote":
        hijos(n).forEach((c) => bloque(c, "> ", nivel));
        break;
      case "horizontalRule":
        out.push("---");
        break;
      case "heading":
        out.push(`${"#".repeat(t.attrs?.level ?? 1)} ${inline(n)}`);
        out.push("");
        break;
      default:
        out.push(...inline(n).split("\n").map((l) => `${sangria}${prefijo}${l}`));
        out.push("");
    }
  };
  hijos(doc).forEach((n) => bloque(n));
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function haceTiempo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `hace ${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}
