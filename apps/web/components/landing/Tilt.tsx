"use client";

import { useTilt } from "@/lib/tilt";

/** Tarjeta que se inclina en 3D hacia el puntero (o el dedo) con un brillo que
 *  la sigue. Solo `transform`; quieta si se piden menos animaciones. */
export default function Tilt({
  as: Tag = "div",
  className = "",
  max = 7,
  children,
}: {
  as?: "div" | "article";
  className?: string;
  max?: number;
  children: React.ReactNode;
}) {
  const ref = useTilt<HTMLDivElement>({ max });
  return (
    <Tag ref={ref as never} className={`tilt3d ${className}`.trim()}>
      {children}
    </Tag>
  );
}
