"use client";

import { useEffect, useState } from "react";

/**
 * Botón fijo SOLO en móvil: aparece cuando el primer botón ya quedó atrás y se esconde
 * mientras el del capítulo final está a la vista (quien ya está convencido no tiene que
 * subir de vuelta). Se calcula con el progreso del recorrido, porque los botones de los
 * capítulos están siempre «dentro» de la pantalla (el escenario es fijo).
 */
export default function StickyCta({ label = "Empezar gratis" }: { label?: string }) {
  const [ver, setVer] = useState(false);

  useEffect(() => {
    const a = document.querySelector<HTMLElement>('.sc[data-escena="a"]');
    const c = document.querySelector<HTMLElement>('.sc[data-escena="c"]');
    if (!a) return;
    const progreso = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return -r.top / Math.max(1, r.height - window.innerHeight);
    };
    let raf = 0;
    const calcular = () => {
      raf = 0;
      // sale al pasar el primer botón y se esconde cuando el del cierre ya está a la vista
      const enCierre = c ? progreso(c) > 0.45 : false;
      setVer(progreso(a) > 0.1 && !enCierre);
    };
    const pedir = () => {
      if (!raf) raf = requestAnimationFrame(calcular);
    };
    window.addEventListener("scroll", pedir, { passive: true });
    window.addEventListener("resize", pedir);
    calcular();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", pedir);
      window.removeEventListener("resize", pedir);
    };
  }, []);

  return (
    <div className={`sticky-cta${ver ? " on" : ""}`} aria-hidden={!ver}>
      <a className="btn primary" href="#empezar" data-sc-top tabIndex={ver ? 0 : -1}>
        {label}
      </a>
      <small>Gratis · sin tarjeta · 1 minuto</small>
    </div>
  );
}
