// Escenas «de película» para la portada (propias, vectoriales, sin fotos de nadie):
// contraluz, siluetas, luces desenfocadas (bokeh), grano y viñeta. Sin caras dibujadas: lo que se
// siente (ternura, juego, calma, miedo a perder) lo cuentan la luz y el gesto, como en una foto de recuerdo.
// Lienzo de 800×800; las recorta a cada forma generar-portada.mjs.

const SIL = "#1a1124";
const al = (n) => n - Math.floor(n);
const rnd = (i, k = 1) => al(Math.sin(i * 12.9898 * k + k * 78.233) * 43758.5453);

const circ = (x, y, r, fill, extra = "") => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
const elip = (x, y, rx, ry, fill, extra = "") => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const trazo = (d, stroke, w, extra = "") => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const rel = (d, fill, extra = "") => `<path d="${d}" fill="${fill}" ${extra}/>`;

/** Marco común: degradado de cielo, bokeh, escena, viñeta y grano de película. */
function pelicula(id, cielo, bokeh, escena, { viñeta = 0.5, grano = 0.1 } = {}) {
  const [c0, c1, c2] = cielo;
  const orbes = bokeh.map(([x, y, r, col, op]) => circ(x, y, r, col, `opacity="${op}" filter="url(#bk${id})"`)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
    <defs>
      <linearGradient id="cl${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="0.55" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
      <filter id="bk${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
      <filter id="suave${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>
      <radialGradient id="vg${id}" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#0a0410" stop-opacity="${viñeta}"/></radialGradient>
      <filter id="gr${id}"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${id.length + 3}"/><feColorMatrix type="saturate" values="0"/></filter>
    </defs>
    <rect width="800" height="800" fill="url(#cl${id})"/>${orbes}${escena}
    <rect width="800" height="800" fill="url(#vg${id})"/>
    <rect width="800" height="800" filter="url(#gr${id})" opacity="${grano}"/>
  </svg>`;
}
const sol = (x, y, r, a, b = "#fff6d8") => `<defs><radialGradient id="s${x}${y}"><stop offset="0" stop-color="${b}"/><stop offset="0.28" stop-color="${a}" stop-opacity="0.9"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient></defs>${circ(x, y, r * 3.2, `url(#s${x}${y})`)}${circ(x, y, r, b)}`;

/** Silueta de persona (adulto = esc 1, niño ≈ 0.55). Pose: camina, quieto, alza. */
function persona(x, y, esc, pose = "quieto", flip = 1, col = SIL) {
  const brazos = {
    quieto: ["M-26 -112 Q-44 -80 -38 -40", "M26 -112 Q44 -80 38 -40"],
    camina: ["M-26 -112 Q-48 -84 -44 -48", "M26 -112 Q42 -80 30 -40"],
    alza: ["M-26 -114 Q-52 -160 -54 -204", "M26 -114 Q52 -160 54 -204"],
    mano: ["M-26 -112 Q-44 -80 -38 -44", "M26 -112 Q58 -96 80 -64"],
  }[pose];
  const paso = pose === "camina" || pose === "mano" ? 16 : 4;
  return `<g transform="translate(${x} ${y}) scale(${esc * flip} ${esc})">
    ${rel(`M-9 -34 Q-12 10 ${-22 - paso} 62 L${-4 - paso} 62 Q4 12 3 -34z`, col)}${rel(`M9 -34 Q12 10 ${22 + paso} 62 L${4 + paso} 62 Q-4 12 -3 -34z`, col)}
    ${rel("M-30 -116 Q0 -134 30 -116 Q38 -80 32 -36 Q0 -28 -32 -36 Q-38 -80 -30 -116z", col)}${rel("M-8 -132 h16 v14 h-16z", col)}${circ(0, -152, 27, col)}${rel("M-22 -160 Q-4 -186 24 -164 Q10 -172 -22 -160z", col)}
    ${trazo(brazos[0], col, 15)}${trazo(brazos[1], col, 15)}
  </g>`;
}

/** 1 · De la mano al atardecer: una hija y su padre caminan hacia el sol. */
function mano() {
  const reflejo = Array.from({ length: 9 }, (_, i) => elip(400, 640 + i * 16, 150 - i * 11, 3, "#ffe7b0", `opacity="${0.55 - i * 0.05}"`)).join("");
  const esc = sol(400, 372, 92, "#ff9f68") + rel("M0 800 V600 Q400 560 800 600 V800z", "#4a2540") + rel("M0 800 V660 Q400 630 800 660 V800z", "#2d1633") + reflejo +
    persona(330, 668, 1.3, "mano") + persona(452, 676, 0.74, "quieto") + trazo("M400 612 L420 636", SIL, 9);
  return pelicula("m", ["#3d2a6e", "#e0668a", "#ffc47a"], [[130, 200, 54, "#ffcf9a", 0.35], [680, 150, 40, "#ff9cb5", 0.32], [610, 330, 70, "#ffd9a0", 0.22], [190, 420, 34, "#ffb27a", 0.3]], esc, { viñeta: 0.55 });
}

/** 2 · Velas: dos siluetas inclinadas sobre la tarta, la luz en sus caras. */
function velas() {
  const llama = (x, y) => `${circ(x, y - 8, 70, "#ffb23d", 'opacity="0.35" filter="url(#bkv)"')}${elip(x, y, 9, 20, "#ffb23d")}${elip(x, y + 5, 5, 11, "#fff3a8")}`;
  const esc = rel("M60 800 V640 Q60 610 90 610 H710 Q740 610 740 640 V800z", "#2a1220") + rel("M90 650 Q400 700 710 650 V700 Q400 750 90 700z", "#6a2a3e", 'opacity="0.8"') +
    // dos cabezas de perfil, enfrentadas sobre las velas
    `<g>${circ(250, 380, 88, SIL)}${rel("M326 372 q22 8 8 30 q-12 4 -20 -4z", SIL)}${rel("M170 440 Q160 640 230 700 L420 700 Q380 560 340 470z", SIL)}</g>` +
    `<g>${circ(560, 430, 64, SIL)}${rel("M498 430 q-20 8 -8 28 q10 3 18 -4z", SIL)}${rel("M630 480 Q650 640 600 700 L420 700 Q450 580 480 500z", SIL)}</g>` +
    [330, 400, 470].map((x) => `${rel(`M${x - 8} 570 h16 v70 h-16z`, "#f4e6d4")}${llama(x, 548)}`).join("") +
    `<defs><filter id="bkv"><feGaussianBlur stdDeviation="14"/></filter></defs>`;
  return pelicula("v", ["#1a0d24", "#4a1c36", "#a24a3a"], [[120, 160, 60, "#ffb066", 0.3], [660, 120, 44, "#ff8aa0", 0.3], [90, 480, 40, "#ffc47a", 0.26], [720, 400, 60, "#ffb066", 0.22], [400, 90, 50, "#ffd9a0", 0.2]], esc, { viñeta: 0.6, grano: 0.12 });
}

/** 3 · Abrazo en el balcón, con la ciudad desenfocada detrás. */
function balcon() {
  const luces = Array.from({ length: 26 }, (_, i) => [Math.round(30 + rnd(i, 2) * 740), Math.round(300 + rnd(i, 3) * 260), 18 + rnd(i, 4) * 34, ["#ffd37a", "#ff9ab0", "#7fe0f0", "#ffb066"][i % 4], 0.38 + rnd(i, 5) * 0.3]);
  const esc = rel("M0 800 V690 H800 V800z", "#190f24") + trazo("M0 690 H800", "#33204a", 6) +
    // dos cuerpos fundidos en un abrazo
    `<g>${rel("M240 690 Q236 480 330 428 Q372 410 400 424 L400 690z", "#1a1124")}${rel("M400 690 L400 420 Q440 404 482 424 Q572 476 560 690z", "#261834")}${circ(356, 346, 48, "#1a1124")}${circ(444, 356, 46, "#261834")}${rel("M316 320 Q330 280 380 290 Q360 300 340 326z", "#1a1124")}${trazo("M286 480 Q400 540 514 480", "#1a1124", 34)}</g>`;
  return pelicula("b", ["#0f1c3d", "#2f4f8a", "#ff9a7a"], luces, esc, { viñeta: 0.58, grano: 0.11 });
}

/** 5 · Familia en la orilla, el pequeño a hombros, rumbo al sol. */
function orilla() {
  const reflejo = Array.from({ length: 7 }, (_, i) => elip(400, 628 + i * 18, 120 - i * 14, 3, "#fff0c4", `opacity="${0.5 - i * 0.06}"`)).join("");
  const esc = sol(400, 410, 78, "#ff8f6a") + rel("M0 800 V610 H800 V800z", "#3b2a58", 'opacity="0.9"') + reflejo +
    persona(270, 692, 1.15, "mano") + persona(530, 692, 1.15, "mano", -1) + persona(400, 692, 0.66, "quieto") + trazo("M352 628 L372 660 M448 628 L430 660", SIL, 8);
  return pelicula("o", ["#2a2468", "#d9628a", "#ffc88a"], [[140, 220, 56, "#ffc7a0", 0.3], [660, 190, 44, "#ff9cb5", 0.3], [420, 130, 60, "#ffe3b0", 0.2]], esc, { viñeta: 0.5 });
}

/** 6 · Alzar en brazos: pura alegría a contraluz. */
function alza() {
  const esc = sol(400, 470, 84, "#ffb066") + rel("M0 800 V650 Q400 610 800 650 V800z", "#4b3a1c", 'opacity="0.88"') +
    persona(400, 700, 1.5, "alza") + `<g transform="translate(400 330) rotate(-8)">${circ(0, -40, 26, SIL)}${rel("M-26 -22 Q0 -36 26 -22 L30 50 H-30z", SIL)}${trazo("M-20 -10 L-54 -44 M20 -10 L54 -44", SIL, 12)}</g>`;
  return pelicula("a", ["#4a3a9a", "#ff8f8a", "#ffd9a0"], [[110, 200, 54, "#ffe0b0", 0.34], [690, 160, 50, "#ffb0a0", 0.32], [640, 480, 64, "#ffd9a0", 0.2]], esc, { viñeta: 0.5 });
}

/** 7 · Ventana y nana: alguien mece a un bebé con la luz de la mañana entrando. */
function nana() {
  const haz = [0, 1, 2].map((i) => rel(`M${380 + i * 70} 0 L${470 + i * 110} 800 L${360 + i * 110} 800z`, "#fff0c4", `opacity="${0.1 - i * 0.02}"`)).join("");
  const esc = rel("M400 0 H760 V560 H400z", "#fff3cf", 'opacity="0.55"') + trazo("M580 0 V560 M400 280 H760", "#c9a46a", 8, 'opacity="0.7"') + haz +
    `<g>${circ(300, 330, 60, SIL)}${rel("M200 800 Q190 480 300 400 Q380 440 400 560 L420 800z", SIL)}${elip(404, 560, 100, 48, "#2a1a38", 'transform="rotate(-18 404 560)"')}${circ(480, 520, 30, "#3a2748")}${trazo("M360 540 Q430 600 490 540", SIL, 30)}</g>`;
  return pelicula("n", ["#e9b98a", "#d8896a", "#7a4a5e"], [[640, 140, 70, "#fff0c4", 0.4], [120, 200, 40, "#ffc7a0", 0.3]], esc, { viñeta: 0.5, grano: 0.1 });
}

/** 8 · El miedo: un móvil roto con un recuerdo que se apaga, en frío y en calma. */
function roto() {
  const grieta = "M400 330 L330 250 L300 190 M400 330 L470 270 L510 200 M400 330 L360 430 L320 520 M400 330 L480 410 L520 500 M330 250 L270 262 M470 270 L520 292";
  const esc = `<g transform="rotate(-9 400 400)">${rel("M250 110 H550 Q592 110 592 152 V650 Q592 692 550 692 H250 Q208 692 208 650 V152 Q208 110 250 110z", "#0b0f20")}${rel("M230 150 H570 V652 H230z", "#1d2a4f")}
      <g opacity="0.5">${sol(410, 330, 40, "#ffb27a")}${rel("M232 520 Q330 440 440 520 T570 500 V652 H232z", "#3a2a5e")}</g>
      ${trazo(grieta, "#e6eeff", 4.5, 'opacity="0.95"')}${rel("M230 150 H570 V230 Q400 290 230 240z", "#fff", 'opacity="0.06"')}</g>` +
    [[120, 290, 24], [660, 470, 20], [170, 640, 18], [620, 180, 22], [700, 330, 16]].map(([x, y, s], i) => rel(`M${x} ${y} l${s} ${s * 0.4} l${-s * 0.5} ${s}z`, "#b9c6ee", `opacity="0.45" transform="rotate(${i * 40} ${x} ${y})"`)).join("");
  return pelicula("r", ["#4a5a86", "#2f3d68", "#1a2244"], [[140, 160, 60, "#7a8fd0", 0.3], [660, 600, 60, "#6a7fc0", 0.28], [600, 120, 34, "#8fa4e0", 0.3]], esc, { viñeta: 0.6 });
}

export const ESCENAS = { mano, velas, balcon, orilla, alza, nana, roto };
/** Las que se usan en la biblioteca (alegres/tiernas). */
export const ALEGRES = ["mano", "velas", "balcon", "orilla", "alza", "nana"];
