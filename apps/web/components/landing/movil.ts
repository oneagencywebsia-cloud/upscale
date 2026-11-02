/**
 * El móvil de cada escena: una pose por capítulo (posición en fracciones del escenario, escala, giros en grados).
 * Entre dos capítulos la pose se interpola; la pantalla del móvil cambia con un fundido (ver Scrolly.tsx).
 */
export type IdEscena = "a" | "b" | "c";
export type Pose = { x: number; y: number; s: number; ry: number; rx: number; rz: number };

const P = (x: number, y: number, s: number, ry: number, rx: number, rz: number): Pose => ({ x, y, s, ry, rx, rz });

export const POSES: Record<IdEscena, Pose[]> = {
  // a: tus recuerdos · se rompe el móvil · un toque · calidad original
  a: [P(0, 0, 1, -12, 5, 0), P(0, 0.012, 1.03, 9, 3, -5), P(0, 0, 1, 0, 0, 0), P(0, -0.01, 1.05, -8, 3, 2)],
  // b: en todas partes · privado · legado · regalo
  b: [P(0, 0, 1, 14, 4, 0), P(0, 0, 1.04, 0, 0, 0), P(0, 0, 1, -12, 4, 2), P(0, 0, 1.03, 8, 2, -2)],
  // c: piénsalo · empieza
  c: [P(0, 0, 1, -7, 3, -3), P(0, -0.01, 1.07, 0, 0, 0)],
};
