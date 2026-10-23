/**
 * «El ascenso»: el fondo infinito de la portada.
 *
 * Escalones con la forma del símbolo de Upscale suben sin parar por toda la
 * pantalla, a distintas profundidades (los cercanos grandes, rápidos y nítidos;
 * los lejanos pequeños, lentos y desenfocados), se bambolean y giran en 3D; entre
 * ellos flota polvo de luz y un sol cálido respira en la esquina, como en el
 * logotipo. Debajo sigue la aurora.
 *
 * Es un componente de SERVIDOR (no manda JavaScript) y las posiciones salen de
 * fórmulas fijas, así que no hay diferencias entre servidor y navegador. Todo lo
 * que se anima es `transform` / `opacity` / `translate` (GPU), sin `var()` en los
 * fotogramas. Con «reducir movimiento» (o animaciones apagadas) los escalones se
 * quedan quietos y solo «respiran» (ver `.sky-*` en globals.css).
 */

type Escalon = { x: number; y: number; w: number; t: number; d: number; ds: number; dt: number; o: number; blur: number; sw: number; st: number; tt: number; tone: "a" | "b" | "c" };

const frac = (n: number) => n - Math.floor(n);

function escalones(n: number): Escalon[] {
  return Array.from({ length: n }, (_, i) => {
    const r = frac(i * 0.381966 + 0.17); // 0 = lejos … 1 = cerca
    const k = r * r;
    return {
      x: +(frac(i * 0.618034 + 0.05) * 94 + 1).toFixed(1), // vw
      y: +(frac(i * 0.754877 + 0.3) * 90 + 4).toFixed(1), // vh (posición quieta del modo calmado)
      w: Math.round(26 + k * 118), // px
      t: +(58 - r * 36).toFixed(1), // s: lejos lento, cerca rápido
      // Retardos NEGATIVOS (el campo ya está poblado al cargar), cada uno dentro de la
      // duración de su propia animación, para que ninguna arranque varias vueltas adelantada.
      d: +(frac(i * 0.7548 + 0.11) * (58 - r * 36)).toFixed(1),
      ds: +(frac(i * 0.6180 + 0.37) * (7 + (i % 5) * 2.3)).toFixed(1),
      dt: +(frac(i * 0.4142 + 0.21) * (9 + (i % 4) * 3.1)).toFixed(1),
      o: +(0.2 + r * 0.38).toFixed(2),
      blur: +((1 - r) * 2.4).toFixed(1),
      sw: Math.round(14 + r * 34), // px de bamboleo
      st: +(7 + (i % 5) * 2.3).toFixed(1),
      tt: +(9 + (i % 4) * 3.1).toFixed(1),
      tone: i % 5 === 3 ? "c" : i % 3 === 1 ? "b" : "a",
    };
  });
}

function polvo(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const t = +(30 + frac(i * 0.43 + 0.2) * 40).toFixed(1);
    return {
      x: +(frac(i * 0.789 + 0.13) * 98 + 1).toFixed(1),
      y: +(frac(i * 0.531 + 0.4) * 94 + 3).toFixed(1),
      s: +(2 + frac(i * 0.37) * 3.4).toFixed(1),
      t,
      d: +(frac(i * 0.91 + 0.07) * t).toFixed(1),
      o: +(0.28 + frac(i * 0.53) * 0.5).toFixed(2),
    };
  });
}

export default function Sky({ compact = false }: { compact?: boolean }) {
  const steps = escalones(compact ? 9 : 18);
  const dust = polvo(compact ? 10 : 24);
  return (
    <div className="sky" aria-hidden="true">
      <div className="sky-layer">
        <span className="sky-sun" />
        {steps.map((s, i) => (
          <i
            key={`e${i}`}
            className={`sky-step tone-${s.tone}`}
            style={{
              ["--x" as string]: `${s.x}vw`,
              ["--y" as string]: s.y,
              ["--w" as string]: `${s.w}px`,
              ["--t" as string]: `${s.t}s`,
              ["--d" as string]: `-${s.d}s`,
              ["--ds" as string]: `-${s.ds}s`,
              ["--dt" as string]: `-${s.dt}s`,
              ["--o" as string]: s.o,
              ["--bl" as string]: `${s.blur}px`,
              ["--sw" as string]: `${s.sw}px`,
              ["--st" as string]: `${s.st}s`,
              ["--tt" as string]: `${s.tt}s`,
            }}
          >
            <b />
          </i>
        ))}
        {dust.map((p, i) => (
          <u
            key={`p${i}`}
            className="sky-dot"
            style={{
              ["--x" as string]: `${p.x}vw`,
              ["--y" as string]: p.y,
              ["--s" as string]: `${p.s}px`,
              ["--t" as string]: `${p.t}s`,
              ["--d" as string]: `-${p.d}s`,
              ["--o" as string]: p.o,
            }}
          />
        ))}
      </div>
      {/* velo suave en la columna central: el texto queda tranquilo y los lados siguen vivos */}
      <span className="sky-scrim" />
    </div>
  );
}
