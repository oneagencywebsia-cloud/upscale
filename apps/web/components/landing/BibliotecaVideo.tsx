"use client";

import { useEffect, useRef } from "react";

/**
 * El «vídeo» de la biblioteca (generado por nosotros, ver tools/generar-portada.mjs). Solo se
 * reproduce mientras se ve y si las animaciones están activadas; si no, queda la imagen de portada.
 */
export default function BibliotecaVideo() {
  const v = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = v.current;
    if (!el) return;
    const html = document.documentElement;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const quiere = () => (html.dataset.motion === "on" ? true : html.dataset.motion === "off" ? false : !mq.matches);
    const act = () => {
      if (visible && quiere()) void el.play().catch(() => {});
      else el.pause();
    };
    const io = new IntersectionObserver((es) => {
      visible = es[0]?.isIntersecting ?? false;
      act();
    }, { threshold: 0.25 });
    io.observe(el);
    const mo = new MutationObserver(act);
    mo.observe(html, { attributes: true, attributeFilter: ["data-motion"] });
    mq.addEventListener("change", act);
    return () => {
      io.disconnect();
      mo.disconnect();
      mq.removeEventListener("change", act);
    };
  }, []);

  return (
    <video ref={v} className="bib-video" muted loop playsInline preload="metadata" poster="/landing/biblioteca.jpg" aria-label="Ejemplo de una biblioteca de Upscale con fotos verticales y horizontales">
      <source src="/landing/biblioteca.mp4" type="video/mp4" />
    </video>
  );
}
