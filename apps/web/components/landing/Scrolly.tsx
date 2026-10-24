"use client";

import { useEffect, useRef } from "react";
import { DISPOSICIONES, ESCENAS, N, type Forma, type IdEscena } from "./formas";

/**
 * El recorrido: un escenario fijo (sticky) donde las mismas formas se transforman
 * de un capítulo al siguiente mientras se hace scroll, como un vídeo que avanza con el dedo.
 *
 * Rendimiento: un solo oyente de scroll con requestAnimationFrame; cada fotograma
 * solo escribe `transform`, `opacity` y `border-radius` en ~28 elementos y un par de
 * variables en el contenedor. Nada de layout, nada de JS por elemento fuera de ese
 * bucle, y el bucle se detiene cuando el recorrido no está en pantalla.
 *
 * Sin JavaScript, con «reducir movimiento» o con las animaciones apagadas, el
 * recorrido se convierte en una lista normal de capítulos (ver `[data-quieto]`).
 */

const ETIQUETA = { a: "Qué hace Upscale", b: "Por qué confiar", c: "Empieza hoy" } as const;
const suave = (t: number) => t * t * (3 - 2 * t);
const mezcla = (a: number, b: number, t: number) => a + (b - a) * t;

/** Los capítulos son texto de servidor (los lee cualquier buscador); aquí solo se les da vida. */
export default function Scrolly({ escena, capitulos }: { escena: IdEscena; capitulos: React.ReactNode[] }) {
  const raiz = useRef<HTMLElement>(null);
  const DISP = DISPOSICIONES[escena];
  const MATICES = ESCENAS[escena].matices;
  const N_CAPITULOS = DISP.length;

  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const formas = Array.from(el.querySelectorAll<HTMLElement>(".sc-f"));
    const caps = Array.from(el.querySelectorAll<HTMLElement>(".sc-cap"));
    const barra = el.querySelector<HTMLElement>(".sc-barra i");
    const escenario = el.querySelector<HTMLElement>(".sc-escenario");
    const fondo = el.querySelector<HTMLElement>(".sc-fondo");
    if (!escenario || !fondo) return;

    const html = document.documentElement;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const quiere = () => (html.dataset.motion === "on" ? true : html.dataset.motion === "off" ? false : !mq.matches);

    let W = 0;
    let H = 0;
    let top = 0;
    let largo = 1;
    let activo = false;
    let visible = true;
    let raf = 0;
    let ultimo = -1;
    let ultimoMatiz = "";

    const medir = () => {
      const r = escenario.getBoundingClientRect();
      W = r.width;
      H = r.height;
      const rr = el.getBoundingClientRect();
      top = rr.top + window.scrollY;
      largo = Math.max(1, rr.height - H);
    };

    const pintar = (p: number) => {
      const c = p * (N_CAPITULOS - 1);
      const i = Math.min(N_CAPITULOS - 2, Math.floor(c));
      const t = suave(c - i);
      const A = DISP[i]!;
      const B = DISP[i + 1]!;
      // En vertical (móvil) las formas van arriba y el texto abajo; en ancho, formas a la derecha.
      const lado = Math.min(W, H);
      const ancho = W / H > 1.1;
      const escala = ancho ? lado * 0.98 : Math.min(W * 1.02, H * 0.62);
      const ox = ancho ? W * 0.22 : 0;
      const oy = ancho ? 0 : -H * 0.17;
      for (let k = 0; k < N; k++) {
        const a: Forma = A[k]!;
        const b: Forma = B[k]!;
        const x = mezcla(a.x, b.x, t) * escala * 0.5 + ox;
        const y = mezcla(a.y, b.y, t) * escala * 0.5 + oy;
        const s = mezcla(a.s, b.s, t) * escala;
        const asp = mezcla(a.a, b.a, t);
        const nodo = formas[k]!;
        // el ancho cambia con la proporción (así las fotos de dentro no se deforman); lo demás, solo transform
        nodo.style.width = `${(100 * asp).toFixed(1)}px`;
        nodo.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${mezcla(a.g, b.g, t).toFixed(1)}deg) scale(${(s / 100).toFixed(4)}) translate(-50%,-50%)`;
        nodo.style.opacity = mezcla(a.o, b.o, t).toFixed(2);
        nodo.style.borderRadius = `${mezcla(a.r, b.r, t).toFixed(1)}%`;
      }
      // texto: cada capítulo se ve cerca de su momento; los botones solo se pueden pulsar en el suyo
      for (let j = 0; j < caps.length; j++) {
        const d = c - j;
        const v = Math.max(0, 1 - Math.abs(d) * 2.1);
        const cap = caps[j]!;
        cap.style.opacity = v.toFixed(2);
        cap.style.transform = `translate3d(0,${(-d * 38).toFixed(1)}px,0)`;
        cap.style.pointerEvents = v > 0.55 ? "auto" : "none";
        cap.toggleAttribute("inert", v < 0.4);
      }
      // fondo: el color cambia suavemente de un capítulo al siguiente
      const hue = mezcla(MATICES[i]!, MATICES[i + 1]!, t);
      const h = hue.toFixed(0);
      if (h !== ultimoMatiz) {
        ultimoMatiz = h;
        fondo.style.setProperty("--h", h);
      }
      if (barra) barra.style.transform = `scaleX(${p.toFixed(3)})`;
    };

    const fotograma = () => {
      raf = 0;
      if (!activo || !visible) return;
      const p = Math.min(1, Math.max(0, (window.scrollY - top) / largo));
      if (Math.abs(p - ultimo) > 0.0004) {
        ultimo = p;
        pintar(p);
      }
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
      } else {
        el.setAttribute("data-quieto", "");
        for (const n of formas) n.removeAttribute("style");
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
        window.scrollBy({ top: window.innerHeight * 0.88, behavior: suaveOno() });
      }
    };
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
      if (escena === "a") document.removeEventListener("click", clic);
      mq.removeEventListener("change", aplicar);
    };
  }, [DISP, MATICES, N_CAPITULOS, escena]);

  return (
    <section ref={raiz} className="sc" data-escena={escena} aria-label={ETIQUETA[escena]} style={{ ["--n" as string]: N_CAPITULOS }}>
      <div className="sc-escenario">
        <div className="sc-fondo" aria-hidden="true" style={{ ["--h" as string]: MATICES[0] }} />
        <div className="sc-formas" aria-hidden="true">
          {Array.from({ length: N }, (_, k) => (
            <i key={k} className={`sc-f sc-f-${k % 4}`} />
          ))}
        </div>
        {capitulos.map((c, j) => (
          <div key={j} className="sc-cap" data-cap={j} {...(j > 0 ? ({ inert: "" } as Record<string, string>) : {})} style={j === 0 ? { opacity: 1 } : { opacity: 0, pointerEvents: "none" }}>
            {c}
          </div>
        ))}
        <div className="sc-barra" aria-hidden="true">
          <i />
        </div>
      </div>
    </section>
  );
}
