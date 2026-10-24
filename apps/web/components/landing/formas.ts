/**
 * Las «formas» del recorrido de la portada. Cada capítulo es una disposición de los
 * mismos N elementos (círculo, cuadrado, rectángulo redondeado…). Al hacer scroll, cada
 * elemento viaja de su sitio en un capítulo al del siguiente y cambia de forma, de modo que
 * toda la página es UNA animación continua, como un vídeo que avanza con el dedo.
 *
 * Coordenadas: x,y entre -1 y 1 (centro = 0,0) respecto al lado corto del escenario;
 * s = tamaño (fracción del lado corto); r = redondeo (50 = círculo, 8 = casi cuadrado);
 * o = opacidad; g = giro en grados. Funciones puras y deterministas (sin Math.random):
 * el servidor y el navegador dibujan exactamente lo mismo.
 */

export const N = 28;

export interface Forma {
  x: number;
  y: number;
  s: number;
  r: number;
  o: number;
  g: number;
  /** proporción ancho/alto (1 = cuadrado) */
  a: number;
}

const frac = (n: number) => n - Math.floor(n);
const TAU = Math.PI * 2;
const f = (x: number, y: number, s: number, r = 50, o = 0.9, g = 0, a = 1): Forma => ({ x, y, s, r, o, g, a });
const oculto = (k: number): Forma => f(0, 0, 0.02, 50, 0, k * 7);

/** 0 · El sol: un círculo grande con una órbita de puntos (el halo del logotipo). */
function sol(k: number): Forma {
  if (k === 0) return f(0, 0, 0.62, 50, 0.95);
  if (k <= 12) {
    const a = ((k - 1) / 12) * TAU - Math.PI / 2;
    return f(Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0.07, 50, 0.9);
  }
  const a = ((k - 13) / 15) * TAU;
  return f(Math.cos(a) * 0.74, Math.sin(a) * 0.74, 0.035, 50, 0.45);
}

/** 1 · El caos: cientos de recuerdos amontonados en un móvil que ya no cabe. */
function caos(k: number): Forma {
  const x = (frac(k * 0.618 + 0.11) - 0.5) * 1.15;
  const y = (frac(k * 0.754 + 0.37) - 0.5) * 1.5;
  return f(x, y, 0.14 + frac(k * 0.37) * 0.14, 50, 0.5 + frac(k * 0.53) * 0.3, 0);
}

/** 2 · La escalera de Upscale: tres peldaños que suben (el símbolo de la marca). */
function escalera(k: number): Forma {
  if (k < 9) {
    const col = Math.floor(k / 3); // 0,1,2
    const fila = k % 3;
    const alto = col + 1; // la columna 0 tiene 1 peldaño, la 2 tiene 3
    if (fila >= alto) return f(-0.45 + col * 0.45, 0.45, 0.02, 12, 0, 0);
    return f(-0.45 + col * 0.45, 0.4 - fila * 0.32, 0.27, 14, 0.95, 0);
  }
  // el resto sube como polvo de luz en la diagonal
  const u = (k - 9) / (N - 9);
  return f(-0.55 + u * 1.1, 0.62 - u * 1.2, 0.05 + (k % 3) * 0.015, 50, 0.55, 0);
}

/** 3 · Marcos: cuatro fotos grandes, idénticas al original, y una rejilla de píxeles. */
function marcos(k: number): Forma {
  if (k < 4) {
    const cx = k % 2 === 0 ? -0.27 : 0.27;
    const cy = k < 2 ? -0.27 : 0.27;
    return f(cx, cy, 0.4, 9, 0.96, 0, k === 0 || k === 3 ? 1.35 : 0.78);
  }
  if (k < 20) {
    const i = k - 4; // 16 puntos en un marco exterior
    const lado = i % 4;
    const p = Math.floor(i / 4) / 3;
    const m = 0.74;
    const x = lado === 0 ? -m + p * 2 * m : lado === 1 ? m : lado === 2 ? m - p * 2 * m : -m;
    const y = lado === 0 ? -m : lado === 1 ? -m + p * 2 * m : lado === 2 ? m : m - p * 2 * m;
    return f(x, y, 0.05, 20, 0.6, 0);
  }
  return oculto(k);
}

/** 4 · Pantallas: un móvil, una tableta y un portátil, uno al lado del otro. */
function pantallas(k: number): Forma {
  if (k === 0) return f(-0.52, 0.1, 0.5, 12, 0.95, 0, 0.5); // móvil
  if (k === 1) return f(0.0, 0.1, 0.56, 9, 0.95, 0, 0.74); // tableta
  if (k === 2) return f(0.55, 0.12, 0.4, 6, 0.95, 0, 1.55); // portátil
  if (k < 12) {
    const a = ((k - 3) / 9) * Math.PI; // arco de puntos que une las pantallas
    return f(-0.6 + (k - 3) * 0.15, -0.5 - Math.sin(a) * 0.16, 0.05, 50, 0.6, 0);
  }
  return oculto(k);
}

/** 5 · Solo tuyo: un anillo de puntos que protege una cerradura. */
function cerradura(k: number): Forma {
  if (k < 20) {
    const a = (k / 20) * TAU - Math.PI / 2;
    return f(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.08, 50, 0.85, 0);
  }
  if (k === 20) return f(0, 0.1, 0.4, 12, 0.96, 0); // el cuerpo de la cerradura
  if (k === 21) return f(0, -0.2, 0.26, 50, 0.9, 0); // el arco
  return oculto(k);
}

/** 6 · Amigos: una red hexagonal; tú en el centro y cada amigo en un vértice. */
function red(k: number): Forma {
  if (k === 0) return f(0, 0, 0.3, 50, 0.96, 0);
  if (k <= 6) {
    const a = ((k - 1) / 6) * TAU - Math.PI / 2;
    return f(Math.cos(a) * 0.58, Math.sin(a) * 0.58, 0.19, 50, 0.92, 0);
  }
  if (k <= 18) {
    // puntos a mitad de camino: las «líneas» que unen a las personas
    const i = k - 7;
    const a = (Math.floor(i / 2) / 6) * TAU - Math.PI / 2;
    const t = i % 2 === 0 ? 0.34 : 0.78;
    return f(Math.cos(a) * 0.58 * t, Math.sin(a) * 0.58 * t, 0.045, 50, 0.6, 0);
  }
  return oculto(k);
}

/** 7 · El final: vuelve el sol, ahora más grande y cálido, con todos los puntos dentro. */
function final(k: number): Forma {
  if (k === 0) return f(0, 0, 0.7, 50, 0.97, 0);
  if (k <= 18) {
    const a = ((k - 1) / 18) * TAU - Math.PI / 2;
    return f(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.05, 50, 0.85, 0);
  }
  const a = ((k - 19) / 9) * TAU;
  return f(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.03, 50, 0.5, 0);
}

/**
 * Tres escenas fijas, separadas por tramos donde la página baja con normalidad:
 *  A (gancho): sol → caos → escalera → marcos · B (confianza): pantallas → cerradura → red de amigos ·
 *  C (cierre): el caos vuelve a juntarse en un sol.
 */
export const ESCENAS = {
  a: { capas: [sol, caos, escalera, marcos], matices: [205, 12, 190, 215] },
  b: { capas: [pantallas, cerradura, red], matices: [235, 172, 285] },
  c: { capas: [caos, final], matices: [12, 28] },
} as const;
export type IdEscena = keyof typeof ESCENAS;

/** Disposiciones por escena, calculadas una vez: DISPOSICIONES.a[c][k] = forma del elemento k en el capítulo c. */
export const DISPOSICIONES = Object.fromEntries(
  (Object.keys(ESCENAS) as IdEscena[]).map((id) => [id, ESCENAS[id].capas.map((fn) => Array.from({ length: N }, (_, k) => fn(k)))]),
) as Record<IdEscena, Forma[][]>;
