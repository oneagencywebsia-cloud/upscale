"use client";

import { useState } from "react";
import { STEPS } from "./content";

const ICONS = [
  // cuenta
  <svg key="a" viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="24" cy="18" r="8" />
    <path d="M8 41c1.8-8 8-12 16-12s14.2 4 16 12" />
  </svg>,
  // subir
  <svg key="b" viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M24 34V10M14 20l10-10 10 10" />
    <path d="M8 36v3a3 3 0 003 3h26a3 3 0 003-3v-3" />
  </svg>,
  // dispositivos
  <svg key="c" viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="10" width="28" height="19" rx="3" />
    <path d="M2 35h34" />
    <rect x="30" y="18" width="13" height="22" rx="3" />
  </svg>,
];

/** "Cómo funciona" de uno en uno. Los tres pasos están en el HTML (los lee
 *  cualquier buscador); a la vista solo uno, con un "Siguiente" grande. */
export default function Steps() {
  const [i, setI] = useState(0);
  const last = i === STEPS.length - 1;

  return (
    <div className="steps">
      <ol className="steps-dots" aria-label="Pasos">
        {STEPS.map((s, n) => (
          <li key={s.t}>
            <button
              type="button"
              className={n === i ? "on" : n < i ? "done" : ""}
              aria-current={n === i ? "step" : undefined}
              aria-label={`Paso ${n + 1}: ${s.t}`}
              onClick={() => setI(n)}
            >
              {n + 1}
            </button>
          </li>
        ))}
      </ol>

      {STEPS.map((s, n) => (
        <article key={s.t} className="step-card" hidden={n !== i} aria-live="polite">
          <span className="step-icon">{ICONS[n]}</span>
          <h3>{s.t}</h3>
          <p>{s.d}</p>
          <span className="step-time">{s.time}</span>
        </article>
      ))}

      <div className="steps-nav">
        {last ? (
          <a className="btn primary" href="#empezar">
            ¡Lo quiero!
          </a>
        ) : (
          <button type="button" className="btn primary" onClick={() => setI(i + 1)}>
            Siguiente
          </button>
        )}
      </div>
    </div>
  );
}
