"use client";

import { useCallback, useEffect, useState } from "react";
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

  const [videoReady, setVideoReady] = useState(false);
  useEffect(() => setVideoReady(false), [a?.id]);

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
                    preload="metadata"
                    onLoadedData={() => setVideoReady(true)}
                    onCanPlay={() => setVideoReady(true)}
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 26 }}
                  />
                  {!videoReady && (
                    <div className="viewer-loading" aria-live="polite">
                      <span className="viewer-spin" aria-hidden="true" />
                      <small>Preparando el vídeo…</small>
                    </div>
                  )}
                </>
              ) : (
                <motion.img
                  key={a.id}
                  layoutId={`ph-${a.id}`}
                  src={a.posterUrl ?? a.thumbUrl}
                  alt={a.filename}
                  draggable={false}
                  whileTap={{ scale: 0.97 }}
                  animate={{ scale: [0.96, 1] }}
                  transition={{ type: "spring", stiffness: 260, damping: 24 }}
                />
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
