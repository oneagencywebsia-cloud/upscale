"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import { useCoverArrived } from "@/components/CoverTransition";

/** Se re-monta en cada navegación dentro de /app → anima la entrada de cada
 *  pantalla, y avisa al overlay de "cubrir pantalla" de que ya puede
 *  retirarse (ver CoverTransition.tsx: sin este aviso, un `setTimeout` a
 *  ciegas se adelantaba a páginas `force-dynamic` lentas y se veía un
 *  parpadeo de la pantalla anterior). */
export default function Template({ children }: { children: React.ReactNode }) {
  const arrived = useCoverArrived();
  useEffect(() => {
    arrived();
  }, [arrived]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
