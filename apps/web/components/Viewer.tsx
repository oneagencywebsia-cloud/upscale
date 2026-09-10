"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { AssetListItem } from "@upscale/shared";
import { specRows } from "@/lib/format";

interface Props {
  assets: AssetListItem[];
  index: number | null;
  onClose: () => void;
  onIndex: (i: number) => void;
  onFavorite: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
}

export default function Viewer({ assets, index, onClose, onIndex, onFavorite, onDelete }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const open = index !== null;
  const a = open ? assets[index] : null;

  const [videoState, setVideoState] = useState<"loading" | "ready" | "error" | "slow">("loading");
  const [buffering, setBuffering] = useState(false);
  const [livePlaying, setLivePlaying] = useState(false);
  const liveRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    setVideoState("loading");
    setBuffering(false);
    setLivePlaying(false);
    if (!a || a.kind !== "video") return;
    const t = setTimeout(() => setVideoState((s) => (s === "loading" ? "slow" : s)), 20000);
    return () => clearTimeout(t);
  }, [a?.id, a?.kind]);

  // Mientras miras uno, se va pidiendo el arranque del siguiente y el anterior:
  // al pasar de uno a otro ya está en camino y la apertura se siente inmediata.
  useEffect(() => {
    if (index === null) return;
    const t = setTimeout(() => {
      for (const n of [index + 1, index - 1]) {
        const v = assets[n];
        if (!v) continue;
        if (v.kind === "video") {
          void fetch(`/api/media/${v.id}`, { headers: { Range: "bytes=0-524287" } }).catch(() => {});
        } else if (v.posterUrl) {
          const img = new Image();
          img.src = v.posterUrl;
        }
      }
    }, 400); // sin robarle ancho de banda al que estás viendo ahora
    return () => clearTimeout(t);
  }, [index, assets]);

  const isLive = !!(a && a.kind === "photo" && a.isLive && a.liveVideoUrl);
  const liveStart = useCallback(() => {
    const v = liveRef.current;
    if (!v) return;
    setLivePlaying(true);
    v.currentTime = 0;
    void v.play().catch(() => setLivePlaying(false));
  }, []);
  const liveStop = useCallback(() => {
    const v = liveRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
    setLivePlaying(false);
  }, []);

  const go = useCallback(
    (d: number) => {
      if (index === null) return;
      const n = index + d;
      if (n >= 0 && n < assets.length) onIndex(n);
    },
    [index, assets.length, onIndex],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, go, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && a && (
        <motion.div
          className="viewer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={onClose}
        >
          <motion.div
            className="viewer-stage"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="viewer-media">
              {a.kind === "video" ? (
                <>
                  <motion.video
                    key={a.id}
                    src={`/api/media/${a.id}`}
                    poster={a.posterUrl ?? a.thumbUrl}
                    controls
                    autoPlay
                    playsInline
                    preload="auto"
                    onLoadedData={() => setVideoState("ready")}
                    onCanPlay={() => { setVideoState("ready"); setBuffering(false); }}
                    onPlaying={() => { setVideoState("ready"); setBuffering(false); }}
                    onWaiting={() => setBuffering(true)}
                    onStalled={() => setBuffering(true)}
                    onError={() => setVideoState("error")}
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 26 }}
                  />
                  {videoState === "ready" && buffering && (
                    <div className="viewer-buffering" aria-hidden="true">
                      <span className="viewer-spin" />
                    </div>
                  )}
                  {videoState !== "ready" && (
                    <div className="viewer-loading" aria-live="polite">
                      {videoState === "error" ? (
                        <>
                          <small>No se pudo reproducir aquí.</small>
                          <a className="btn primary sm" href={`/api/dl/${a.id}`}>Descargar</a>
                        </>
                      ) : videoState === "slow" ? (
                        <>
                          <span className="viewer-spin" aria-hidden="true" />
                          <small>Está tardando en cargar…</small>
                          <a className="btn sm" href={`/api/dl/${a.id}`}>Descargar</a>
                        </>
                      ) : (
                        <>
                          <span className="viewer-spin" aria-hidden="true" />
                          <small>Preparando el vídeo…</small>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div
                  className="viewer-photo"
                  onPointerDown={isLive ? liveStart : undefined}
                  onPointerUp={isLive ? liveStop : undefined}
                  onPointerLeave={isLive ? liveStop : undefined}
                  onContextMenu={isLive ? (e) => e.preventDefault() : undefined}
                >
                  <motion.img
                    key={a.id}
                    src={a.posterUrl ?? a.thumbUrl}
                    alt={a.filename}
                    draggable={false}
                    whileTap={isLive ? undefined : { scale: 0.97 }}
                    animate={{ scale: [0.96, 1] }}
                    transition={{ type: "spring", stiffness: 260, damping: 24 }}
                  />
                  {isLive && (
                    <>
                      <video
                        ref={liveRef}
                        src={a.liveVideoUrl!}
                        className={`viewer-live ${livePlaying ? "on" : ""}`}
                        playsInline
                        preload="metadata"
                        onEnded={liveStop}
                      />
                      <span className="badge live viewer-livebadge" aria-hidden="true">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                          <circle cx="12" cy="12" r="3.2" />
                          <path d="M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" />
                        </svg>
                        LIVE
                      </span>
                    </>
                  )}
                </div>
              )}
              {assets.length > 1 && (
                <>
                  <button className="viewer-nav prev" onClick={() => go(-1)} disabled={index === 0} aria-label="Anterior">‹</button>
                  <button className="viewer-nav next" onClick={() => go(1)} disabled={index === assets.length - 1} aria-label="Siguiente">›</button>
                </>
              )}
            </div>

            <div className="viewer-panel">
              <div className="viewer-head">
                <h3>{a.filename}</h3>
                <button className="iconbtn" onClick={onClose} aria-label="Cerrar">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>

              <div className="integ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
                <div>Original íntegro<small>SHA-256 {a.sha256.slice(0, 16)}… · sin recompresión</small></div>
              </div>

              <dl className="specs">
                {specRows(a).map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>

              <div className="viewer-actions">
                <button
                  className={`btn ${a.isFavorite ? "primary" : ""}`}
                  onClick={() => onFavorite(a.id, !a.isFavorite)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill={a.isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M12 17.3 6.2 20l1.1-6.3L2.5 9.2l6.4-.9L12 2.5l3.1 5.8 6.4.9-4.8 4.5L17.8 20z" /></svg>
                  {a.isFavorite ? "Favorito" : "Favorito"}
                </button>
                <a className="btn primary" href={`/api/dl/${a.id}`}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14m0 0 6-6m-6 6-6-6" /></svg>
                  Descargar
                </a>
              </div>
              <div className="viewer-actions">
                {a.liveVideoUrl && <a className="btn" href={a.liveVideoUrl}>Vídeo Live</a>}
                <button
                  className="btn ghost"
                  onClick={() => {
                    if (confirm(`Borrar ${a.filename}? Es definitivo.`)) onDelete(a.id);
                  }}
                >
                  Borrar
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
