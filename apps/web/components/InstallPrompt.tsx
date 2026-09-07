"use client";

import { useEffect, useState } from "react";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Botón para instalar Upscale como PWA (aparece solo si el navegador lo permite). */
export default function InstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", () => setEvt(null));
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

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
