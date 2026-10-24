import sharp from "sharp";
import { query } from "./db.js";

export type Orientacion = "vertical" | "horizontal" | "cuadrada";

/** Más de un 5 % de diferencia entre lados: si no, se considera cuadrada. */
export function orientacionDe(w: number, h: number): Orientacion {
  const r = w / h;
  return r > 1.05 ? "horizontal" : r < 0.95 ? "vertical" : "cuadrada";
}

async function deBytes(b: Buffer | null | undefined): Promise<Orientacion | null> {
  if (!b || b.length < 5) return null;
  try {
    const m = await sharp(b, { failOn: "none" }).metadata();
    return m.width && m.height ? orientacionDe(m.width, m.height) : null;
  } catch {
    return null;
  }
}

/** Calcula y guarda la orientación de un archivo a partir de su miniatura/póster. */
export async function marcarOrientacion(id: string): Promise<void> {
  const r = await query<{ kind: string; t: Buffer | null; p: Buffer | null }>(
    "select kind, thumb_webp as t, poster_jpg as p from assets where id = $1",
    [id],
  ).catch(() => null);
  const row = r?.rows[0];
  if (!row || row.kind === "audio") return;
  const o = (await deBytes(row.kind === "video" ? row.p : row.t)) ?? (await deBytes(row.t)) ?? (await deBytes(row.p));
  if (o) await query("update assets set orientation = $1 where id = $2", [o, id]).catch(() => {});
}

/** Rellena los archivos ya guardados que aún no la tienen: pocos por vuelta, sin molestar. */
export function iniciarRelleno(log: { info: (m: string) => void }): void {
  let hechos = 0;
  const vuelta = async (): Promise<void> => {
    const r = await query<{ id: string }>(
      `select id from assets
        where orientation is null and deleted_at is null and kind in ('photo','video')
          and (octet_length(coalesce(thumb_webp,''::bytea)) > 4 or octet_length(coalesce(poster_jpg,''::bytea)) > 4)
        order by uploaded_at desc limit 40`,
    ).catch(() => null);
    const ids = r?.rows ?? [];
    if (!ids.length) {
      if (hechos) log.info(`orientación: ${hechos} archivos al día`);
      return;
    }
    for (const { id } of ids) {
      await marcarOrientacion(id);
      hechos++;
    }
    // los que no se pudieron leer se quedan en null: se marcan cuadrada para no repetir
    await query(
      `update assets set orientation = 'cuadrada' where id = any($1::uuid[]) and orientation is null`,
      [ids.map((x) => x.id)],
    ).catch(() => {});
    setTimeout(() => void vuelta(), 300);
  };
  setTimeout(() => void vuelta(), 15_000);
}
