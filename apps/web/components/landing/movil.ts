/**
 * El móvil de cada escena: una pose por capítulo (posición en fracciones del escenario, escala, giros en grados).
 * Entre dos capítulos la pose se interpola; la pantalla del móvil cambia con un fundido (ver Scrolly.tsx).
 */
export type IdEscena = "a" | "b" | "c";
export type Pose = { x: number; y: number; s: number; ry: number; rx: number; rz: number };

const P = (x: number, y: number, s: number, ry: number, rx: number, rz: number): Pose => ({ x, y, s, ry, rx, rz });

export const POSES: Record<IdEscena, Pose[]> = {
  // a: tus recuerdos · se rompe el móvil · un toque · calidad original
  a: [P(0, 0, 1, -7, 3, 0), P(0, 0.01, 1.02, 6, 2, -3), P(0, 0, 1, 0, 0, 0), P(0, -0.01, 1.04, -5, 2, 1)],
  // b: en todas partes · privado · legado · regalo
  b: [P(0, 0, 1, 8, 2, 0), P(0, 0, 1.03, 0, 0, 0), P(0, 0, 1, -7, 2, 1), P(0, 0, 1.02, 5, 1, -1)],
  // c: piénsalo · empieza
  c: [P(0, 0, 1, -5, 2, -2), P(0, -0.01, 1.05, 0, 0, 0)],
};
