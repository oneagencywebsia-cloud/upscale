"use client";

import { useRef, type ReactNode } from "react";

/** Envuelve un tile de la galería con inclinación 3D según el puntero (sin librería). */
export default function TiltFrame({
  children,
  onClick,
  current,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  current: boolean;
  label: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const raf = useRef(0);

  function move(e: React.PointerEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.transform = `perspective(700px) rotateX(${(-py * 10).toFixed(2)}deg) rotateY(${(px * 12).toFixed(2)}deg) translateZ(8px)`;
    });
  }
  function reset() {
    const el = ref.current;
    if (el) el.style.transform = "";
  }

  return (
    <button
      ref={ref}
      className="frame tilt"
      role="listitem"
      aria-current={current}
      aria-label={label}
      onClick={onClick}
      onPointerMove={move}
      onPointerLeave={reset}
      onPointerCancel={reset}
    >
      {children}
    </button>
  );
}
