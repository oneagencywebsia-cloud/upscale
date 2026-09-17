import type { Asset, AssetListItem } from "@upscale/shared";

export function bytesHuman(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0).replace(".", ",")} ${u[i]}`;
}

/**
 * m:ss, y h:mm:ss a partir de la hora — un vídeo de 2 h salía como "120:00".
 * (Un vídeo de 0 s no existe, pero 0.4 s sí: se muestra "0:00", no "—".)
 */
export function durationHuman(s: number | null): string {
  if (s == null || !Number.isFinite(s) || s < 0) return "—";
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function fpsHuman(fps: number | null): string {
  return fps ? `${fps.toFixed(2)} fps` : "—";
}

export function bitrateHuman(bps: number | null): string {
  return bps ? `${(bps / 1_000_000).toFixed(1).replace(".", ",")} Mb/s` : "—";
}

/**
 * La API guarda y sirve `capturedAt` SIEMPRE en UTC (`...Z`). Agrupar por
 * `iso.slice(0,10)` era agrupar por día UTC, y eso rompía dos cosas a la vez
 * en España (UTC+1/+2):
 *
 *  - Una foto de la 01:30 de la madrugada cae en el día UTC ANTERIOR: salía
 *    bajo el encabezado del día de antes, o peor, aparecían DOS secciones
 *    seguidas con el mismo rótulo ("Miércoles" dos veces), porque la clave era
 *    UTC pero el rótulo se formateaba en hora local.
 *  - El HTML del servidor (contenedor en UTC) y el del navegador (Madrid) no
 *    coincidían para esas fotos → error de hidratación de React.
 *
 * Se fija UNA zona horaria para clave, rótulo y hora, la misma en servidor y
 * navegador. Configurable por si algún día hace falta otra.
 */
const TZ = process.env.NEXT_PUBLIC_UPSCALE_TZ || "Europe/Madrid";

const KEY_FMT = new Intl.DateTimeFormat("es-ES", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const DAY_FMT = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const TIME_FMT = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const DATE_FMT = new Intl.DateTimeFormat("es-ES", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });

/** "2026-09-16" en la zona horaria de referencia. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const p = KEY_FMT.formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const now = Date.now();
  if (dayKey(iso) === dayKey(new Date(now).toISOString())) return "Hoy";
  if (dayKey(iso) === dayKey(new Date(now - 86_400_000).toISOString())) return "Ayer";
  const s = DAY_FMT.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : TIME_FMT.format(d);
}

export interface DayGroup {
  key: string;
  label: string;
  items: AssetListItem[];
}

export function groupByDay(items: AssetListItem[]): DayGroup[] {
  const map = new Map<string, AssetListItem[]>();
  for (const it of items) {
    const k = dayKey(it.capturedAt);
    (map.get(k) ?? map.set(k, []).get(k)!).push(it);
  }
  return [...map.entries()].map(([key, list]) => ({
    key,
    label: dayLabel(list[0]!.capturedAt),
    items: list,
  }));
}

export function specRows(a: Asset): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Resolución", a.width && a.height ? `${a.width} × ${a.height}` : "—"],
    ["Códec", a.codec ? a.codec.toUpperCase() : "—"],
  ];
  if (a.kind === "video") {
    rows.push(["Fotogramas", fpsHuman(a.fps)]);
    rows.push(["Bitrate", bitrateHuman(a.videoBitrate)]);
    rows.push(["Duración", durationHuman(a.durationS)]);
  }
  rows.push(["Tamaño", bytesHuman(a.bytes)]);
  if (a.cameraModel) rows.push(["Cámara", [a.cameraMake, a.cameraModel].filter(Boolean).join(" ")]);
  // misma zona horaria que los encabezados de día: si no, la ficha podía decir
  // "16/09" bajo una sección titulada "martes 15".
  rows.push(["Capturado", `${DATE_FMT.format(new Date(a.capturedAt))} · ${timeLabel(a.capturedAt)}`]);
  if (a.lat != null && a.lon != null) rows.push(["Lugar", `${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}`]);
  return rows;
}
