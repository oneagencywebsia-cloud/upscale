"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Marco de fotos: el widget a pantalla completa, cambiando cada pocos segundos, con la
 * pantalla siempre encendida (Wake Lock) y, si se quiere, la hora. Dos capas de imagen
 * que se funden (solo `opacity`); un toque muestra u oculta la hora; doble toque, pantalla completa.
 */
export default function MarcoFotos({ token, segundos, reloj }: { token: string; segundos: number; reloj: boolean }) {
  const [capas, setCapas] = useState<[string | null, string | null]>([null, null]);
  const [activa, setActiva] = useState<0 | 1>(0);
  const [error, setError] = useState(false);
  const [hora, setHora] = useState("");
  const [verHora, setVerHora] = useState(reloj);
  const pedido = useRef(0);
  const activaRef = useRef<0 | 1>(0);

  useEffect(() => {
    if (!token) return setError(true);
    let vivo = true;
    const cargar = () => {
      const w = Math.min(2800, Math.round((window.innerWidth * (window.devicePixelRatio || 1)) / 100) * 100 || 1200);
      const h = Math.min(2800, Math.round((window.innerHeight * (window.devicePixelRatio || 1)) / 100) * 100 || 800);
      const url = `/_api/v1/w/${token}.jpg?w=${w}&h=${h}&rot=vez&t=${Date.now()}-${pedido.current++}`;
      const img = new Image();
      img.onload = () => {
        if (!vivo) return;
        const siguiente = (activaRef.current === 0 ? 1 : 0) as 0 | 1;
        setCapas((c) => (siguiente === 0 ? [url, c[1]] : [c[0], url]));
        // un instante para que el navegador pinte la capa antes de fundirla
        requestAnimationFrame(() => {
          activaRef.current = siguiente;
          setActiva(siguiente);
        });
        setError(false);
      };
      img.onerror = () => vivo && setError(true);
      img.src = url;
    };
    cargar();
    const t = window.setInterval(cargar, segundos * 1000);
    return () => {
      vivo = false;
      window.clearInterval(t);
    };
  }, [token, segundos]);

  // pantalla encendida
  useEffect(() => {
    let candado: { release: () => Promise<void> } | null = null;
    const pedir = async () => {
      try {
        candado = await (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null;
      } catch {
        /* no disponible: la pantalla se apagará según el aparato */
      }
    };
    void pedir();
    const vis = () => document.visibilityState === "visible" && void pedir();
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      void candado?.release().catch(() => {});
    };
  }, []);

  // hora
  useEffect(() => {
    const act = () => setHora(new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }));
    act();
    const t = window.setInterval(act, 15_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <main
      className="marco"
      onClick={() => setVerHora((v) => !v)}
      onDoubleClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen?.().catch(() => {}))}
      aria-label="Marco de fotos"
    >
      {capas.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        src && <img key={i} src={src} alt="" className={`marco-img${activa === i ? " on" : ""}`} />
      ))}
      {verHora && hora && <time className="marco-hora">{hora}</time>}
      {error && !capas[0] && !capas[1] && <p className="marco-error" role="alert">No se pudo cargar. Mira que el enlace esté bien y que siga existiendo.</p>}
    </main>
  );
}
