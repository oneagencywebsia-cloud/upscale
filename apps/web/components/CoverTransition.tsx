"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";

interface Origin {
  x: number;
  y: number;
}

type Mode = "nav" | "action";

interface CoverApi {
  trigger: (origin: Origin, run: () => void, mode: Mode) => void;
  arrived: () => void;
}

const CoverCtx = createContext<CoverApi | null>(null);

function radiusToCorner(x: number, y: number): number {
  if (typeof window === "undefined") return 0;
  const dx = Math.max(x, window.innerWidth - x);
  const dy = Math.max(y, window.innerHeight - y);
  return Math.ceil(Math.hypot(dx, dy));
}

/** Úsalo en el onClick de cualquier acceso directo que NAVEGA (pestaña,
 *  tarjeta de álbum…): cubre la pantalla, navega, y espera a que la pantalla
 *  siguiente avise de que ya montó (ver `useCoverArrived`) antes de
 *  retirarse — así nunca se ve el parpadeo de la pantalla vieja si el
 *  servidor tarda más que un temporizador fijo. */
export function useCoverNav(): (href: string, origin: Origin) => void {
  const ctx = useContext(CoverCtx);
  const router = useRouter();
  return useCallback(
    (href: string, origin: Origin) => {
      if (ctx) ctx.trigger(origin, () => router.push(href), "nav");
      else router.push(href);
    },
    [ctx, router],
  );
}

/** Úsalo para una acción que NO navega (abrir el visor de una foto/vídeo):
 *  cubre la pantalla, ejecuta la acción, y se retira sola tras un respiro
 *  corto (no hay página nueva que avise de que ha montado). */
export function useCoverAction(): (origin: Origin, action: () => void) => void {
  const ctx = useContext(CoverCtx);
  return useCallback(
    (origin: Origin, action: () => void) => {
      if (ctx) ctx.trigger(origin, action, "action");
      else action();
    },
    [ctx],
  );
}

/** Lo llama el `template.tsx` de /app en cuanto la pantalla nueva ha
 *  montado — la señal real de "ya se puede retirar el overlay", en vez de
 *  adivinar con un `setTimeout` que en una página `force-dynamic` puede
 *  tardar más que el propio viaje al servidor. */
export function useCoverArrived(): () => void {
  const ctx = useContext(CoverCtx);
  return ctx?.arrived ?? (() => {});
}

export default function CoverTransitionProvider({ children }: { children: React.ReactNode }) {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const runRef = useRef<(() => void) | null>(null);
  const modeRef = useRef<Mode>("nav");
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSafety = () => {
    if (safetyTimer.current) {
      clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }
  };

  const retreat = useCallback(() => {
    clearSafety();
    setOrigin(null);
  }, []);

  const trigger = useCallback((o: Origin, run: () => void, mode: Mode) => {
    if (runRef.current) return; // ya hay una transición en marcha
    runRef.current = run;
    modeRef.current = mode;
    setOrigin(o);
  }, []);

  const arrived = useCallback(() => {
    // una acción en la misma página se retira con su propio respiro corto;
    // "llegada" solo aplica a una navegación real de verdad
    if (modeRef.current === "nav") retreat();
  }, [retreat]);

  const radius = origin ? radiusToCorner(origin.x, origin.y) : 0;

  return (
    <CoverCtx.Provider value={{ trigger, arrived }}>
      {children}
      <AnimatePresence>
        {origin && (
          <motion.div
            key="cover"
            className="nav-cover"
            initial={{ clipPath: `circle(0px at ${origin.x}px ${origin.y}px)` }}
            animate={{ clipPath: `circle(${radius}px at ${origin.x}px ${origin.y}px)` }}
            exit={{ opacity: 0, transition: { duration: 0.3, ease: "easeOut" } }}
            transition={{ duration: 0.44, ease: [0.65, 0, 0.16, 1] }}
            onAnimationComplete={() => {
              const run = runRef.current;
              runRef.current = null;
              run?.();
              // red de seguridad: si nunca llega el aviso de "arrived" (error,
              // navegación cancelada…) no se queda tapado para siempre
              safetyTimer.current = setTimeout(retreat, modeRef.current === "action" ? 240 : 2500);
            }}
          >
            <motion.span
              className="nav-cover-glow"
              style={{ left: origin.x, top: origin.y }}
              initial={{ scale: 0.6, opacity: 0.95 }}
              animate={{ scale: 3.4, opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              aria-hidden="true"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </CoverCtx.Provider>
  );
}
