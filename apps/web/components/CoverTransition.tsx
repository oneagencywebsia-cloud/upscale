"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";

interface Origin {
  x: number;
  y: number;
}

type Mode = "nav" | "action";
type Variant = "circle" | "diamond" | "wipe" | "shutter" | "blinds";

/** Duración de la fase de cubrir de cada estilo (s). */
const DUR: Record<Variant, number> = { circle: 0.24, diamond: 0.26, wipe: 0.26, shutter: 0.24, blinds: 0.32 };
const VARIANTS: Variant[] = ["circle", "wipe", "diamond", "shutter", "blinds"];
const BLIND_COUNT = 7;

/** Baraja los estilos y los va sacando de uno en uno: nunca repite el mismo
 *  dos veces seguidas, pero el orden cambia cada vuelta. */
function makeDeck(last?: Variant): Variant[] {
  const d = [...VARIANTS].sort(() => Math.random() - 0.5);
  if (d[0] === last) d.push(d.shift()!);
  return d;
}

interface CoverApi {
  trigger: (origin: Origin, run: () => void, mode: Mode) => void;
  arrived: () => void;
}

const CoverCtx = createContext<CoverApi | null>(null);

function manhattanToCorner(x: number, y: number): number {
  if (typeof window === "undefined") return 0;
  return Math.ceil(Math.max(x, window.innerWidth - x) + Math.max(y, window.innerHeight - y));
}

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
  const [variant, setVariant] = useState<Variant>("circle");
  const deck = useRef<Variant[]>([]);
  const lastVariant = useRef<Variant | undefined>(undefined);
  const runRef = useRef<(() => void) | null>(null);
  const modeRef = useRef<Mode>("nav");
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSafety = () => {
    if (safetyTimer.current) {
      clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }
  };

  const activeRef = useRef(false);
  const retreat = useCallback(() => {
    clearSafety();
    activeRef.current = false;
    setOrigin(null);
  }, []);

  // Cambiar solo el ?kind=/?fav= (Todo/Fotos/Vídeos) NO remonta el template,
  // así que nadie avisaba de "ya llegó" y el overlay esperaba al temporizador
  // de seguridad (2,5 s). El cambio de URL es la señal real en ese caso.
  const pathname = usePathname();
  const sp = useSearchParams();
  const urlKey = `${pathname}?${sp.toString()}`;
  const lastUrl = useRef(urlKey);
  useEffect(() => {
    if (lastUrl.current === urlKey) return;
    lastUrl.current = urlKey;
    if (activeRef.current && modeRef.current === "nav" && runRef.current === null) retreat();
  }, [urlKey, retreat]);

  const trigger = useCallback((o: Origin, run: () => void, mode: Mode) => {
    if (runRef.current) return; // ya hay una transición en marcha
    runRef.current = run;
    activeRef.current = true;
    modeRef.current = mode;
    if (!deck.current.length) deck.current = makeDeck(lastVariant.current);
    const v = deck.current.shift()!;
    lastVariant.current = v;
    setVariant(v);
    setOrigin(o);
  }, []);

  const arrived = useCallback(() => {
    // una acción en la misma página se retira con su propio respiro corto;
    // "llegada" solo aplica a una navegación real de verdad
    if (modeRef.current === "nav") retreat();
  }, [retreat]);

  const radius = origin ? radiusToCorner(origin.x, origin.y) : 0;
  const manhattan = origin ? manhattanToCorner(origin.x, origin.y) : 0;
  const T = DUR[variant];
  const ease = [0.5, 0, 0.1, 1] as const;

  return (
    <CoverCtx.Provider value={{ trigger, arrived }}>
      {children}
      <AnimatePresence>
        {origin && (
          <motion.div
            key="cover"
            className="nav-cover"
            initial={{ opacity: 0.99 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.16, ease: "easeOut" } }}
            transition={{ duration: T }}
            onAnimationComplete={() => {
              const run = runRef.current;
              runRef.current = null;
              run?.();
              // red de seguridad: si nunca llega el aviso de "arrived" (error,
              // navegación cancelada…) no se queda tapado para siempre
              safetyTimer.current = setTimeout(retreat, modeRef.current === "action" ? 240 : 2500);
            }}
          >
            {variant === "circle" && (
              <>
                <motion.div
                  className="nav-cover-fill"
                  initial={{ clipPath: `circle(0px at ${origin.x}px ${origin.y}px)` }}
                  animate={{ clipPath: `circle(${radius}px at ${origin.x}px ${origin.y}px)` }}
                  transition={{ duration: T, ease }}
                />
                <motion.span
                  className="nav-cover-glow"
                  style={{ left: origin.x, top: origin.y }}
                  initial={{ scale: 0.6, opacity: 0.95 }}
                  animate={{ scale: 3.4, opacity: 0 }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                  aria-hidden="true"
                />
              </>
            )}
            {variant === "diamond" && (
              <>
                <motion.div
                  className="nav-cover-fill alt"
                  initial={{ clipPath: `polygon(${origin.x}px ${origin.y}px, ${origin.x}px ${origin.y}px, ${origin.x}px ${origin.y}px, ${origin.x}px ${origin.y}px)` }}
                  animate={{
                    clipPath: `polygon(${origin.x}px ${origin.y - manhattan}px, ${origin.x + manhattan}px ${origin.y}px, ${origin.x}px ${origin.y + manhattan}px, ${origin.x - manhattan}px ${origin.y}px)`,
                  }}
                  transition={{ duration: T, ease }}
                />
                <motion.span
                  className="nav-cover-glow"
                  style={{ left: origin.x, top: origin.y }}
                  initial={{ scale: 0.6, opacity: 0.95 }}
                  animate={{ scale: 3.4, opacity: 0 }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                  aria-hidden="true"
                />
              </>
            )}
            {variant === "wipe" && (
              <>
                <motion.div
                  className="nav-cover-wipe alt"
                  initial={{ x: "-112%" }}
                  animate={{ x: "0%" }}
                  transition={{ duration: T, ease }}
                />
                <motion.div
                  className="nav-cover-wipe"
                  initial={{ x: "-112%" }}
                  animate={{ x: "0%" }}
                  transition={{ duration: T, ease, delay: 0.05 }}
                />
              </>
            )}
            {variant === "shutter" && (
              <>
                <motion.div
                  className="nav-cover-half top"
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: T, ease }}
                />
                <motion.div
                  className="nav-cover-half bottom"
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: T, ease }}
                />
                <motion.span
                  className="nav-cover-line"
                  initial={{ scaleX: 0, opacity: 1 }}
                  animate={{ scaleX: 1, opacity: 0 }}
                  transition={{ duration: T + 0.08, ease: "easeOut" }}
                  aria-hidden="true"
                />
              </>
            )}
            {variant === "blinds" &&
              Array.from({ length: BLIND_COUNT }, (_, i) => (
                <motion.div
                  key={i}
                  className={`nav-cover-blind ${i % 2 ? "alt" : ""}`}
                  style={{
                    left: `${(i * 100) / BLIND_COUNT}%`,
                    width: `${100 / BLIND_COUNT + 0.4}%`,
                    transformOrigin: i % 2 ? "bottom" : "top",
                  }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.2, ease, delay: i * 0.02 }}
                />
              ))}
          </motion.div>
        )}
      </AnimatePresence>
    </CoverCtx.Provider>
  );
}
