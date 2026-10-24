"use client";

import { useEffect, useState } from "react";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const IOS_CLAVE = "upscale-ios-install";

/** iPhone/iPad en el navegador (no instalada). Safari no tiene botón de instalar: hay que explicarlo. */
function iosSinInstalar(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalada = (navigator as { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return ios && !instalada;
}

/**
 * Instalar Upscale como app.
 * - Android y escritorio: botón nativo (`beforeinstallprompt`).
 * - iPhone/iPad: no existe ese botón; a partir de la segunda visita se enseña cómo (una vez cada 30 días si se cierra).
 */
export default function InstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    try {
      if (!iosSinInstalar()) return;
      const g = JSON.parse(localStorage.getItem(IOS_CLAVE) ?? "{}") as { visitas?: number; hasta?: number };
      const visitas = (g.visitas ?? 0) + 1;
      localStorage.setItem(IOS_CLAVE, JSON.stringify({ ...g, visitas }));
      if (visitas >= 2 && (g.hasta ?? 0) < Date.now()) {
        const t = window.setTimeout(() => setIos(true), 4000);
        return () => window.clearTimeout(t);
      }
    } catch {
      /* sin almacenamiento: no se molesta */
    }
  }, []);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    const onInstalled = () => setEvt(null);
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      // se quedaba enganchado: con el Strict Mode de React se registraba dos
      // veces y en cada navegación se acumulaba otro más.
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (ios && !hidden && !evt)
    return (
      <div className="install-toast ios" role="status">
        <span>
          Instala Upscale: toca{" "}
          <svg className="ios-share" width="16" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Compartir">
            <path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
          </svg>{" "}
          y luego <b>Añadir a pantalla de inicio</b>.
        </span>
        <button
          className="install-x"
          type="button"
          aria-label="Cerrar"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(IOS_CLAVE, JSON.stringify({ visitas: 99, hasta: Date.now() + 30 * 24 * 3600_000 }));
            } catch {
              /* nada */
            }
          }}
        >
          ×
        </button>
      </div>
    );

  if (!evt || hidden) return null;

  return (
    <div className="install-toast">
      <span>Instala Upscale como app</span>
      <button
        className="btn primary sm"
        type="button"
        onClick={async () => {
          await evt.prompt();
          await evt.userChoice;
          setEvt(null);
        }}
      >
        Instalar
      </button>
      <button className="install-x" type="button" aria-label="Cerrar" onClick={() => setHidden(true)}>
        ×
      </button>
    </div>
  );
}
