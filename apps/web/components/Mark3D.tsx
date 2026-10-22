"use client";

import { useId } from "react";
import { useTilt } from "@/lib/tilt";

/**
 * El símbolo de Upscale en 3D de verdad: la misma geometría que `BrandMark`
 * (docs/BRANDING.md → Logotipo) partida en capas con profundidad distinta —
 * cristal, sombra, línea, tres peldaños, punto de luz y un brillo — dentro de
 * una escena con perspectiva. Se inclina con el puntero (o el dedo), flota
 * despacio y los peldaños «respiran» a distinta altura.
 *
 * Solo `transform`/`opacity` (GPU). Sin librerías de 3D: el rendimiento de la
 * portada no cambia. Quieto si el usuario pide menos movimiento o con el
 * interruptor de animaciones apagado (ver `.m3` en globals.css).
 *
 * `step` (1–3) enciende solo ese peldaño y apaga los de arriba: lo usa
 * «Cómo funciona» para que cada paso suba un escalón.
 */
export default function Mark3D({
  size = 220,
  interactive = true,
  step,
  className = "",
}: {
  size?: number;
  interactive?: boolean;
  step?: 1 | 2 | 3;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (n: string) => `m3${uid}-${n}`;
  const ref = useTilt<HTMLDivElement>({ max: 16, scope: "window" });
  const lit = (n: 1 | 2 | 3) => (step === undefined || step >= n ? 1 : 0.16);

  return (
    <div
      ref={interactive ? ref : undefined}
      className={`m3 ${className}`.trim()}
      style={{ ["--s" as string]: `${size}px` }}
      role="img"
      aria-label="Upscale"
    >
      <div className="m3-tilt">
        <div className="m3-float">
          {/* sombra proyectada sobre el cristal */}
          <svg className="m3-l m3-shadow" viewBox="0 0 512 512" aria-hidden="true">
            <defs>
              <filter id={id("blur")} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="14" />
              </filter>
            </defs>
            <g fill="none" stroke="#02050c" strokeOpacity="0.55" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${id("blur")})`}>
              <path d="M160 346 L256 250 L352 346" strokeWidth="46" />
              <path d="M200 234 L256 178 L312 234" strokeWidth="34" />
              <path d="M220 152 L256 116 L292 152" strokeWidth="26" />
            </g>
          </svg>

          {/* cristal de anochecer con el sol cálido */}
          <svg className="m3-l m3-plate" viewBox="0 0 512 512" aria-hidden="true">
            <defs>
              <linearGradient id={id("tile")} x1="64" y1="0" x2="448" y2="512" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#18264a" />
                <stop offset="0.55" stopColor="#0d1530" />
                <stop offset="1" stopColor="#0a0d14" />
              </linearGradient>
              <radialGradient id={id("sun")} cx="392" cy="392" r="300" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#ffe3a8" stopOpacity="0.62" />
                <stop offset="0.28" stopColor="#7adcec" stopOpacity="0.34" />
                <stop offset="1" stopColor="#4fc5dc" stopOpacity="0" />
              </radialGradient>
              <clipPath id={id("clip")}>
                <rect width="512" height="512" rx="112" />
              </clipPath>
            </defs>
            <g clipPath={`url(#${id("clip")})`}>
              <rect width="512" height="512" fill={`url(#${id("tile")})`} />
              <rect width="512" height="512" fill={`url(#${id("sun")})`} />
            </g>
            <rect x="1.5" y="1.5" width="509" height="509" rx="110.5" fill="none" stroke="#c8dcff" strokeOpacity="0.28" strokeWidth="3" />
          </svg>

          <Glow id={id} name="bar" className="m3-bar">
            <rect x="140" y="378" width="232" height="26" rx="13" fill={`url(#${id("bar-g")})`} />
          </Glow>

          <Glow id={id} name="s1" className="m3-s1" opacity={lit(1)}>
            <path d="M160 334 L256 238 L352 334" fill="none" stroke={`url(#${id("s1-g")})`} strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" />
          </Glow>
          <Glow id={id} name="s2" className="m3-s2" opacity={lit(2)}>
            <path d="M200 222 L256 166 L312 222" fill="none" stroke={`url(#${id("s2-g")})`} strokeWidth="34" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.8" />
          </Glow>
          <Glow id={id} name="s3" className="m3-s3" opacity={lit(3)}>
            <path d="M220 140 L256 104 L292 140" fill="none" stroke={`url(#${id("s3-g")})`} strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.55" />
          </Glow>

          <Glow id={id} name="dot" className="m3-dot">
            <circle cx="392" cy="391" r="15" fill="#e9fbff" />
            <circle cx="392" cy="391" r="15" fill="#ffe3a8" fillOpacity="0.55" />
          </Glow>

          {/* brillo que sigue al puntero */}
          <span className="m3-l m3-gloss" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

/** Una capa SVG con su degradado y su resplandor (cada capa lleva sus propios `defs`). */
function Glow({
  id,
  name,
  className,
  opacity = 1,
  children,
}: {
  id: (n: string) => string;
  name: string;
  className: string;
  opacity?: number;
  children: React.ReactNode;
}) {
  const stops: Record<string, [string, string, string?]> = {
    bar: ["#3fb4cf", "#9ae6f3"],
    s1: ["#b6f1fb", "#7adcec", "#3fb4cf"],
    s2: ["#b6f1fb", "#7adcec", "#3fb4cf"],
    s3: ["#b6f1fb", "#7adcec", "#3fb4cf"],
    dot: ["#fff", "#fff"],
  };
  const [a, b, c] = stops[name] ?? stops.s1;
  const horizontal = name === "bar";
  return (
    <svg className={`m3-l ${className}`} viewBox="0 0 512 512" aria-hidden="true" style={{ opacity }}>
      <defs>
        <linearGradient
          id={id(`${name}-g`)}
          x1={horizontal ? "140" : "170"}
          y1={horizontal ? "0" : "90"}
          x2={horizontal ? "372" : "350"}
          y2={horizontal ? "0" : "350"}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={a} />
          {c ? <stop offset="0.5" stopColor={b} /> : null}
          <stop offset="1" stopColor={c ?? b} />
        </linearGradient>
        <filter id={id(`${name}-f`)} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${id(`${name}-f`)})`}>{children}</g>
    </svg>
  );
}
