/**
 * Descargas desde el navegador.
 *
 * - Una sola foto/vídeo: enlace directo al original (sin ZIP, lo más rápido).
 * - Varios: ZIP, pedido con un formulario POST (la selección va en el cuerpo: con
 *   cientos de fotos los ids no caben en una URL y la descarga fallaba).
 *   Se abre en otra pestaña/descarga del sistema: en iOS sale el gestor de
 *   descargas y el ZIP queda en Archivos › Descargas.
 */

export interface FuenteZip {
  /** ids concretos; null = «todo» con los filtros siguientes */
  ids: string[] | null;
  kind?: string | null;
  fav?: boolean;
  album?: string | null;
  q?: string | null;
  camera?: string | null;
  from?: string | null;
  to?: string | null;
}

/** Por encima de esto no se descarga de golpe: se enseña la hoja con el tamaño y las partes. */
export const UMBRAL_DIRECTO = 1.5 * 1024 ** 3;

export function descargarUno(id: string): void {
  const a = document.createElement("a");
  a.href = `/api/dl/${id}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Aviso a la barra de progreso (components/DownloadProgress.tsx, montada en /app). */
export const EVENTO_DESCARGA = "upscale:download";
export interface DetalleDescarga {
  job: string;
  parte?: { n: number; de: number } | null;
  titulo?: string;
}

function nuevoId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // contexto sin crypto.randomUUID: uuid v4 a mano
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

/** Lanza el ZIP y avisa a la barra de progreso. Devuelve el id de la descarga. */
export function descargarZip(f: FuenteZip, parte?: { n: number; de: number }, titulo?: string): string {
  const job = nuevoId();
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/dl-all";
  form.target = "_blank";
  form.style.display = "none";
  const campo = (name: string, value: string) => {
    const i = document.createElement("input");
    i.type = "hidden";
    i.name = name;
    i.value = value;
    form.appendChild(i);
  };
  campo("job", job);
  if (f.ids && f.ids.length) campo("ids", f.ids.join(","));
  if (f.kind) campo("kind", f.kind);
  if (f.fav) campo("fav", "1");
  if (f.album) campo("album", f.album);
  if (f.q) campo("q", f.q);
  if (f.camera) campo("camera", f.camera);
  if (f.from) campo("from", f.from);
  if (f.to) campo("to", f.to);
  if (parte) {
    campo("part", String(parte.n));
    campo("of", String(parte.de));
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
  window.dispatchEvent(new CustomEvent<DetalleDescarga>(EVENTO_DESCARGA, { detail: { job, parte: parte ?? null, titulo } }));
  return job;
}

/** ¿pantalla táctil / móvil? Decide el tamaño de las partes. */
export function esMovil(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 720;
  } catch {
    return false;
  }
}
