"use client";

import { useEffect } from "react";
import { useCoverArrived } from "@/components/CoverTransition";

/** Se re-monta en cada navegación dentro de /app → anima la entrada de cada
 *  pantalla, y avisa al overlay de "cubrir pantalla" de que ya puede
 *  retirarse (ver CoverTransition.tsx: sin este aviso, un `setTimeout` a
 *  ciegas se adelantaba a páginas `force-dynamic` lentas y se veía un
 *  parpadeo de la pantalla anterior).
 *
 *  La entrada es CSS puro (`.page-in`), no `motion.div` con `initial`: con
 *  `initial={{ opacity: 0 }}` el HTML del servidor llegaba con la página
 *  INVISIBLE y no se veía hasta que el JS terminaba de hidratar — en móvil
 *  eso era una pantalla en blanco de uno o dos segundos al entrar. */
export default function Template({ children }: { children: React.ReactNode }) {
  const arrived = useCoverArrived();
  useEffect(() => {
    arrived();
  }, [arrived]);

  return <div className="page-in">{children}</div>;
}
