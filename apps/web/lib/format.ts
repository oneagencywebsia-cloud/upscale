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

export function durationHuman(s: number | null): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function fpsHuman(fps: number | null): string {
  return fps ? `${fps.toFixed(2)} fps` : "—";
}

export function bitrateHuman(bps: number | null): string {
  return bps ? `${(bps / 1_000_000).toFixed(1).replace(".", ",")} Mb/s` : "—";
}

const DAY_FMT = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" });
const TIME_FMT = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });

export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yst = new Date();
  yst.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "Hoy";
  if (dayKey(iso) === dayKey(yst.toISOString())) return "Ayer";
  const s = DAY_FMT.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function timeLabel(iso: string): string {
  return TIME_FMT.format(new Date(iso));
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
  rows.push(["Capturado", `${new Date(a.capturedAt).toLocaleDateString("es-ES")} · ${timeLabel(a.capturedAt)}`]);
  if (a.lat != null && a.lon != null) rows.push(["Lugar", `${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}`]);
  return rows;
}
