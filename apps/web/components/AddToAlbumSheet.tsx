"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { useDialogFocus } from "@/lib/dialog";
import type { Album } from "@upscale/shared";

/**
 * Hoja para añadir una selección a un álbum. Un solo gesto: tocar el álbum.
 *
 *  ┌ cabecera: miniaturas de lo que se añade · «N elementos» · cerrar
 *  ├ buscador (solo si hay muchos álbumes)
 *  └ rejilla: «Nuevo álbum» primero, luego los álbumes con su portada
 *
 * Móvil: sube desde abajo. Escritorio: diálogo centrado. Si algo falla se dice
 * qué y se puede reintentar (antes el toque se deshacía sin explicación).
 */
export default function AddToAlbumSheet({
  assetIds,
  previews = [],
  onClose,
  onAdded,
}: {
  assetIds: string[];
  /** miniaturas de lo que se va a añadir (máx. 3 se enseñan) */
  previews?: string[];
  onClose: () => void;
  onAdded: (album: { id: string; name: string }, added: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const sheet = useDialogFocus<HTMLDivElement>(mounted);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/albums", { cache: "no-store", signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error("fallo");
        return r.json();
      })
      .then((data: { albums?: Album[] }) => setAlbums(data.albums ?? []))
      .catch((e) => {
        if ((e as Error)?.name !== "AbortError") setLoadError(true);
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (albums ?? []).filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [albums, filter]);

  const busy = addingId !== null || doneId !== null;

  async function addTo(album: { id: string; name: string }) {
    if (doneId) return;
    setAddingId(album.id);
    setError(null);
    try {
      const r = await fetch(`/api/albums/${album.id}/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: assetIds }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json().catch(() => ({}))) as { added?: number };
      setDoneId(album.id);
      window.setTimeout(() => onAdded(album, data.added ?? assetIds.length), 520);
    } catch {
      setAddingId(null);
      setError(`No se pudo añadir a «${album.name}». Comprueba la conexión y vuelve a tocarlo.`);
    }
  }

  async function createAndAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setAddingId("__new");
    setError(null);
    let created: { id: string; name: string };
    try {
      const r = await fetch("/api/albums", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) throw new Error(String(r.status));
      created = (await r.json()) as { id: string; name: string };
    } catch {
      setAddingId(null);
      setError("No se pudo crear el álbum. Inténtalo de nuevo.");
      return;
    }
    await addTo(created);
  }

  if (!mounted) return null;

  const n = assetIds.length;
  return createPortal(
    <div className="atas-backdrop" onPointerDown={onClose}>
      <motion.div
        ref={sheet}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Añadir a álbum"
        className="atas-sheet"
        initial={{ y: 48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="atas-grab" aria-hidden="true" />

        <header className="atas-head">
          {previews.length > 0 && (
            <div className="atas-stack" aria-hidden="true">
              {previews.slice(0, 3).map((src, i) => (
                <img key={i} src={src} alt="" style={{ ["--i" as string]: i }} />
              ))}
            </div>
          )}
          <div className="atas-title">
            <b>Añadir a álbum</b>
            <span>
              {n.toLocaleString("es-ES")} elemento{n === 1 ? "" : "s"}
            </span>
          </div>
          <button type="button" className="iconbtn" aria-label="Cerrar" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {albums !== null && albums.length > 6 && (
          <input
            className="atas-search"
            type="search"
            placeholder="Buscar álbum…"
            aria-label="Buscar álbum"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}

        <div className="atas-grid">
          {creating ? (
            <form className="atas-tile atas-new-form" onSubmit={createAndAdd}>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre del álbum"
                maxLength={80}
                aria-label="Nombre del álbum nuevo"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setCreating(false);
                    setName("");
                  }
                }}
              />
              <button type="submit" className="btn primary sm" disabled={!name.trim() || busy}>
                {addingId === "__new" ? "Creando…" : "Crear y añadir"}
              </button>
            </form>
          ) : (
            <motion.button
              type="button"
              className="atas-tile atas-new"
              whileTap={{ scale: 0.96 }}
              disabled={busy}
              onClick={() => setCreating(true)}
            >
              <span className="atas-plus" aria-hidden="true">+</span>
              <b>Nuevo álbum</b>
            </motion.button>
          )}

          {shown.map((a) => (
            <motion.button
              key={a.id}
              type="button"
              className={`atas-tile atas-album ${doneId === a.id ? "done" : ""}`}
              whileTap={{ scale: 0.96 }}
              onClick={() => addTo(a)}
              disabled={busy}
            >
              <span className="atas-cover">
                {a.coverUrl ? <img src={a.coverUrl} alt="" loading="lazy" /> : <span className="atas-cover-empty" aria-hidden="true" />}
                {addingId === a.id && <span className="viewer-spin atas-spin" aria-hidden="true" />}
                {doneId === a.id && (
                  <motion.span
                    className="atas-check"
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 22 }}
                    aria-hidden="true"
                  >
                    ✓
                  </motion.span>
                )}
              </span>
              <b>{a.name}</b>
              <i>
                {a.count.toLocaleString("es-ES")} elemento{a.count === 1 ? "" : "s"}
              </i>
            </motion.button>
          ))}
        </div>

        {loadError && <p className="atas-msg">No se pudieron cargar tus álbumes. Cierra y vuelve a abrir.</p>}
        {!loadError && albums === null && <p className="atas-msg">Cargando álbumes…</p>}
        {!loadError && albums !== null && !albums.length && !creating && (
          <p className="atas-msg">Aún no tienes álbumes: crea el primero con «Nuevo álbum».</p>
        )}
        {!loadError && albums !== null && albums.length > 0 && !shown.length && (
          <p className="atas-msg">Ningún álbum se llama así.</p>
        )}
        {error && (
          <p className="atas-msg atas-error" role="alert">
            {error}
          </p>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
