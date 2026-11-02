"use client";

import { useEffect, useRef } from "react";
import { POSES, type IdEscena } from "./movil";

/**
 * El recorrido: un escenario fijo (sticky) con UN móvil cuya pantalla enseña la app de verdad.
 * Al hacer scroll el móvil gira suavemente de una pose a la siguiente y su pantalla cambia con un
 * fundido, capítulo a capítulo.
 *
 * Rendimiento: un solo oyente de scroll con requestAnimationFrame; cada fotograma escribe
 * `transform` en UN elemento (el móvil) y `opacity` en sus pantallas y textos. Las animaciones de
 * dentro de cada pantalla son CSS y solo corren mientras esa pantalla se ve. Nada de layout, y el
 * bucle se detiene cuando el recorrido no está en pantalla.
 *
 * Sin JavaScript, con «reducir movimiento» o con las animaciones apagadas, el recorrido se
 * convierte en una lista normal de capítulos (ver `[data-quieto]`).
 */

const ETIQUETA = { a: "Qué hace Upscale", b: "Por qué confiar", c: "Empieza hoy" } as const;
const suave = (t: number) => t * t * (3 - 2 * t);
const mezcla = (a: number, b: number, t: number) => a + (b - a) * t;

/** Los capítulos son texto de servidor (los lee cualquier buscador); aquí solo se les da vida. */
export default function Scrolly({ escena, capitulos, pantallas }: { escena: IdEscena; capitulos: React.ReactNode[]; pantallas: React.ReactNode[] }) {
  const raiz = useRef<HTMLElement>(null);
  const POSA = POSES[escena];
  const N_CAPITULOS = POSA.length;

  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const pantallasEl = Array.from(el.querySelectorAll<HTMLElement>(".mv-s"));
    const pose = el.querySelector<HTMLElement>(".mv-pose");
    const caps = Array.from(el.querySelectorAll<HTMLElement>(".sc-cap"));
    const movilEl = el.querySelector<HTMLElement>(".sc-movil");
    const escenario = el.querySelector<HTMLElement>(".sc-escenario");
    const fondos = Array.from(el.querySelectorAll<HTMLElement>(".sc-fondo"));
    if (!escenario || !fondos.length || !pose) return;

    const html = document.documentElement;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const quiere = () => (html.dataset.motion === "on" ? true : html.dataset.motion === "off" ? false : !mq.matches);

    let W = 0;
    let H = 0;
    let top = 0;
    let largo = 1;
    let bx = 0;
    let by = 0;
    let activo = false;
    let visible = true;
    let raf = 0;
    let ultimo = -1;

    const medir = () => {
      const r = escenario.getBoundingClientRect();
      W = r.width;
      H = r.height;
      const rr = el.getBoundingClientRect();
      top = rr.top + window.scrollY;
      largo = Math.max(1, rr.height - H);
      // el móvil: en vertical grande y centrado arriba (el texto va debajo); en ancho, a la derecha
      const ancho = W / H > 1.1;
      let ph = H * (ancho ? 0.84 : 0.58);
      let pw = ph * 0.485;
      const maxW = ancho ? W * 0.4 : W * 0.66;
      if (pw > maxW) {
        pw = maxW;
        ph = pw / 0.485;
      }
      bx = (ancho ? W * 0.72 : W * 0.5) - pw / 2;
      by = ancho ? (H - ph) / 2 : H * 0.045;
      pose.style.width = `${pw.toFixed(0)}px`;
      pose.style.height = `${ph.toFixed(0)}px`;
      pose.style.setProperty("--mw", `${pw.toFixed(0)}px`);
    };

    const pintar = (p: number) => {
      const c = p * (N_CAPITULOS - 1);
      const i = Math.min(N_CAPITULOS - 2, Math.floor(c));
      // pausa de lectura: el móvil se queda quieto en cada capítulo y solo cambia en el tramo entre capítulos
      const t = suave(Math.min(1, Math.max(0, (c - i - 0.3) / 0.4)));
      const A = POSA[i]!;
      const B = POSA[i + 1]!;
      const x = bx + mezcla(A.x, B.x, t) * W;
      const y = by + mezcla(A.y, B.y, t) * H;
      pose.style.transform = `perspective(1500px) translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotateX(${mezcla(A.rx, B.rx, t).toFixed(2)}deg) rotateY(${mezcla(A.ry, B.ry, t).toFixed(2)}deg) rotateZ(${mezcla(A.rz, B.rz, t).toFixed(2)}deg) scale(${mezcla(A.s, B.s, t).toFixed(4)})`;
      // pantalla: la actual se funde con la siguiente solo en el tramo de cambio
      for (let j = 0; j < pantallasEl.length; j++) {
        const o = j === i ? 1 - t : j === i + 1 ? t : 0;
        const pn = pantallasEl[j]!;
        pn.style.opacity = o.toFixed(3);
        pn.style.visibility = o > 0.01 ? "visible" : "hidden";
        pn.dataset.on = o > 0.5 ? "1" : "0";
      }
      // texto: cada capítulo se ve cerca de su momento; los botones solo se pueden pulsar en el suyo
      for (let j = 0; j < caps.length; j++) {
        const d = c - j;
        // el texto se ve entero durante ±0,3 capítulos y se desvanece hasta ±0,5
        const v = Math.min(1, Math.max(0, (0.5 - Math.abs(d)) / 0.2));
        const cap = caps[j]!;
        cap.style.opacity = v.toFixed(2);
        cap.style.visibility = v > 0.01 ? "visible" : "hidden";
        cap.style.transform = `translate3d(0,${(-d * 22).toFixed(1)}px,0)`;
        cap.style.pointerEvents = v > 0.55 ? "auto" : "none";
        cap.toggleAttribute("inert", v < 0.4);
        cap.classList.toggle("on", v > 0.5);
      }
      // fondo: cada capítulo tiene SU ambiente (color, luz, anillos) y se funden entre sí con solo opacity
      for (let j = 0; j < fondos.length; j++) {
        const o = Math.min(1, Math.max(0, (0.7 - Math.abs(c - j)) / 0.4));
        fondos[j]!.style.opacity = o.toFixed(3);
        fondos[j]!.dataset.act = o > 0.02 ? "1" : "0";
      }
    };

    // El recorrido sigue al dedo con inercia (muelle amortiguado, independiente de los fps):
    // todo se desliza en vez de saltar de un valor a otro.
    let actual = -1;
    let t0 = 0;
    const fotograma = (ts: number) => {
      raf = 0;
      if (!activo || !visible) {
        t0 = 0;
        return;
      }
      const dt = t0 ? Math.min(0.05, (ts - t0) / 1000) : 0.016;
      t0 = ts;
      const objetivo = Math.min(1, Math.max(0, (window.scrollY - top) / largo));
      if (actual < 0 || ultimo < 0) actual = objetivo;
      else actual += (objetivo - actual) * (1 - Math.exp(-dt * 11));
      if (Math.abs(objetivo - actual) < 0.0003) actual = objetivo;
      if (Math.abs(actual - ultimo) > 0.0004 || (actual === objetivo && actual !== ultimo)) {
        ultimo = actual;
        pintar(actual);
      }
      if (actual !== objetivo) raf = requestAnimationFrame(fotograma);
      else t0 = 0;
    };
    const pedir = () => {
      if (!raf) raf = requestAnimationFrame(fotograma);
    };

    const aplicar = () => {
      const q = quiere();
      if (q === activo) return;
      activo = q;
      if (q) {
        el.removeAttribute("data-quieto");
        medir();
        ultimo = -1;
        pedir();
        el.setAttribute("data-listo", "");
      } else {
        el.removeAttribute("data-listo");
        el.setAttribute("data-quieto", "");
        pose.removeAttribute("style");
        for (const n of pantallasEl) n.removeAttribute("style");
        for (const c of caps) {
          c.removeAttribute("style");
          c.removeAttribute("inert");
        }
      }
    };

    const ro = new ResizeObserver(() => {
      if (!activo) return;
      medir();
      ultimo = -1;
      pedir();
    });
    ro.observe(escenario);
    ro.observe(el);
    const io = new IntersectionObserver((es) => {
      visible = es[0]?.isIntersecting ?? true;
      // fuera de pantalla la escena entera deja de existir para el compositor (menos capas, menos memoria)
      el.dataset.vis = visible ? "1" : "0";
      if (visible) pedir();
    }, { rootMargin: "200px 0px" });
    io.observe(el);
    const mo = new MutationObserver(aplicar);
    mo.observe(html, { attributes: true, attributeFilter: ["data-motion"] });
    const suaveOno = () => (quiere() ? ("smooth" as const) : ("auto" as const));
    const clic = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>("[data-sc-next],[data-sc-top]");
      if (!a) return;
      e.preventDefault();
      if (a.hasAttribute("data-sc-top")) {
        window.scrollTo({ top: 0, behavior: suaveOno() });
        window.setTimeout(() => el.querySelector<HTMLElement>(".sc-cap[data-cap='0'] button, .sc-cap[data-cap='0'] a.btn")?.focus({ preventScroll: true }), 500);
      } else {
        window.scrollBy({ top: window.innerHeight * 1.35, behavior: suaveOno() });
      }
    };
    // paralaje suave con el ratón (solo en equipos con puntero fino)
    const fino = window.matchMedia("(pointer: fine)");
    let pr = 0;
    const mover = (e: PointerEvent) => {
      if (!activo || !visible || !movilEl || !fino.matches || pr) return;
      pr = requestAnimationFrame(() => {
        pr = 0;
        const dx = e.clientX / window.innerWidth - 0.5;
        const dy = e.clientY / window.innerHeight - 0.5;
        movilEl.style.transform = `translate3d(${(-dx * 22).toFixed(1)}px,${(-dy * 14).toFixed(1)}px,0)`;
      });
    };
    window.addEventListener("pointermove", mover, { passive: true });
    if (escena === "a") document.addEventListener("click", clic);
    window.addEventListener("scroll", pedir, { passive: true });
    mq.addEventListener("change", aplicar);
    aplicar();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      window.removeEventListener("scroll", pedir);
      window.removeEventListener("pointermove", mover);
      cancelAnimationFrame(pr);
      if (escena === "a") document.removeEventListener("click", clic);
      mq.removeEventListener("change", aplicar);
    };
  }, [POSA, N_CAPITULOS, escena]);

  return (
    <section ref={raiz} className="sc" data-escena={escena} aria-label={ETIQUETA[escena]} style={{ ["--n" as string]: N_CAPITULOS }}>
      <div className="sc-escenario">
        <div className="sc-fondos" aria-hidden="true">
          {POSA.map((_, j) => (
            <div key={j} className="sc-fondo" data-m={j} data-act={j === 0 ? "1" : "0"} style={{ opacity: j === 0 ? 1 : 0 }} />
          ))}
        </div>
        <div className="sc-movil" aria-hidden="true">
          <div className="mv-pose">
            <div className="mv-tel">
              <i className="mv-isla" />
              <div className="mv-pantalla">
                {pantallas.map((p, j) => (
                  <div key={j} className="mv-s" data-on={j === 0 ? "1" : "0"} style={j === 0 ? { opacity: 1 } : { opacity: 0, visibility: "hidden" }}>
                    {p}
                  </div>
                ))}
              </div>
              <i className="mv-brillo" />
            </div>
          </div>
        </div>
        {capitulos.map((c, j) => (
          <div key={j} className={`sc-cap${j === 0 ? " on" : ""}`} data-cap={j} {...(j > 0 ? ({ inert: "" } as Record<string, string>) : {})} style={j === 0 ? { opacity: 1 } : { opacity: 0, pointerEvents: "none" }}>
            {c}
          </div>
        ))}
      </div>
    </section>
  );
}
