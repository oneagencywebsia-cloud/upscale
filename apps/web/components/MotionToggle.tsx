"use client";

import { useEffect, useState } from "react";

/**
 * Interruptor de animaciones de las páginas públicas. Sin él, quien tiene
 * «reducir movimiento» activado en el sistema (Windows con «Mostrar animaciones»
 * desactivado, por ejemplo) veía una portada completamente quieta y no tenía
 * forma de cambiarlo. Guarda `upscale-motion` = `on` | `off` y lo refleja en
 * `<html data-motion>`; sin elección se sigue la preferencia del sistema.
 */
export default function MotionToggle() {
  const [listo, setListo] = useState(false);
  const [activo, setActivo] = useState(true);

  useEffect(() => {
    const dato = document.documentElement.dataset.motion;
    const sistemaQuiereMenos = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setActivo(dato === "on" ? true : dato === "off" ? false : !sistemaQuiereMenos);
    setListo(true);
  }, []);

  function alternar() {
    const siguiente = !activo;
    setActivo(siguiente);
    const valor = siguiente ? "on" : "off";
    document.documentElement.setAttribute("data-motion", valor);
    try {
      localStorage.setItem("upscale-motion", valor);
    } catch {
      /* sin almacenamiento: vale para esta visita */
    }
  }

  return (
    <button
      type="button"
      className="motion-toggle"
      aria-pressed={listo ? activo : undefined}
      aria-label={listo ? (activo ? "Animaciones activadas. Pulsa para pausarlas" : "Animaciones pausadas. Pulsa para activarlas") : "Animaciones"}
      title={listo ? (activo ? "Pausar animaciones" : "Activar animaciones") : "Animaciones"}
      onClick={alternar}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {listo && !activo ? (
          <path d="M8 5.5v13l11-6.5-11-6.5z" />
        ) : (
          <>
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
            <path d="M19 16v4M17 18h4" />
          </>
        )}
      </svg>
      <span className="motion-toggle-label">{listo && !activo ? "Animar" : "Animaciones"}</span>
    </button>
  );
}
