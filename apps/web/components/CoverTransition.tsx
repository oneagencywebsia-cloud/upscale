"use client";

import { createContext, useCallback, useContext, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";

interface Origin {
  x: number;
  y: number;
}

const CoverCtx = createContext<((href: string, origin: Origin) => void) | null>(null);

/** Úsalo en el onClick de cualquier acceso directo (pestaña, tarjeta de álbum…)
 *  para que la navegación se sienta como una app nativa en vez de un salto de
 *  página seco. Si no hay provider montado (fuera de /app), navega normal. */
export function useCoverNav(): (href: string, origin: Origin) => void {
  const ctx = useContext(CoverCtx);
  const router = useRouter();
  return ctx ?? ((href: string) => router.push(href));
}

export default function CoverTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const pending = useRef<string | null>(null);
  const retreatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigate = useCallback(
    (href: string, o: Origin) => {
      if (pending.current) return;
      pending.current = href;
      setOrigin(o);
    },
    [],
  );

  return (
    <CoverCtx.Provider value={navigate}>
      {children}
      <AnimatePresence>
        {origin && (
          <motion.div
            key="cover"
            className="nav-cover"
            style={{ "--cx": `${origin.x}px`, "--cy": `${origin.y}px` } as CSSProperties}
            initial={{ clipPath: "circle(0% at var(--cx) var(--cy))" }}
            animate={{ clipPath: "circle(145% at var(--cx) var(--cy))" }}
            exit={{ opacity: 0, transition: { duration: 0.32, ease: "easeOut" } }}
            transition={{ duration: 0.48, ease: [0.65, 0, 0.16, 1] }}
            onAnimationComplete={(def) => {
              // solo nos interesa el momento en que TERMINA de cubrir la
              // pantalla (la animación de "clipPath"), no la de salida
              if (typeof def === "object" && def && "clipPath" in def && pending.current) {
                router.push(pending.current);
                pending.current = null;
                retreatTimer.current = setTimeout(() => setOrigin(null), 180);
              }
            }}
          >
            <span className="nav-cover-glow" aria-hidden="true" />
          </motion.div>
        )}
      </AnimatePresence>
    </CoverCtx.Provider>
  );
}
