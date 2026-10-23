"use client";

import { useCallback, useEffect, useState } from "react";

const ENFOCABLES =
  'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

/**
 * Foco de un diálogo modal (WCAG 2.4.3 y 2.1.2):
 *  - al abrirse, el foco entra en el diálogo (antes se quedaba en la página de debajo);
 *  - Tab y Mayús+Tab dan la vuelta DENTRO (antes salían a los elementos tapados);
 *  - al cerrarse, el foco vuelve a quien lo abrió (antes se perdía en <body>).
 * Se pone el `ref` que devuelve en el contenedor, que debe llevar `tabIndex={-1}`.
 * Es un ref «callback» a propósito: el contenedor puede aparecer un instante
 * después de abrirse (animaciones de entrada, portales) y el efecto debe esperarlo.
 */
export function useDialogFocus<T extends HTMLElement>(activo: boolean) {
  const [el, setEl] = useState<T | null>(null);
  const ref = useCallback((nodo: T | null) => setEl(nodo), []);

  useEffect(() => {
    if (!activo || !el) return;
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });

    const visibles = () => [...el.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((n) => n.getClientRects().length > 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = visibles();
      if (!items.length) {
        e.preventDefault();
        el.focus();
        return;
      }
      const primero = items[0]!;
      const ultimo = items[items.length - 1]!;
      const actual = document.activeElement;
      if (!el.contains(actual) || (e.shiftKey && (actual === primero || actual === el))) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primero).focus();
      } else if (!e.shiftKey && actual === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("keydown", onKey);
      if (previo && previo.isConnected) previo.focus({ preventScroll: true });
    };
  }, [activo, el]);

  return ref;
}
