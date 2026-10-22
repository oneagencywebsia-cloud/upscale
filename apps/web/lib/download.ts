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

/**
 * Formato de las descargas en ESTE dispositivo:
 *   «compatible» (por defecto) → se abre en cualquier aparato: fotos HEIC→JPG,
 *       vídeos HEVC→MP4, audios CAF/AMR→MP3 (lo que ya es compatible va tal cual).
 *   «original» → el archivo exacto, byte a byte (para editar o archivar).
 */
const CLAVE_FORMATO = "upscale-dl-compat";
export const EVENTO_FORMATO = "upscale:dl-format";

export function formatoCompatible(): boolean {
  try {
    return localStorage.getItem(CLAVE_FORMATO) !== "0";
  } catch {
    return true;
  }
}

export function guardarFormatoCompatible(compat: boolean): void {
  try {
    localStorage.setItem(CLAVE_FORMATO, compat ? "1" : "0");
  } catch {
    /* modo privado: vale solo para esta sesión */
  }
  window.dispatchEvent(new CustomEvent(EVENTO_FORMATO, { detail: compat }));
}

/** Enlace de descarga de UN archivo (por defecto, según la preferencia). */
export function urlDescarga(id: string, compat = formatoCompatible()): string {
  return `/api/dl/${id}${compat ? "?compat=1" : ""}`;
}

export function descargarUno(id: string, compat = formatoCompatible()): void {
  const a = document.createElement("a");
  a.href = urlDescarga(id, compat);
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
export function descargarZip(f: FuenteZip, parte?: { n: number; de: number }, titulo?: string, compat = formatoCompatible()): string {
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
  if (compat) campo("compat", "1");
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
