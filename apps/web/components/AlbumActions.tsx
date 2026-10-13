"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import type { AssetListItem } from "@upscale/shared";

const PAGE = 120;
const CHUNK = 400; // la API admite hasta 500 ids por llamada

type Kind = "" | "photo" | "video";
const KINDS: { key: Kind; label: string }[] = [
  { key: "", label: "Todo" },
  { key: "photo", label: "Fotos" },
  { key: "video", label: "Vídeos" },
];

/** Botón «Añadir fotos» de la cabecera de un álbum: abre el selector de la
 *  biblioteca. Es el camino corto para llenar un álbum sin salir de él. */
export default function AlbumActions({ albumId, albumName }: { albumId: string; albumName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <motion.button type="button" className="btn primary sm" whileTap={{ scale: 0.95 }} onClick={() => setOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Añadir fotos
      </motion.button>
      {open && <AlbumPicker albumId={albumId} albumName={albumName} onClose={() => setOpen(false)} />}
    </>
  );
}

function AlbumPicker({ albumId, albumName, onClose }: { albumId: string; albumName: string; onClose: () => void }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<AssetListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [kind, setKind] = useState<Kind>("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const gen = useRef(0);
  const cursorRef = useRef<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const load = useCallback(
    async (reset: boolean) => {
      if (busy.current) return;
      if (!reset && !cursorRef.current) return;
      busy.current = true;
      const my = gen.current;
      try {
        const params = new URLSearchParams({ limit: String(PAGE) });
        if (!reset && cursorRef.current) params.set("cursor", cursorRef.current);
        if (kind) params.set("kind", kind);
        const r = await fetch(`/api/assets?${params}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as { items?: AssetListItem[]; nextCursor?: string | null };
        if (my !== gen.current) return;
        setItems((prev) => {
          const base = reset ? [] : prev;
          const seen = new Set(base.map((a) => a.id));
          return [...base, ...(data.items ?? []).filter((a) => !seen.has(a.id))];
        });
        cursorRef.current = data.nextCursor ?? null;
        setCursor(cursorRef.current);
        setError(false);
      } catch {
        if (my === gen.current) setError(true);
      } finally {
        busy.current = false;
        if (my === gen.current) setLoaded(true);
      }
    },
    [kind],
  );

  // al cambiar de filtro se empieza una lista nueva (y se descarta lo que llegue tarde)
  useEffect(() => {
    gen.current++;
    busy.current = false;
    cursorRef.current = null;
    setCursor(null);
    setItems([]);
    setLoaded(false);
    void load(true);
  }, [load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver((es) => es[0]?.isIntersecting && void load(false), {
      root: scroller.current,
      rootMargin: "600px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, load, items.length]);

  const toggle = useCallback((id: string) => {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  async function save() {
    if (!sel.size || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const ids = [...sel];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const r = await fetch(`/api/albums/${albumId}/assets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: ids.slice(i, i + CHUNK) }),
        });
        if (!r.ok) throw new Error(String(r.status));
      }
      onClose();
      router.refresh();
    } catch {
      setSaving(false);
      setSaveError("No se pudo añadir. Inténtalo de nuevo (lo ya añadido no se duplica).");
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="pick-backdrop" onPointerDown={onClose}>
      <motion.div
        className="pick"
        role="dialog"
        aria-modal="true"
        aria-label={`Añadir fotos a ${albumName}`}
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="pick-head">
          <div className="pick-title">
            <b>Añadir a «{albumName}»</b>
            <span>Toca para elegir · lo que ya esté en el álbum no se duplica</span>
          </div>
          <button type="button" className="iconbtn" aria-label="Cerrar" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="pick-tools">
          <div className="seg" role="group" aria-label="Qué enseñar">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                aria-pressed={kind === k.key}
                className={kind === k.key ? "on" : ""}
                onClick={() => setKind(k.key)}
              >
                <span className="seg-label">{k.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setSel((s) => (s.size >= items.length && items.length ? new Set() : new Set(items.map((a) => a.id))))}
            disabled={!items.length}
          >
            {sel.size >= items.length && items.length ? "Quitar selección" : "Elegir todo lo cargado"}
          </button>
        </div>

        <div className="pick-scroll" ref={scroller}>
          {!loaded && <p className="atas-msg">Cargando tu biblioteca…</p>}
          {loaded && error && !items.length && (
            <p className="atas-msg atas-error" role="alert">
              No se pudo cargar la biblioteca.{" "}
              <button type="button" className="btn ghost sm" onClick={() => void load(true)}>
                Reintentar
              </button>
            </p>
          )}
          {loaded && !error && !items.length && <p className="atas-msg">No hay nada que enseñar con este filtro.</p>}
          <div className="pick-grid" role="listbox" aria-multiselectable="true">
            {items.map((a) => {
              const on = sel.has(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  aria-label={a.filename}
                  className={`pick-tile ${on ? "on" : ""}`}
                  onClick={() => toggle(a.id)}
                >
                  <img src={a.thumbUrl} alt="" loading="lazy" decoding="async" />
                  {a.kind === "video" && <span className="pick-vid" aria-hidden="true">▶</span>}
                  <span className="pick-mark" aria-hidden="true">{on ? "✓" : ""}</span>
                </button>
              );
            })}
          </div>
          {cursor && (
            <div ref={sentinel} className="gt-more">
              <span className="viewer-spin" aria-hidden="true" />
            </div>
          )}
        </div>

        <footer className="pick-foot">
          {saveError && (
            <span className="atas-error" role="alert">
              {saveError}
            </span>
          )}
          <span className="pick-count">
            {sel.size ? `${sel.size.toLocaleString("es-ES")} elegido${sel.size === 1 ? "" : "s"}` : "Nada elegido"}
          </span>
          <button type="button" className="btn ghost sm" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn primary sm" disabled={!sel.size || saving} onClick={save}>
            {saving ? "Añadiendo…" : sel.size ? `Añadir ${sel.size.toLocaleString("es-ES")}` : "Añadir"}
          </button>
        </footer>
      </motion.div>
    </div>,
    document.body,
  );
}
