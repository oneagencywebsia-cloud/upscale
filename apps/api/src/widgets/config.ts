import { query } from "../db.js";

/**
 * Configuración de cada tipo de widget, validada en el servidor: solo se guardan
 * campos conocidos y solo con ids que son de la propia cuenta.
 */
export class WidgetInvalido extends Error {}

export const TIPOS = ["foto", "coleccion", "album", "nota", "espacio", "recuerdos"] as const;
export type Tipo = (typeof TIPOS)[number];
export const ROTACIONES = ["vez", "hora", "dia", "fija"] as const;
export type Rotacion = (typeof ROTACIONES)[number];

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

export const MAX_WIDGETS = 20;
export const MAX_FOTOS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const num = (v: unknown, min: number, max: number, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const uuid = (v: unknown, que: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new WidgetInvalido(`${que} no válido`);
  return v.toLowerCase();
};

async function fotosPropias(userId: string, ids: unknown, min: number): Promise<string[]> {
  if (!Array.isArray(ids)) throw new WidgetInvalido("Elige al menos una foto");
  const lista = [...new Set(ids.map((i) => uuid(i, "Foto")))].slice(0, MAX_FOTOS);
  if (lista.length < min) throw new WidgetInvalido(min === 1 ? "Elige al menos una foto" : `Elige al menos ${min} fotos`);
  const { rows } = await query<{ id: string }>(
    "select id from assets where user_id = $1 and id = any($2::uuid[]) and kind = 'photo' and deleted_at is null",
    [userId, lista],
  );
  const ok = new Set(rows.map((r) => r.id));
  const buenas = lista.filter((i) => ok.has(i));
  if (buenas.length < min) throw new WidgetInvalido("Alguna de esas fotos ya no existe");
  return buenas; // conserva el orden elegido
}

async function albumPropio(userId: string, id: unknown): Promise<string> {
  const a = uuid(id, "Álbum");
  const r = await query("select 1 from albums where id = $1 and user_id = $2", [a, userId]);
  if (!r.rowCount) throw new WidgetInvalido("Ese álbum no existe");
  return a;
}

/** Valida y normaliza. Lanza `WidgetInvalido` con un mensaje para la persona. */
export async function validarConfig(userId: string, kind: unknown, raw: unknown): Promise<{ kind: Tipo; config: ConfigWidget }> {
  if (typeof kind !== "string" || !(TIPOS as readonly string[]).includes(kind)) throw new WidgetInvalido("Tipo de widget no válido");
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rot = (def: Rotacion): Rotacion => ((ROTACIONES as readonly string[]).includes(r.rotar as string) ? (r.rotar as Rotacion) : def);
  const comun: ConfigWidget = { esquinas: num(r.esquinas, 0, 60, 0) };

  switch (kind as Tipo) {
    case "foto": {
      const assetIds = await fotosPropias(userId, r.assetIds, 1);
      return {
        kind: "foto",
        config: {
          ...comun,
          assetIds,
          rotar: assetIds.length > 1 ? rot("dia") : "fija",
          marco: (["sin", "fino", "polaroid"] as const).includes(r.marco as never) ? (r.marco as "sin" | "fino" | "polaroid") : "sin",
        },
      };
    }
    case "coleccion": {
      const origen = (["seleccion", "favoritas", "recientes", "album"] as const).includes(r.origen as never) ? (r.origen as ConfigWidget["origen"]) : "recientes";
      const config: ConfigWidget = {
        ...comun,
        origen,
        celdas: ([2, 4, 6, 9] as const).includes(Number(r.celdas) as never) ? (Number(r.celdas) as 2 | 4 | 6 | 9) : 4,
        hueco: num(r.hueco, 0, 24, 6),
        rotar: rot(origen === "seleccion" ? "fija" : "dia"),
      };
      if (origen === "seleccion") config.assetIds = await fotosPropias(userId, r.assetIds, 2);
      if (origen === "album") config.albumId = await albumPropio(userId, r.albumId);
      return { kind: "coleccion", config };
    }
    case "album":
      return {
        kind: "album",
        config: { ...comun, albumId: await albumPropio(userId, r.albumId), mostrarNombre: r.mostrarNombre !== false, rotar: rot("fija") },
      };
    case "nota": {
      const id = uuid(r.noteId, "Nota");
      const n = await query("select 1 from notes where id = $1 and user_id = $2 and deleted_at is null", [id, userId]);
      if (!n.rowCount) throw new WidgetInvalido("Esa nota no existe");
      return { kind: "nota", config: { ...comun, noteId: id, mostrarTitulo: r.mostrarTitulo !== false } };
    }
    case "espacio":
      return { kind: "espacio", config: { ...comun } };
    case "recuerdos":
      return { kind: "recuerdos", config: { ...comun, rotar: rot("dia") } };
  }
}

export function nombrePorDefecto(kind: Tipo): string {
  return { foto: "Mi foto", coleccion: "Mis fotos", album: "Mi álbum", nota: "Mi nota", espacio: "Mi espacio", recuerdos: "Recuerdos" }[kind];
}
