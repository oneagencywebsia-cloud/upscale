"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import type { AssetListItem } from "@upscale/shared";
import { durationHuman, groupByDay } from "@/lib/format";
import Viewer from "./Viewer";
import DensityControl from "./DensityControl";
import AddToAlbumSheet from "./AddToAlbumSheet";

interface DayGroup {
  key: string;
  label: string;
  items: AssetListItem[];
}

// px mínimos por celda: 0 = fotos grandes (menos columnas) … 2 = pequeñas (más columnas).
const TILE = [172, 108, 78];
const PAGE = 120;

/** Eco del icono de la app (chevron + barra + punto) para los estados vacíos —
 *  para que "no hay nada que ver todavía" siga sintiéndose Upscale, no un
 *  placeholder genérico. */
function EmptyMark() {
  return (
    <div className="empty-mark" aria-hidden="true">
      <svg width="56" height="56" viewBox="0 0 512 512" fill="none">
        <path d="M150 320 L256 216 L362 320" stroke="url(#eg)" strokeWidth="42" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="150" y="364" width="212" height="24" rx="12" fill="url(#eg2)" />
        <circle cx="374" cy="376" r="12" fill="var(--accent)" />
        <defs>
          <linearGradient id="eg" x1="150" y1="216" x2="362" y2="320" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--accent-2)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
          <linearGradient id="eg2" x1="150" y1="364" x2="362" y2="388" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export default function Gallery({
  groups,
  error,
  initialCursor = null,
  kind,
  fav = false,
  total = 0,
  albumId,
  q,
  camera,
  from,
  to,
  cameras = [],
}: {
  groups: DayGroup[];
  error: string | null;
  /** cursor keyset de la primera página; null = no hay más */
  initialCursor?: string | null;
  kind?: string;
  fav?: boolean;
  /** total real de la biblioteca (no solo lo cargado) */
  total?: number;
  /** dentro de un álbum: pagina /api/albums/:id/assets en vez de /api/assets,
   *  y oculta "Añadir a álbum" (añadir álbumes-dentro-de-álbum no entra aquí). */
  albumId?: string;
  /** búsqueda por nombre de archivo */
  q?: string;
  camera?: string;
  from?: string;
  to?: string;
  /** cámaras distintas para el desplegable (llega ya calculado desde el servidor) */
  cameras?: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [addToAlbumOpen, setAddToAlbumOpen] = useState(false);

  // Al refrescar (router.refresh) llega SOLO la primera página. Se toma como
  // verdad (así se ven altas y bajas) y se conserva todo lo ya paginado que sea
  // más antiguo que ella — si no, el scroll infinito se rebobinaría solo.
  // ¿hemos paginado ya más allá de la primera página? (ver más abajo)
  const paged = useRef(false);
  // Todo/Fotos/Vídeos/Favoritos son LISTAS DISTINTAS: al cambiar de una a otra
  // no se conserva nada de lo paginado antes (si no, quedaban fotos colgando
  // debajo de la lista de "Vídeos" por ser más antiguas que su primera página).
  const filterKey = `${kind ?? ""}|${fav ? 1 : 0}|${q ?? ""}|${camera ?? ""}|${from ?? ""}|${to ?? ""}`;
  const lastFilter = useRef(filterKey);
  useEffect(() => {
    const changed = lastFilter.current !== filterKey;
    lastFilter.current = filterKey;
    if (changed) {
      paged.current = false;
      setAssets(flat);
      setCursor(initialCursor);
      return;
    }
    setAssets((prev) => {
      if (!prev.length) return flat;
      if (!flat.length) return prev;
      const oldest = flat[flat.length - 1]!.capturedAt;
      const seen = new Set(flat.map((a) => a.id));
      const tail = prev.filter((a) => a.capturedAt < oldest && !seen.has(a.id));
      return [...flat, ...tail];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, filterKey]);
  // El refresco automático trae SOLO la primera página, con SU cursor. Si se
  // adoptara tal cual, cada 25 s el scroll infinito se rebobinaría al principio
  // y, estando abajo del todo con 10 páginas cargadas, volvería a pedir esas 10
  // páginas una a una para no añadir nada (dedupe) — decenas de peticiones
  // inútiles a la API en una biblioteca grande. Solo se adopta mientras no se
  // haya paginado (el cambio de filtro lo reinicia arriba).
  useEffect(() => {
    if (paged.current) return;
    setCursor(initialCursor);
  }, [initialCursor]);

  // ---- scroll infinito: la biblioteca puede tener cientos de miles ----
  // Si la API falla, NO se reintenta a lo loco: el observador se vuelve a
  // suscribir cada vez que cambia `loadMore` (y eso pasa en cada intento), así
  // que un error sostenido se convertía en una tanda de peticiones a toda
  // velocidad contra una API que ya está en problemas. Se espera un poco más
  // en cada fallo seguido.
  const backoff = useRef({ until: 0, n: 0 });
  const loadMore = useCallback(async () => {
    if (loadingMore || !cursor) return;
    if (Date.now() < backoff.current.until) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ cursor, limit: String(PAGE) });
      if (kind) params.set("kind", kind);
      if (fav) params.set("fav", "1");
      // los filtros de búsqueda no aplican dentro de un álbum (fuera de alcance)
      if (!albumId) {
        if (q) params.set("q", q);
        if (camera) params.set("camera", camera);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
      }
      const url = albumId ? `/api/albums/${albumId}/assets?${params}` : `/api/assets?${params}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error("no se pudo cargar más");
      const data = (await r.json()) as { items: AssetListItem[]; nextCursor: string | null };
      paged.current = true;
      setAssets((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...(data.items ?? []).filter((a) => !seen.has(a.id))];
      });
      setCursor(data.nextCursor ?? null);
      backoff.current = { until: 0, n: 0 };
    } catch {
      const n = backoff.current.n + 1;
      backoff.current = { n, until: Date.now() + Math.min(60_000, 5_000 * 2 ** (n - 1)) };
      setToast("No se pudieron cargar más archivos. Baja otra vez para reintentar.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, kind, fav, albumId, q, camera, from, to]);

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
    let cool: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (busy || document.hidden || openIdx !== null || selecting) return;
      busy = true;
      router.refresh();
      cool = setTimeout(() => (busy = false), 3000);
    };
    const iv = setInterval(tick, 25_000);
    const onVis = () => !document.hidden && tick();
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      clearTimeout(cool);
      window.removeEventListener("focus", onVis);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router, openIdx, selecting]);

  // índices O(1). TODOS los hooks van aquí arriba, antes de cualquier return.
  // Los días se recalculan desde `assets` (no desde la prop) para que el scroll
  // infinito pueda añadir días nuevos según se van pidiendo páginas.
  const liveGroups = useMemo(() => groupByDay(assets), [assets]);
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
    if (!selecting) {
      endDrag();
      // `didDrag` se traga el siguiente click para que soltar el dedo tras
      // pintar una selección no abra la foto. Si el arrastre acabó fuera de un
      // tile (o se salió del modo selección) ese click nunca llega y la bandera
      // se quedaba puesta: el primer toque siguiente sobre una foto no hacía
      // nada. Al salir de selección se limpia siempre.
      drag.current.didDrag = false;
    }
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

  // el arranque del vídeo se pide ANTES de abrir el visor (así el <video> lo
  // encuentra ya en camino). Se cancela la petición anterior si se abre otro
  // distinto: si no, tocar 10 vídeos seguidos dejaba 10 descargas de 1 MB
  // compitiendo por el ancho de banda con el que sí estás viendo.
  const warm = useRef<AbortController | null>(null);
  useEffect(() => () => warm.current?.abort(), []);
  const openAt = useCallback(
    (idx: number) => {
      const a = assets[idx];
      if (a?.kind === "video") {
        warm.current?.abort();
        const ac = new AbortController();
        warm.current = ac;
        fetch(`/api/media/${a.id}`, { headers: { range: "bytes=0-1048575" }, signal: ac.signal }).catch(() => {});
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

  // ---- búsqueda y filtros: viven en la URL (compartibles, marcables) ----
  // Se conserva cualquier otro parámetro ya en la URL (kind, fav) y solo se
  // toca lo que cambia aquí.
  const updateQuery = useCallback(
    (patch: Record<string, string | undefined>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) sp.set(k, v);
        else sp.delete(k);
      }
      const qs = sp.toString();
      router.push(`/app${qs ? `?${qs}` : ""}`);
    },
    [router, searchParams],
  );

  const [searchOpen, setSearchOpen] = useState(!!q);
  const [searchText, setSearchText] = useState(q ?? "");
  useEffect(() => setSearchText(q ?? ""), [q]);
  // debounce de ~300ms: no se dispara una navegación por cada tecla
  useEffect(() => {
    const current = q ?? "";
    if (searchText === current) return;
    const t = setTimeout(() => updateQuery({ q: searchText.trim() || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  // el input "to" es inclusivo del día elegido; el backend usa `< to`, así que
  // se manda el día SIGUIENTE a las 00:00.
  const toExclusive = useCallback((dateStr: string) => {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }, []);
  // inverso: lo que se enseña en el <input type="date"> del "hasta" es un día
  // menos que lo que se manda al backend.
  const toInclusiveDisplay = useCallback((iso: string) => {
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00.000Z` : iso);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }, []);

  async function del(id: string) {
    setAssets((as) => as.filter((a) => a.id !== id));
    setOpenIdx(null);
    // mismo criterio que bulkDelete: dentro de un álbum esto quita del álbum,
    // no borra el archivo de la biblioteca entera.
    const url = albumId ? `/api/albums/${albumId}/assets/${id}` : `/api/assets/${id}`;
    await fetch(url, { method: "DELETE" });
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
    // Dentro de un álbum, "Borrar" quita SOLO del álbum — las fotos/vídeos
    // siguen en la biblioteca. Antes llamaba siempre a DELETE /api/assets/:id
    // (borrado real, para siempre) sin mirar en qué vista estabas: dentro de
    // un álbum eso significaba borrar la foto de TODA la cuenta por error.
    const msg = albumId
      ? `¿Quitar ${sel.size} elementos de este álbum? Siguen en tu biblioteca.`
      : `Borrar ${sel.size} elementos? Es definitivo.`;
    if (!confirm(msg)) return;
    const ids = [...sel];
    setAssets((as) => as.filter((a) => !sel.has(a.id)));
    setSel(new Set());
    setSelecting(false);
    // De 6 en 6, no las 1.450 a la vez: "Seleccionar todo → Borrar" lanzaba un
    // DELETE por archivo de golpe. El navegador encola, la API recibe cientos
    // de borrados simultáneos (cada uno toca Telegram y Postgres) y lo normal
    // es que empiecen a fallar por timeout — quedando archivos sin borrar.
    const LANES = 6;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(LANES, ids.length) }, async () => {
        while (next < ids.length) {
          const id = ids[next++]!;
          const url = albumId ? `/api/albums/${albumId}/assets/${id}` : `/api/assets/${id}`;
          await fetch(url, { method: "DELETE" }).catch(() => null);
        }
      }),
    );
    router.refresh();
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
  if (!assets.length) {
    return (
      <div className="empty">
        <EmptyMark />
        <h3>Tu biblioteca está vacía</h3>
        <p>Sube desde el iPhone con el botón «Subir» (o con el Atajo, ver Ajustes).</p>
      </div>
    );
  }

  return (
    <>
      <div className="gallery-toolbar">
        <DensityControl value={density} onChange={setDensity} />

        <div className="gt-filters">
          <div className={`gt-search ${searchOpen ? "open" : ""}`}>
            <button
              type="button"
              aria-label="Buscar"
              aria-pressed={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
              </svg>
            </button>
            <input
              type="search"
              placeholder="Buscar por nombre…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onFocus={() => setSearchOpen(true)}
            />
          </div>

          {cameras.length > 0 && (
            <div className="gt-camera">
              <select
                aria-label="Filtrar por cámara"
                value={camera ?? ""}
                onChange={(e) => updateQuery({ camera: e.target.value || undefined })}
              >
                <option value="">Todas las cámaras</option>
                {cameras.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="gt-daterange">
            <input
              type="date"
              aria-label="Desde"
              value={from ? from.slice(0, 10) : ""}
              onChange={(e) => updateQuery({ from: e.target.value || undefined })}
            />
            <span>–</span>
            <input
              type="date"
              aria-label="Hasta"
              value={to ? toInclusiveDisplay(to) : ""}
              onChange={(e) => updateQuery({ to: e.target.value ? toExclusive(e.target.value) : undefined })}
            />
          </div>

          <Link href="/app/mapa" className="gt-mapbtn" aria-label="Ver mapa" title="Ver mapa">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 20l-6 -3v-13l6 3l6 -3l6 3v13l-6 -3l-6 3z" strokeLinejoin="round" />
              <path d="M9 7v13" strokeLinecap="round" />
              <path d="M15 10v13" strokeLinecap="round" />
            </svg>
          </Link>
        </div>

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
            <i className="dg-count">{g.items.length}</i>
            <span className="dg-rule" aria-hidden="true" />
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
                    if (selecting) {
                      toggleSel(a.id);
                      return;
                    }
                    // sin `?? 0`: si por lo que sea el id no estuviera en el
                    // índice, abrir el 0 sería abrir OTRA foto (la más
                    // reciente) — justo el fallo que ya se arregló una vez.
                    const i = idxById.get(a.id);
                    if (i !== undefined) openAt(i);
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
          {!albumId && (
            <button className="btn ghost sm" onClick={() => setAddToAlbumOpen(true)}>
              Añadir a álbum
            </button>
          )}
          <button className="btn ghost sm" onClick={bulkDelete}>
            {albumId ? "Quitar del álbum" : "Borrar"}
          </button>
        </motion.div>
      )}

      {addToAlbumOpen && (
        <AddToAlbumSheet
          assetIds={[...sel]}
          onClose={() => setAddToAlbumOpen(false)}
          onAdded={(albumName) => {
            setAddToAlbumOpen(false);
            setToast(`Añadido a «${albumName}»`);
          }}
        />
      )}

      <Viewer
        assets={assets}
        index={openIdx}
        // el visor también tira de la biblioteca: al acercarse al final de lo
        // cargado pide la página siguiente. Antes, abrir una foto y deslizar
        // se paraba en seco en la número 120 aunque hubiera 1.450.
        onNeedMore={cursor ? loadMore : undefined}
        onClose={() => setOpenIdx(null)}
        onIndex={setOpenIdx}
        onFavorite={favorite}
        onDelete={del}
        inAlbum={!!albumId}
      />
    </>
  );
}
