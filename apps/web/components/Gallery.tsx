"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import type { AssetListItem } from "@upscale/shared";
import { durationHuman, groupByDay } from "@/lib/format";
import Viewer from "./Viewer";
import DensityControl from "./DensityControl";

interface DayGroup {
  key: string;
  label: string;
  items: AssetListItem[];
}

// px mínimos por celda: 0 = fotos grandes (menos columnas) … 2 = pequeñas (más columnas).
const TILE = [172, 108, 78];
const PAGE = 120;

export default function Gallery({
  groups,
  error,
  initialCursor = null,
  kind,
  fav = false,
  total = 0,
}: {
  groups: DayGroup[];
  error: string | null;
  /** cursor keyset de la primera página; null = no hay más */
  initialCursor?: string | null;
  kind?: string;
  fav?: boolean;
  /** total real de la biblioteca (no solo lo cargado) */
  total?: number;
}) {
  const router = useRouter();
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const [assets, setAssets] = useState(flat);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Al refrescar (router.refresh) llega SOLO la primera página. Se toma como
  // verdad (así se ven altas y bajas) y se conserva todo lo ya paginado que sea
  // más antiguo que ella — si no, el scroll infinito se rebobinaría solo.
  useEffect(() => {
    setAssets((prev) => {
      if (!prev.length) return flat;
      if (!flat.length) return prev;
      const oldest = flat[flat.length - 1]!.capturedAt;
      const seen = new Set(flat.map((a) => a.id));
      const tail = prev.filter((a) => a.capturedAt < oldest && !seen.has(a.id));
      return [...flat, ...tail];
    });
  }, [flat]);
  useEffect(() => setCursor(initialCursor), [initialCursor]);

  // ---- scroll infinito: la biblioteca puede tener cientos de miles ----
  const loadMore = useCallback(async () => {
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const q = new URLSearchParams({ cursor, limit: String(PAGE) });
      if (kind) q.set("kind", kind);
      if (fav) q.set("fav", "1");
      const r = await fetch(`/api/assets?${q}`, { cache: "no-store" });
      if (!r.ok) throw new Error("no se pudo cargar más");
      const data = (await r.json()) as { items: AssetListItem[]; nextCursor: string | null };
      setAssets((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...(data.items ?? []).filter((a) => !seen.has(a.id))];
      });
      setCursor(data.nextCursor ?? null);
    } catch {
      setToast("No se pudieron cargar más archivos. Baja otra vez para reintentar.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, kind, fav]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    // 1200 px de margen: la página siguiente ya está cargada cuando el usuario llega
    const io = new IntersectionObserver((es) => es[0]?.isIntersecting && void loadMore(), {
      rootMargin: "1200px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // la biblioteca se refresca sola: al volver a la pestaña y cada 25 s. Así
  // aparecen los archivos que van entrando por Telegram sin recargar a mano.
  useEffect(() => {
    let busy = false;
    const tick = () => {
      if (busy || document.hidden || openIdx !== null || selecting) return;
      busy = true;
      router.refresh();
      setTimeout(() => (busy = false), 3000);
    };
    const iv = setInterval(tick, 25_000);
    const onVis = () => !document.hidden && tick();
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", onVis);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router, openIdx, selecting]);

  // índices O(1). TODOS los hooks van aquí arriba, antes de cualquier return.
  // Los días se recalculan desde `assets` (no desde la prop) para que el scroll
  // infinito pueda añadir días nuevos según se van pidiendo páginas.
  const liveGroups = useMemo(() => groupByDay(assets), [assets]);
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a] as const)), [assets]);
  const idxById = useMemo(() => {
    const m = new Map<string, number>();
    assets.forEach((a, i) => m.set(a.id, i));
    return m;
  }, [assets]);

  // ---- arrastrar para seleccionar (mantener pulsado y deslizar) ----
  const drag = useRef({ armed: false, active: false, startId: "", didDrag: false, x: 0, y: 0, timer: 0 as number });

  const endDrag = useCallback(() => {
    if (drag.current.timer) window.clearTimeout(drag.current.timer);
    drag.current.timer = 0;
    drag.current.armed = false;
    drag.current.active = false;
    document.body.style.overflow = "";
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  }, []);

  const paintAt = useCallback((clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY);
    const id = (el?.closest?.("[data-tile-id]") as HTMLElement | null)?.dataset.tileId;
    if (!id) return;
    setSel((s) => (s.has(id) ? s : new Set(s).add(id)));
  }, []);

  const onTilePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (!selecting || e.pointerType === "mouse") return;
      drag.current.armed = true;
      drag.current.active = false;
      drag.current.didDrag = false;
      drag.current.startId = id;
      drag.current.x = e.clientX;
      drag.current.y = e.clientY;
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
      if (drag.current.timer) window.clearTimeout(drag.current.timer);
      drag.current.timer = window.setTimeout(() => {
        if (!drag.current.armed) return;
        drag.current.active = true;
        drag.current.didDrag = true;
        document.body.style.overflow = "hidden"; // bloquea el scroll mientras se pinta
        setSel((s) => (s.has(id) ? s : new Set(s).add(id)));
      }, 240);
    },
    [selecting, endDrag],
  );

  const onGridPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current.armed) return;
      const dx = Math.abs(e.clientX - drag.current.x);
      const dy = Math.abs(e.clientY - drag.current.y);
      if (!drag.current.active) {
        // se movió antes de activarse el mantener-pulsado → es un scroll normal
        if (dx > 12 || dy > 12) endDrag();
        return;
      }
      e.preventDefault();
      paintAt(e.clientX, e.clientY);
    },
    [endDrag, paintAt],
  );

  useEffect(() => {
    if (!selecting) endDrag();
  }, [selecting, endDrag]);
  useEffect(() => () => endDrag(), [endDrag]);

  // cerrar el menú de tres puntos al tocar fuera / Escape
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const openAt = useCallback(
    (idx: number) => {
      const a = assets[idx];
      if (a?.kind === "video") {
        fetch(`/api/media/${a.id}`, { headers: { range: "bytes=0-1048575" } }).catch(() => {});
      }
      setOpenIdx(idx);
    },
    [assets],
  );

  const toggleSel = useCallback((id: string) => {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  async function favorite(id: string, value: boolean) {
    setAssets((as) => as.map((a) => (a.id === id ? { ...a, isFavorite: value } : a)));
    const r = await fetch(`/api/assets/${id}/favorite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    }).catch(() => null);
    if (!r || !r.ok) setAssets((as) => as.map((a) => (a.id === id ? { ...a, isFavorite: !value } : a)));
  }

  async function del(id: string) {
    setAssets((as) => as.filter((a) => a.id !== id));
    setOpenIdx(null);
    await fetch(`/api/assets/${id}`, { method: "DELETE" });
    router.refresh();
  }

  function downloadZip(ids?: string[]) {
    const qs = ids && ids.length ? `?ids=${ids.join(",")}` : "";
    const url = `/api/dl-all${qs}`;
    // <a target="_blank"> abre Safari (en PWA standalone) y ahí sí sale el gestor
    // de descargas de iOS. El .zip se guarda en Archivos → Descargas.
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setToast(
      ids && ids.length
        ? `Preparando ZIP de ${ids.length}… se guardará en Archivos › Descargas`
        : `Preparando ZIP de ${assets.length}… tarda un rato; se guarda en Archivos › Descargas`,
    );
  }

  async function bulkDelete() {
    if (!confirm(`Borrar ${sel.size} elementos? Es definitivo.`)) return;
    const ids = [...sel];
    setAssets((as) => as.filter((a) => !sel.has(a.id)));
    setSel(new Set());
    setSelecting(false);
    await Promise.allSettled(ids.map((id) => fetch(`/api/assets/${id}`, { method: "DELETE" })));
    router.refresh();
  }

  if (error) {
    return (
      <div className="empty">
        <h3>Sin conexión</h3>
        <p>{error}</p>
      </div>
    );
  }
  if (!assets.length) {
    return (
      <div className="empty">
        <h3>Tu biblioteca está vacía</h3>
        <p>Sube desde el iPhone con el botón «Subir» (o con el Atajo, ver Ajustes).</p>
      </div>
    );
  }

  return (
    <>
      <div className="gallery-toolbar">
        <DensityControl value={density} onChange={setDensity} />
        <div className="gt-actions">
          <button
            className="btn ghost sm"
            onClick={() => {
              setSelecting((v) => !v);
              setSel(new Set());
            }}
          >
            {selecting ? "Dejar de seleccionar" : "Seleccionar"}
          </button>
          <div className="gt-menu" onPointerDown={(e) => e.stopPropagation()}>
            <button
              className="btn ghost sm iconpad"
              aria-label="Más opciones"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
              </svg>
            </button>
            {menuOpen && (
              <div className="gt-dropdown" role="menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    downloadZip();
                  }}
                >
                  Descargar todo ({(total || assets.length).toLocaleString("es-ES")})
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setSelecting(true);
                    setSel(new Set(assets.map((a) => a.id)));
                  }}
                >
                  Seleccionar todo
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {liveGroups.map((g) => (
        <section className="daygroup" key={g.key}>
          <h3>
            <b>{g.label}</b>
          </h3>
          <div
            className="grid"
            role="list"
            style={{ ["--tile" as string]: `${TILE[density]}px`, touchAction: selecting ? "pan-y" : undefined }}
            onPointerMove={onGridPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {g.items.map((a) => {
              const selected = sel.has(a.id);
              return (
                <button
                  key={a.id}
                  data-tile-id={a.id}
                  className="frame tilt tile-in"
                  role="listitem"
                  aria-label={a.filename}
                  aria-current={selected}
                  onPointerDown={(e) => onTilePointerDown(e, a.id)}
                  onClick={() => {
                    if (drag.current.didDrag) {
                      drag.current.didDrag = false;
                      return;
                    }
                    selecting ? toggleSel(a.id) : openAt(idxById.get(a.id) ?? 0);
                  }}
                >
                  <img src={a.thumbUrl} alt={a.filename} loading="lazy" decoding="async" />
                  {a.isFavorite && (
                    <span className="badge fav" aria-hidden="true">
                      ★
                    </span>
                  )}
                  {a.kind === "video" && (
                    <span className="badge vid">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      {durationHuman(a.durationS)}
                    </span>
                  )}
                  {a.isLive && <span className="badge live">LIVE</span>}
                  {selecting && <span className={`selmark ${selected ? "on" : ""}`} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {/* centinela del scroll infinito: al acercarse, pide la página siguiente */}
      {cursor && (
        <div ref={sentinel} className="gt-more">
          <span className="viewer-spin" aria-hidden="true" />
          <small>Cargando más… ({assets.length.toLocaleString("es-ES")}{total ? ` de ${total.toLocaleString("es-ES")}` : ""})</small>
        </div>
      )}

      {toast && (
        <motion.div className="gt-toast" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>
          {toast}
        </motion.div>
      )}

      {selecting && sel.size > 0 && (
        <motion.div className="selbar" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <span>{sel.size} seleccionados</span>
          <button className="btn sm" onClick={() => downloadZip([...sel])}>
            Descargar
          </button>
          <button className="btn ghost sm" onClick={bulkDelete}>
            Borrar
          </button>
        </motion.div>
      )}

      <Viewer
        assets={assets}
        index={openIdx}
        onClose={() => setOpenIdx(null)}
        onIndex={setOpenIdx}
        onFavorite={favorite}
        onDelete={del}
      />
    </>
  );
}
