/**
 * Efectos de cada capítulo (animaciones propias, solo CSS): viven dentro del fondo del capítulo, así que
 * se funden con él y solo se animan mientras se ven (`[data-act="1"]`). Todo es transform/opacity.
 * Posiciones deterministas: el servidor y el navegador dibujan lo mismo.
 */
const frac = (n: number) => n - Math.floor(n);

type Tono = "calido" | "frio" | "dorado" | "sepia" | "neutro";

/** Motas de luz que suben (alivio, calidez) o caen (frío, el tiempo que pasa). */
export function Motas({ n = 14, dir = "sube", tono = "calido" }: { n?: number; dir?: "sube" | "cae"; tono?: Tono }) {
  return (
    <div className={`fx fx-motas fx-${dir} fx-t-${tono}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const t = 9 + frac(i * 0.71) * 9;
        return (
          <i
            key={i}
            style={{
              left: `${(frac(i * 0.618 + 0.1) * 96 + 2).toFixed(1)}%`,
              width: `${(3 + frac(i * 0.37) * 7).toFixed(1)}px`,
              height: `${(3 + frac(i * 0.37) * 7).toFixed(1)}px`,
              animationDuration: `${t.toFixed(1)}s`,
              animationDelay: `-${(frac(i * 0.93) * t).toFixed(1)}s`,
            }}
          />
        );
      })}
    </div>
  );
}

/** Rayos de luz que giran muy despacio detrás de las formas (calor, esperanza). */
export function Rayos({ suave = false }: { suave?: boolean }) {
  return <div className={`fx fx-rayos${suave ? " suave" : ""}`} aria-hidden="true" />;
}

/** Latido: el borde de la pantalla se oscurece y vuelve, como un pulso (tensión, sin dramatismo). */
export function Latido() {
  return <div className="fx fx-latido" aria-hidden="true" />;
}

/** Ondas que salen del centro de las formas (alivio: «ya está a salvo»). */
export function Ondas() {
  return (
    <div className="fx fx-ondas" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}

/** Un destello diagonal que cruza los marcos (calidad: «ni un píxel menos»). */
export function Destello() {
  return <div className="fx fx-destello" aria-hidden="true" />;
}

/** Anillo de luz que gira alrededor de la cerradura (protección). */
export function Escudo() {
  return (
    <div className="fx fx-escudo" aria-hidden="true">
      <i />
      <i />
    </div>
  );
}

const CORAZON = "M12 21s-7.2-4.6-9.6-9.2C.8 8.6 2.6 5 6 5c2 0 3.5 1.1 4.3 2.4C11 6.100 12.600 5 14.400 5c3.400 0 5.200 3.600 3.600 6.800C15.200 16.400 12 21 12 21z";
/** Corazones que suben despacio (gratitud, regalo). */
export function Corazones({ n = 12 }: { n?: number }) {
  return (
    <div className="fx fx-corazones" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const t = 8 + frac(i * 0.57) * 7;
        return (
          <svg
            key={i}
            viewBox="0 0 24 24"
            style={{
              left: `${(frac(i * 0.618 + 0.2) * 90 + 4).toFixed(1)}%`,
              width: `${(14 + frac(i * 0.41) * 22).toFixed(0)}px`,
              animationDuration: `${t.toFixed(1)}s`,
              animationDelay: `-${(frac(i * 0.77) * t).toFixed(1)}s`,
            }}
          >
            <path d={CORAZON} />
          </svg>
        );
      })}
    </div>
  );
}

/** Confeti suave que cae en bucle (alegría del cierre). */
export function Confeti({ n = 26 }: { n?: number }) {
  const col = ["#ffd166", "#ff7f8a", "#7fe0f0", "#b39bff", "#fff1b8"];
  return (
    <div className="fx fx-confeti" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const t = 6 + frac(i * 0.43) * 6;
        return (
          <i
            key={i}
            style={{
              left: `${(frac(i * 0.618 + 0.05) * 98 + 1).toFixed(1)}%`,
              background: col[i % col.length],
              width: `${(6 + frac(i * 0.29) * 7).toFixed(0)}px`,
              height: `${(10 + frac(i * 0.61) * 8).toFixed(0)}px`,
              animationDuration: `${t.toFixed(1)}s`,
              animationDelay: `-${(frac(i * 0.89) * t).toFixed(1)}s`,
            }}
          />
        );
      })}
    </div>
  );
}
