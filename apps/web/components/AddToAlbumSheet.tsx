"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Album } from "@upscale/shared";

/**
 * Hoja pequeña y autocontenida para añadir la selección actual a un álbum.
 * Sin multi-selección de álbumes a propósito (spec): tocar uno añade y ya —
 * si quieren meterla en otro, reabren la hoja.
 */
export default function AddToAlbumSheet({
  assetIds,
  onClose,
  onAdded,
}: {
  assetIds: string[];
  onClose: () => void;
  onAdded: (albumName: string) => void;
}) {
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [creatingBusy, setCreatingBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/albums", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("fallo");
        return r.json();
      })
      .then((data: { albums: Album[] }) => alive && setAlbums(data.albums ?? []))
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addTo(album: { id: string; name: string }) {
    if (addingId || doneId) return;
    setAddingId(album.id);
    try {
      const r = await fetch(`/api/albums/${album.id}/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: assetIds }),
      });
      if (!r.ok) throw new Error("fallo al añadir");
      setDoneId(album.id);
      setTimeout(() => onAdded(album.name), 550);
    } catch {
      setAddingId(null);
    }
  }

  async function createAndAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creatingBusy) return;
    setCreatingBusy(true);
    try {
      const r = await fetch("/api/albums", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) throw new Error("fallo al crear el álbum");
      const created = (await r.json()) as { id: string; name: string };
      await addTo(created);
    } catch {
      setCreatingBusy(false);
    }
  }

  return (
    <div className="atas-backdrop" onPointerDown={onClose}>
      <motion.div
        className="atas-sheet"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="atas-head">
          <b>Añadir a álbum</b>
          <span>{assetIds.length} seleccionado{assetIds.length === 1 ? "" : "s"}</span>
        </div>

        <div className="atas-list">
          {creating ? (
            <form className="atas-new-form" onSubmit={createAndAdd}>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre del álbum"
                maxLength={80}
              />
              <button type="submit" className="btn primary sm" disabled={!name.trim() || creatingBusy}>
                Crear y añadir
              </button>
            </form>
          ) : (
            <motion.button type="button" className="atas-row atas-new" whileTap={{ scale: 0.97 }} onClick={() => setCreating(true)}>
              <span className="atas-row-plus" aria-hidden="true">+</span>
              Nuevo álbum
            </motion.button>
          )}

          {loadError && <p className="atas-empty">No se pudieron cargar tus álbumes.</p>}
          {!loadError && albums === null && <p className="atas-empty">Cargando…</p>}
          {!loadError && albums !== null && !albums.length && !creating && (
            <p className="atas-empty">Aún no tienes álbumes — crea el primero arriba.</p>
          )}

          {albums?.map((a) => (
            <motion.button
              key={a.id}
              type="button"
              className="atas-row"
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
              onClick={() => addTo(a)}
              disabled={addingId !== null || doneId !== null}
            >
              {a.coverUrl ? <img src={a.coverUrl} alt="" className="atas-thumb" /> : <span className="atas-thumb atas-thumb-empty" aria-hidden="true" />}
              <span className="atas-row-meta">
                <b>{a.name}</b>
                <i>{a.count.toLocaleString("es-ES")} elemento{a.count === 1 ? "" : "s"}</i>
              </span>
              <AnimatePresence>
                {doneId === a.id && (
                  <motion.span
                    className="atas-check"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    aria-hidden="true"
                  >
                    ✓
                  </motion.span>
                )}
                {addingId === a.id && doneId !== a.id && <motion.span className="viewer-spin atas-spin" aria-hidden="true" />}
              </AnimatePresence>
            </motion.button>
          ))}
        </div>

        <button type="button" className="btn ghost sm atas-close" onClick={onClose}>
          Cerrar
        </button>
      </motion.div>
    </div>
  );
}
