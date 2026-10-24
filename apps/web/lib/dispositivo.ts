"use client";

import { useSyncExternalStore } from "react";

const CONSULTA = "(hover: hover) and (pointer: fine)";

function suscribir(cb: () => void) {
  const mq = window.matchMedia(CONSULTA);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * ¿Hay ratón y teclado «de verdad»? Móviles y tabletas táctiles → false.
 * Sirve para no escribir «Ctrl+V», «arrastra» o «Enter» donde no existen.
 * En el servidor (y en la primera pintura) es false: el texto neutro siempre es válido.
 */
export function useTeclado(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => window.matchMedia(CONSULTA).matches,
    () => false,
  );
}

/** «Ctrl+B» o «⌘B» según el sistema. Solo se llama si `useTeclado()` es true. */
export function atajo(letra: string): string {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return mac ? `⌘${letra}` : `Ctrl+${letra}`;
}
