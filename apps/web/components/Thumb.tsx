"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Miniatura que no se rompe a la vista. Si la imagen falla (Telegram lento, un 503
 * transitorio, un corte de red) reintenta dos veces con espera creciente y, si
 * sigue sin cargar, enseña un marcador discreto en lugar del icono de imagen rota
 * con el nombre del archivo encima. El nombre ya lo anuncia el botón que la
 * contiene (`aria-label`), así que la imagen es decorativa (`alt=""`).
 */
const ESPERAS_MS = [900, 2400];

export default function Thumb({ src }: { src: string }) {
  const [intento, setIntento] = useState(0);
  const [fallo, setFallo] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout>>();
  const img = useRef<HTMLImageElement>(null);

  // un fallo o un reintento: espera y vuelve a intentarlo; tras el último, marcador
  const fallar = useCallback(() => {
    if (intento < ESPERAS_MS.length) temporizador.current = setTimeout(() => setIntento((n) => n + 1), ESPERAS_MS[intento]);
    else setFallo(true);
  }, [intento]);

  // La imagen del HTML del servidor puede fallar ANTES de que React termine de hidratar:
  // entonces `onError` ya pasó y nadie lo vio (el icono roto se quedaba para siempre).
  // Al montar se mira el estado real de la imagen.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0 && el.getAttribute("src")) fallar();
  }, [fallar]);

  useEffect(() => {
    setIntento(0);
    setFallo(false);
    return () => clearTimeout(temporizador.current);
  }, [src]);

  if (fallo) {
    return (
      <span className="thumb-fail" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M21 16l-5-5-8 9" />
        </svg>
      </span>
    );
  }

  return (
    <img
      ref={img}
      key={intento}
      // la firma de la URL no depende de `_r`: solo evita que el navegador reutilice el fallo
      src={intento ? `${src}${src.includes("?") ? "&" : "?"}_r=${intento}` : src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={fallar}
    />
  );
}
