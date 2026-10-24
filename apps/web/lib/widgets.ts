export type TipoWidget = "foto" | "coleccion" | "album" | "nota" | "espacio" | "recuerdos";
export type Rotacion = "vez" | "hora" | "dia" | "fija";

export interface ConfigWidget {
  assetIds?: string[];
  origen?: "seleccion" | "favoritas" | "recientes" | "album";
  albumId?: string;
  noteId?: string;
  celdas?: 2 | 4 | 6 | 9;
  hueco?: number;
  rotar?: Rotacion;
  marco?: "sin" | "fino" | "polaroid";
  esquinas?: number;
  mostrarNombre?: boolean;
  mostrarTitulo?: boolean;
}

export interface Widget {
  id: string;
  token: string;
  name: string;
  kind: TipoWidget;
  config: ConfigWidget;
  position: number;
  createdAt: string;
  updatedAt: string;
  lastUsed: string | null;
}

export class ErrorWidgets extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api/widgets${path}`, {
    cache: "no-store",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErrorWidgets(res.status, (data as { error?: string }).error ?? "No se pudo completar la acción");
  return data as T;
}

export const TIPOS: { id: TipoWidget; titulo: string; desc: string; icono: string }[] = [
  { id: "foto", titulo: "Una foto", desc: "Tu mejor foto, o varias que van cambiando", icono: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-4 4 3 3-2 6 4M9 9.5h.01" },
  { id: "coleccion", titulo: "Mosaico de fotos", desc: "Varias fotos juntas: tus últimas, favoritas, de un álbum o las que elijas", icono: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" },
  { id: "album", titulo: "Un álbum", desc: "La portada de un álbum con su nombre", icono: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 14l3-3 2 2 3-3 2 2" },
  { id: "nota", titulo: "Una nota", desc: "Una nota tuya con su color y su estilo", icono: "M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M8.5 13h7M8.5 17h5" },
  { id: "recuerdos", titulo: "Recuerdos", desc: "Fotos de este mismo día en otros años", icono: "M12 8v4l3 2M21 12a9 9 0 1 1-3-6.7M21 3v5h-5" },
  { id: "espacio", titulo: "Mi espacio", desc: "Cuánto llevas guardado y cuánto te queda", icono: "M12 3a9 9 0 1 0 9 9M12 3v9h9" },
];

export const NOMBRE_TIPO: Record<TipoWidget, string> = Object.fromEntries(TIPOS.map((t) => [t.id, t.titulo])) as Record<TipoWidget, string>;

export const TALLAS = [
  { id: "small", nombre: "Pequeño", w: 400, h: 400 },
  { id: "medium", nombre: "Mediano", w: 800, h: 380 },
  { id: "large", nombre: "Grande", w: 800, h: 840 },
] as const;
export type Talla = (typeof TALLAS)[number]["id"];

/** Dirección pública del dibujo (la «llave» va en la ruta). */
export function urlDibujo(origen: string, token: string, talla: Talla | "full", ext: "png" | "jpg" = "png"): string {
  return `${origen}/_api/v1/w/${token}.${ext}?s=${talla}`;
}

/** Script para la app gratuita Scriptable (widgets de la pantalla de inicio de iPhone). */
export function scriptScriptable(origen: string, w: Widget): string {
  const nombre = w.name.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 40) || "widget";
  return `// Upscale · ${nombre}
// Widget de la pantalla de inicio. Se actualiza solo (iOS decide cada cuánto).
const BASE = "${origen}/_api/v1/w/${w.token}";
const familia = config.widgetFamily || "medium";
const talla = familia === "small" ? "small" : familia === "medium" ? "medium" : "large";
const w = new ListWidget();
try {
  w.backgroundImage = await new Request(BASE + ".png?s=" + talla + "&t=" + Date.now()).loadImage();
} catch (e) {
  w.backgroundColor = new Color("#14224f");
  const t = w.addText("Upscale: sin conexión");
  t.textColor = Color.white();
  t.font = Font.boldSystemFont(13);
}
w.url = "${origen}/app";
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
`;
}
