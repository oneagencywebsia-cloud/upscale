import { useId } from "react";

/**
 * Símbolo de Upscale (ver docs/BRANDING.md → Logotipo).
 *
 * Tres peldaños que suben (la escala), la línea de la marca y su punto de luz
 * sobre un cristal de anochecer con un sol cálido en la esquina. Misma
 * geometría que public/brand/upscale-mark.svg — si se toca una, tocar la otra.
 *
 * `animated`: los peldaños se iluminan de abajo arriba y el punto late
 * (solo opacidad/escala, ver `.bm-*` en globals.css).
 */
export default function BrandMark({
  size,
  animated = false,
  className = "",
}: {
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  // ids únicos por instancia: dos marcas en la misma página no pueden compartir <defs>
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (n: string) => `bm${uid}-${n}`;
  const ref = (n: string) => `url(#${id(n)})`;

  return (
    <svg
      className={`brandmark ${animated ? "bm-animated" : ""} ${className}`.trim()}
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role="img"
      aria-label="Upscale"
    >
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
        <linearGradient id={id("glyph")} x1="170" y1="90" x2="350" y2="350" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#b6f1fb" />
          <stop offset="0.5" stopColor="#7adcec" />
          <stop offset="1" stopColor="#3fb4cf" />
        </linearGradient>
        <linearGradient id={id("line")} x1="140" y1="0" x2="372" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3fb4cf" />
          <stop offset="1" stopColor="#9ae6f3" />
        </linearGradient>
        <linearGradient id={id("gloss")} x1="0" y1="0" x2="0" y2="256" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={id("clip")}>
          <rect width="512" height="512" rx="112" />
        </clipPath>
        <filter id={id("glow")} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="9" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g clipPath={ref("clip")}>
        <rect width="512" height="512" fill={ref("tile")} />
        <rect width="512" height="512" fill={ref("sun")} />
        <rect width="512" height="256" fill={ref("gloss")} />
      </g>
      <rect x="1.5" y="1.5" width="509" height="509" rx="110.5" fill="none" stroke="#c8dcff" strokeOpacity="0.22" strokeWidth="3" />
      <path d="M112 3.5 H400" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" fill="none" />

      <g fill="none" strokeLinecap="round" strokeLinejoin="round" filter={ref("glow")}>
        <path className="bm-step bm-s1" d="M160 334 L256 238 L352 334" stroke={ref("glyph")} strokeWidth="46" />
        <path className="bm-step bm-s2" d="M200 222 L256 166 L312 222" stroke={ref("glyph")} strokeWidth="34" strokeOpacity="0.72" />
        <path className="bm-step bm-s3" d="M220 140 L256 104 L292 140" stroke={ref("glyph")} strokeWidth="26" strokeOpacity="0.42" />
      </g>

      <rect x="140" y="378" width="232" height="26" rx="13" fill={ref("line")} filter={ref("glow")} />
      <g className="bm-dot" filter={ref("glow")}>
        <circle cx="392" cy="391" r="15" fill="#e9fbff" />
        <circle cx="392" cy="391" r="15" fill="#ffe3a8" fillOpacity="0.55" />
      </g>
    </svg>
  );
}
