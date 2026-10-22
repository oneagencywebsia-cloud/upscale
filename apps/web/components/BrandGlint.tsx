"use client";

import { useEffect } from "react";
import { sinMovimiento } from "@/lib/tilt";

/**
 * Hace pasar el brillo por el subrayado del logotipo cada 6 s (ver `wm-shimmer`
 * en globals.css). Solo está «en marcha» los 1,8 s que dura el brillo: el resto
 * del tiempo no hay ninguna animación y el navegador puede descansar. No anima
 * con la pestaña oculta ni si se piden menos animaciones.
 */
export default function BrandGlint() {
  useEffect(() => {
    if (sinMovimiento()) return;
    const marcas = () => document.querySelectorAll<HTMLElement>(".brand h1, .brand .wm");
    let quitar: ReturnType<typeof setTimeout> | undefined;
    const brillar = () => {
      if (document.hidden || sinMovimiento()) return;
      marcas().forEach((m) => m.setAttribute("data-glint", ""));
      quitar = setTimeout(() => marcas().forEach((m) => m.removeAttribute("data-glint")), 1900);
    };
    const primero = setTimeout(brillar, 1000);
    const cada = setInterval(brillar, 6000);
    return () => {
      clearTimeout(primero);
      clearInterval(cada);
      if (quitar) clearTimeout(quitar);
      marcas().forEach((m) => m.removeAttribute("data-glint"));
    };
  }, []);
  return null;
}
