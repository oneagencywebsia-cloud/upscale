"use client";

import { useEffect, useRef } from "react";

/** ¿El usuario no quiere movimiento? (interruptor de la portada o de Perfil; si no, la preferencia del sistema). */
export function sinMovimiento(): boolean {
  if (typeof window === "undefined") return true;
  const forzado = document.documentElement.dataset.motion; // el interruptor de la portada manda sobre el sistema
  if (forzado === "on") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || forzado === "off";
}

/**
 * Inclinación 3D suave. Escribe `--rx` / `--ry` (grados) y `--gx` / `--gy`
 * (0–100 %, para un brillo que sigue al puntero) en el elemento; el CSS hace
 * el resto con `transform`, que se compone en la GPU (sin repintar).
 *
 * - `scope: "self"`: reacciona al puntero sobre el propio elemento (tarjetas).
 * - `scope: "window"`: sigue al puntero por toda la pantalla (la marca de la portada).
 * - Solo trabaja mientras el elemento está a la vista y se detiene en reposo.
 * - Sin movimiento (preferencia del sistema o interruptor): no hace nada.
 */
export function useTilt<T extends HTMLElement>({ max = 12, scope = "self" }: { max?: number; scope?: "self" | "window" } = {}) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let visible = true;
    let raf = 0;
    let tx = 0, ty = 0, cx = 0, cy = 0; // objetivo y valor actual, en -1…1
    let active = false;

    const apply = () => {
      el.style.setProperty("--rx", `${(-cy * max).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(cx * max).toFixed(2)}deg`);
      el.style.setProperty("--gx", `${((cx + 1) * 50).toFixed(1)}%`);
      el.style.setProperty("--gy", `${((cy + 1) * 50).toFixed(1)}%`);
    };
    const loop = () => {
      cx += (tx - cx) * 0.14;
      cy += (ty - cy) * 0.14;
      apply();
      if (active || Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002) raf = requestAnimationFrame(loop);
      else raf = 0;
    };
    const kick = () => {
      if (!raf && visible) raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      if (!visible || sinMovimiento()) return;
      const r = el.getBoundingClientRect();
      if (scope === "window") {
        tx = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1));
        ty = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1));
      } else {
        tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
        ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      }
      active = true;
      el.dataset.tilt = "on";
      kick();
    };
    const onLeave = () => {
      active = false;
      tx = 0;
      ty = 0;
      delete el.dataset.tilt;
      kick();
    };

    const target: HTMLElement | Window = scope === "window" ? window : el;
    target.addEventListener("pointermove", onMove as EventListener, { passive: true });
    target.addEventListener("pointerleave", onLeave as EventListener);
    target.addEventListener("pointerup", onLeave as EventListener);
    target.addEventListener("pointercancel", onLeave as EventListener);

    // a la vista: solo entonces se anima; fuera de pantalla todo queda quieto
    const io = new IntersectionObserver(
      ([en]) => {
        visible = en.isIntersecting;
        el.dataset.live = visible ? "1" : "0";
        if (!visible) onLeave();
      },
      { rootMargin: "80px" },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      target.removeEventListener("pointermove", onMove as EventListener);
      target.removeEventListener("pointerleave", onLeave as EventListener);
      target.removeEventListener("pointerup", onLeave as EventListener);
      target.removeEventListener("pointercancel", onLeave as EventListener);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [max, scope]);

  return ref;
}
