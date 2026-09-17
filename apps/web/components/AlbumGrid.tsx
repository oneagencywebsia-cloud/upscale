"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import type { Album } from "@upscale/shared";

/** Eco del icono de la app — mismo lenguaje visual que el EmptyMark de
 *  Gallery.tsx, para que "aún no tienes álbumes" siga sintiéndose Upscale. */
function EmptyMark() {
  return (
    <div className="empty-mark" aria-hidden="true">
      <svg width="56" height="56" viewBox="0 0 512 512" fill="none">
        <path d="M150 320 L256 216 L362 320" stroke="url(#ag)" strokeWidth="42" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="150" y="364" width="212" height="24" rx="12" fill="url(#ag2)" />
        <circle cx="374" cy="376" r="12" fill="var(--accent)" />
        <defs>
          <linearGradient id="ag" x1="150" y1="216" x2="362" y2="320" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--accent-2)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
          <linearGradient id="ag2" x1="150" y1="364" x2="362" y2="388" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export default function AlbumGrid({ initialAlbums, error }: { initialAlbums: Album[]; error: string | null }) {
  const router = useRouter();
  const [albums, setAlbums] = useState(initialAlbums);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  async function renameAlbum(id: string) {
    const trimmed = renameText.trim();
    if (!trimmed) return;
    setAlbums((as) => as.map((a) => (a.id === id ? { ...a, name: trimmed } : a))); // optimista
    setRenaming(null);
    const r = await fetch(`/api/albums/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => null);
    if (!r || !r.ok) router.refresh(); // deshace si falló, trayendo el nombre real
  }

  // cerrar el menú de tres puntos al tocar fuera / Escape — mismo patrón que
  // el menú de la barra de la galería.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuFor(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  async function deleteAlbum(id: string, name: string) {
    if (!confirm(`¿Borrar el álbum «${name}»? Las fotos y vídeos NO se borran, solo dejan de estar agrupados aquí.`)) return;
    setMenuFor(null);
    setAlbums((as) => as.filter((a) => a.id !== id));
    await fetch(`/api/albums/${id}`, { method: "DELETE" }).catch(() => null);
  }

  async function createAlbum(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/albums", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) throw new Error("fallo al crear el álbum");
      const created = (await r.json()) as { id: string; name: string; createdAt: string };
      setAlbums((as) => [{ id: created.id, name: created.name, createdAt: created.createdAt, count: 0, coverUrl: null }, ...as]);
      setName("");
      setCreating(false);
      router.refresh();
    } catch {
      /* se deja el formulario abierto con lo escrito para reintentar */
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="empty">
        <EmptyMark />
        <h3>Sin conexión</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="albums-grid">
      <div className="album-card album-new">
        {creating ? (
          <form onSubmit={createAlbum} className="album-new-form">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del álbum"
              maxLength={80}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(false);
                  setName("");
                }
              }}
            />
            <div className="album-new-actions">
              <button type="submit" className="btn primary sm" disabled={!name.trim() || busy}>
                Crear
              </button>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setCreating(false);
                  setName("");
                }}
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <motion.button
            type="button"
            className="album-new-btn"
            whileTap={{ scale: 0.94 }}
            onClick={() => setCreating(true)}
          >
            <span className="album-new-plus" aria-hidden="true">+</span>
            Nuevo álbum
          </motion.button>
        )}
      </div>

      {albums.map((a) =>
        renaming === a.id ? (
          <div key={a.id} className="album-card album-new">
            <form
              className="album-new-form"
              onSubmit={(e) => {
                e.preventDefault();
                void renameAlbum(a.id);
              }}
            >
              <input
                autoFocus
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                maxLength={80}
                onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
              />
              <div className="album-new-actions">
                <button type="submit" className="btn primary sm" disabled={!renameText.trim()}>
                  Guardar
                </button>
                <button type="button" className="btn ghost sm" onClick={() => setRenaming(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div key={a.id} className="album-card-wrap">
            <Link href={`/app/albumes/${a.id}`} className="album-card">
              <div className="album-cover">
                {a.coverUrl ? <img src={a.coverUrl} alt="" loading="lazy" /> : <div className="album-cover-empty" aria-hidden="true" />}
              </div>
              <div className="album-meta">
                <b>{a.name}</b>
                <span>{a.count.toLocaleString("es-ES")} elemento{a.count === 1 ? "" : "s"}</span>
              </div>
            </Link>
            <div className="album-menu" onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="album-menu-btn"
                aria-label="Opciones del álbum"
                aria-expanded={menuFor === a.id}
                onClick={(e) => {
                  e.preventDefault();
                  setMenuFor((v) => (v === a.id ? null : a.id));
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                </svg>
              </button>
              {menuFor === a.id && (
                <div className="gt-dropdown album-dropdown" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuFor(null);
                      setRenameText(a.name);
                      setRenaming(a.id);
                    }}
                  >
                    Cambiar nombre
                  </button>
                  <button role="menuitem" onClick={() => deleteAlbum(a.id, a.name)}>
                    Borrar álbum
                  </button>
                </div>
              )}
            </div>
          </div>
        ),
      )}

      {!albums.length && !creating && (
        <div className="empty album-empty">
          <EmptyMark />
          <h3>Aún no tienes álbumes</h3>
          <p>crea el primero con «+ Nuevo álbum»</p>
        </div>
      )}
    </div>
  );
}
