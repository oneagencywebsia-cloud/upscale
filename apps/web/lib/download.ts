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

export function descargarZip(f: FuenteZip, parte?: { n: number; de: number }): void {
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
}

/** ¿pantalla táctil / móvil? Decide el tamaño de las partes. */
export function esMovil(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 720;
  } catch {
    return false;
  }
}
