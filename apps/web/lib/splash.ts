/**
 * Pantallas de arranque de iOS (`apple-touch-startup-image`). Safari solo usa una
 * imagen cuyo `media` coincida EXACTO con el tamaño y la densidad del aparato, por
 * eso la lista. Sin ellas, al abrir Upscale desde el icono sale un fogonazo blanco.
 */
export interface Pantalla {
  /** ancho × alto en puntos CSS */
  w: number;
  h: number;
  /** densidad */
  r: number;
}

export const PANTALLAS: Pantalla[] = [
  // iPhone
  { w: 440, h: 956, r: 3 }, // 16 Pro Max
  { w: 402, h: 874, r: 3 }, // 16 Pro
  { w: 430, h: 932, r: 3 }, // 14/15 Pro Max, 15 Plus
  { w: 393, h: 852, r: 3 }, // 14 Pro, 15, 15 Pro, 16
  { w: 428, h: 926, r: 3 }, // 12/13 Pro Max, 14 Plus
  { w: 390, h: 844, r: 3 }, // 12/13/14
  { w: 414, h: 896, r: 3 }, // XS Max, 11 Pro Max
  { w: 414, h: 896, r: 2 }, // XR, 11
  { w: 375, h: 812, r: 3 }, // X, XS, 11 Pro, 12/13 mini
  { w: 414, h: 736, r: 3 }, // 6/7/8 Plus
  { w: 375, h: 667, r: 2 }, // 6/7/8, SE 2/3
  { w: 320, h: 568, r: 2 }, // SE 1
  // iPad
  { w: 1024, h: 1366, r: 2 }, // Pro 12.9
  { w: 834, h: 1194, r: 2 }, // Pro 11
  { w: 820, h: 1180, r: 2 }, // Air, 10.9
  { w: 810, h: 1080, r: 2 }, // 10.2
  { w: 768, h: 1024, r: 2 }, // 9.7, mini
];

export type Tema = "dark" | "light";

export function nombreSplash(p: Pantalla, tema: Tema): string {
  return `${p.w * p.r}x${p.h * p.r}-${tema}`;
}

/** Entrada de metadata para una pantalla (vertical) y un tema. */
export function startupImage(p: Pantalla, tema: Tema) {
  return {
    url: `/splash/${nombreSplash(p, tema)}`,
    media: `(device-width: ${p.w}px) and (device-height: ${p.h}px) and (-webkit-device-pixel-ratio: ${p.r}) and (orientation: portrait) and (prefers-color-scheme: ${tema})`,
  };
}

export const SPLASHES = PANTALLAS.flatMap((p) => (["dark", "light"] as const).map((t) => ({ p, t, nombre: nombreSplash(p, t) })));
