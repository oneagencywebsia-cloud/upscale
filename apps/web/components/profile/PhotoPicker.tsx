"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import type { AssetListItem } from "@upscale/shared";

/** Elegir una foto de la biblioteca como avatar. Una sola, un toque. */
export default function PhotoPicker({
  onPick,
  onClose,
}: {
  onPick: (asset: { id: string; thumbUrl: string }) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<AssetListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const busy = useRef(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function load(from: string | null) {
    if (busy.current) return;
    busy.current = true;
    try {
      const params = new URLSearchParams({ kind: "photo", limit: "90" });
      if (from) params.set("cursor", from);
      const r = await fetch(`/api/assets?${params}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as { items?: AssetListItem[]; nextCursor?: string | null };
      setItems((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...(data.items ?? []).filter((a) => !seen.has(a.id))];
      });
      setCursor(data.nextCursor ?? null);
      setState("ok");
    } catch {
      setState("error");
    } finally {
      busy.current = false;
    }
  }
  useEffect(() => {
    void load(null);
  }, []);

  if (!mounted) return null;
  return createPortal(
    <div className="pick-backdrop" onPointerDown={onClose}>
      <motion.div
        className="pick"
        role="dialog"
        aria-modal="true"
        aria-label="Elegir foto de perfil"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="pick-head">
          <div className="pick-title">
            <b>Elige tu foto de perfil</b>
            <span>Se usa una copia ligera; tu original no se toca</span>
          </div>
          <button type="button" className="iconbtn" aria-label="Cerrar" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="pick-scroll">
          {state === "loading" && <p className="atas-msg">Cargando tus fotos…</p>}
          {state === "error" && !items.length && (
            <p className="atas-msg atas-error" role="alert">
              No se pudieron cargar.{" "}
              <button type="button" className="btn ghost sm" onClick={() => void load(null)}>
                Reintentar
              </button>
            </p>
          )}
          {state === "ok" && !items.length && <p className="atas-msg">Aún no tienes fotos en la biblioteca.</p>}
          <div className="pick-grid">
            {items.map((a) => (
              <button
                key={a.id}
                type="button"
                className="pick-tile"
                aria-label={a.filename}
                onClick={() => onPick({ id: a.id, thumbUrl: a.thumbUrl })}
              >
                <img src={a.thumbUrl} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
          {cursor && (
            <div className="gt-more">
              <button type="button" className="btn ghost sm" onClick={() => void load(cursor)}>
                Cargar más
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
