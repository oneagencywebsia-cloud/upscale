"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import type { AssetListItem } from "@upscale/shared";
import { durationHuman, groupByDay } from "@/lib/format";
import DensityControl from "./DensityControl";
import {
  descargarUno,
  descargarZip,
  EVENTO_FORMATO,
  formatoCompatible,
  guardarFormatoCompatible,
  UMBRAL_DIRECTO,
  type FuenteZip,
} from "@/lib/download";
import Mark3D from "./Mark3D";
import Thumb from "./Thumb";

interface DayGroup {
  key: string;
  label: string;
  items: AssetListItem[];
}

// px mínimos por celda: 0 = fotos grandes (menos columnas) … 2 = pequeñas (más columnas).
const TILE = [172, 108, 78];
// El visor y las hojas de descarga / álbum pesan bastante y solo se usan al tocar:
// van en trozos aparte (la galería carga antes) y se precargan cuando el navegador
// está ocioso, así que al abrirlos ya están descargados.
const Viewer = dynamic(() => import("./Viewer"), { ssr: false });
const AddToAlbumSheet = dynamic(() => import("./AddToAlbumSheet"), { ssr: false });
const DownloadSheet = dynamic(() => import("./DownloadSheet"), { ssr: false });
function precargarHojas() {
  void import("./Viewer");
  void import("./AddToAlbumSheet");
  void import("./DownloadSheet");
}

const PAGE = 120;

/** Estado vacío: el símbolo de la marca, para que "no hay nada todavía" siga
 *  sintiéndose Upscale y no un placeholder genérico. */
function EmptyMark() {
  return (
    <div className="empty-mark" aria-hidden="true">
      <Mark3D size={104} />
    </div>
  );
}

/** Primera página fresca + lo ya paginado que sea más antiguo que ella. Se toma
 *  la primera página como verdad (así se ven altas y bajas) y se conserva el
 *  resto — si no, el scroll infinito se rebobinaría solo. */
function mergeFirstPage(
  prev: AssetListItem[],
  first: AssetListItem[],
  by: "capturedAt" | "uploadedAt" = "capturedAt",
): AssetListItem[] {
  if (!prev.length) return first;
  if (!first.length) return prev;
  const oldest = first[first.length - 1]![by];
  const seen = new Set(first.map((a) => a.id));
  const tail = prev.filter((a) => a[by] < oldest && !seen.has(a.id));
  return [...first, ...tail];
}

/** Huella barata de una lista (orden + favoritos) para saber si algo cambió. */
const sigOf = (xs: AssetListItem[]) => xs.map((a) => (a.isFavorite ? `${a.id}*` : a.id)).join("|");

interface TileProps {
  a: AssetListItem;
  selected: boolean;
  selecting: boolean;
  onDown: (e: React.PointerEvent, id: string) => void;
  onActivate: (id: string) => void;
}

/** Una celda de la rejilla. `memo` + manejadores estables: seleccionar una foto,
 *  abrir el visor o cargar otra página ya NO re-renderiza las miles de celdas
 *  de la biblioteca, solo la que cambia. */
const Tile = memo(function Tile({ a, selected, selecting, onDown, onActivate }: TileProps) {
  return (
    <button
      data-tile-id={a.id}
      className="frame tilt tile-in"
      aria-label={a.filename}
      aria-current={selected}
      onPointerDown={(e) => onDown(e, a.id)}
      onClick={() => onActivate(a.id)}
    >
      <Thumb src={a.thumbUrl} />
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
      {a.kind === "audio" && (
        <span className="badge vid aud">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {durationHuman(a.durationS)}
        </span>
      )}
      {a.isLive && <span className="badge live">LIVE</span>}
      {selecting && <span className={`selmark ${selected ? "on" : ""}`} aria-hidden="true" />}
    </button>
  );
});

export default function Gallery({
  groups,
  error,
  initialCursor = null,
  kind,
  fav = false,
  sort,
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
  /** "added" = vista «Nuevos»: ordenada y agrupada por fecha de subida */
  sort?: string;
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
  // siempre la última lista, para manejadores estables que no se recrean con ella
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  // el visor se monta la primera vez que se abre y ya no se desmonta (así conserva su animación de salida)
  const viewerUsado = useRef(false);
  if (openIdx !== null) viewerUsado.current = true;
  useEffect(() => {
    const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(precargarHojas, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(precargarHojas, 2500);
    return () => clearTimeout(t);
  }, []);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [density, setDensityState] = useState(1);
  // tamaño elegido en Perfil → Preferencias (por dispositivo); se lee tras montar
  // para que el HTML del servidor y el del navegador coincidan.
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem("upscale-density"));
      if (v === 0 || v === 1 || v === 2) setDensityState(v);
    } catch {
      /* sin almacenamiento: se queda en medio */
    }
  }, []);
  const setDensity = useCallback((i: number) => {
    setDensityState(i);
    try {
      localStorage.setItem("upscale-density", String(i));
    } catch {
      /* modo privado */
    }
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // La barra de herramientas (donde está «Seleccionar») NO es fija: al bajar se
  // pierde de vista. Se observa para sacar un botón flotante cuando eso pasa.
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const [toolbarInView, setToolbarInView] = useState(true);
  useEffect(() => {
    if (!toolbarEl) return;
    // -90px arriba: la barra superior fija tapa esa franja, así que «a la vista»
    // es lo que queda por debajo de ella.
    const io = new IntersectionObserver((es) => setToolbarInView(!!es[0]?.isIntersecting), {
      rootMargin: "-90px 0px 0px 0px",
    });
    io.observe(toolbarEl);
    return () => io.disconnect();
  }, [toolbarEl]);
  // acción opcional dentro del aviso («Ver álbum»)
  const [toastLink, setToastLink] = useState<{ href: string; label: string } | null>(null);
  // ids que se están añadiendo a un álbum (selección múltiple o una sola foto desde el visor)
  const [addIds, setAddIds] = useState<string[] | null>(null);

  // Al refrescar (router.refresh) llega SOLO la primera página. Se toma como
  // verdad (así se ven altas y bajas) y se conserva todo lo ya paginado que sea
  // más antiguo que ella — si no, el scroll infinito se rebobinaría solo.
  // ¿hemos paginado ya más allá de la primera página? (ver más abajo)
  const paged = useRef(false);
  // Todo/Fotos/Vídeos/Favoritos son LISTAS DISTINTAS: al cambiar de una a otra
  // no se conserva nada de lo paginado antes (si no, quedaban fotos colgando
  // debajo de la lista de "Vídeos" por ser más antiguas que su primera página).
  const orderBy = sort === "added" ? "uploadedAt" : "capturedAt";
  const filterKey = `${kind ?? ""}|${fav ? 1 : 0}|${sort ?? ""}|${q ?? ""}|${camera ?? ""}|${from ?? ""}|${to ?? ""}`;
  const lastFilter = useRef(filterKey);
  // generación del filtro actual: una página pedida para el filtro ANTERIOR que
  // llega tarde se descarta (antes se añadía debajo de la lista nueva y
  // mezclaba fotos de "Todo" dentro de "Vídeos").
  const gen = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const backoff = useRef({ until: 0, n: 0 });
  useEffect(() => {
    const changed = lastFilter.current !== filterKey;
    lastFilter.current = filterKey;
    if (changed) {
      gen.current++;
      inflight.current?.abort();
      inflight.current = null;
      loadingRef.current = false;
      window.clearTimeout(retryTimer.current);
      backoff.current = { until: 0, n: 0 };
      paged.current = false;
      setSel(new Set());
      setAssets(flat);
      setCursor(initialCursor);
      return;
    }
    setAssets((prev) => mergeFirstPage(prev, flat, orderBy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, filterKey]);
  // Solo se adopta el cursor de la primera página mientras no se haya paginado
  // (si no, el scroll infinito se rebobinaría al principio en cada refresco).
  useEffect(() => {
    if (paged.current) return;
    setCursor(initialCursor);
  }, [initialCursor]);

  // ---- scroll infinito: la biblioteca puede tener cientos de miles ----
  // Si la API falla, NO se reintenta a lo loco: se espera más en cada fallo
  // seguido (5 s, 10 s, 20 s… hasta 60 s) y se reintenta sola, sin obligar a
  // subir y bajar el scroll.
  const loadMoreRef = useRef<() => Promise<void>>(async () => {});
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !cursor) return;
    if (Date.now() < backoff.current.until) return;
    loadingRef.current = true;
    const myGen = gen.current;
    const ac = new AbortController();
    inflight.current = ac;
    try {
      const params = new URLSearchParams({ cursor, limit: String(PAGE) });
      if (kind) params.set("kind", kind);
      if (fav) params.set("fav", "1");
      if (sort) params.set("sort", sort);
      // los filtros de búsqueda no aplican dentro de un álbum (fuera de alcance)
      if (!albumId) {
        if (q) params.set("q", q);
        if (camera) params.set("camera", camera);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
      }
      const url = albumId ? `/api/albums/${albumId}/assets?${params}` : `/api/assets?${params}`;
      const r = await fetch(url, { cache: "no-store", signal: ac.signal });
      if (!r.ok) throw new Error("no se pudo cargar más");
      const data = (await r.json()) as { items: AssetListItem[]; nextCursor: string | null };
      if (myGen !== gen.current) return; // llegó tarde: ya es otra lista
      paged.current = true;
      setAssets((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...(data.items ?? []).filter((a) => !seen.has(a.id))];
      });
      setCursor(data.nextCursor ?? null);
      backoff.current = { until: 0, n: 0 };
    } catch (e) {
      if (myGen !== gen.current || (e as Error)?.name === "AbortError") return;
      const n = backoff.current.n + 1;
      const wait = Math.min(60_000, 5_000 * 2 ** (n - 1));
      backoff.current = { n, until: Date.now() + wait };
      setToast("No se pudieron cargar más archivos. Reintentando…");
      window.clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => void loadMoreRef.current(), wait + 50);
    } finally {
      if (myGen === gen.current) loadingRef.current = false;
      if (inflight.current === ac) inflight.current = null;
    }
  }, [cursor, kind, fav, sort, albumId, q, camera, from, to]);
  loadMoreRef.current = loadMore;
  useEffect(
    () => () => {
      inflight.current?.abort();
      window.clearTimeout(retryTimer.current);
    },
    [],
  );

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
    const t = setTimeout(() => {
      setToast(null);
      setToastLink(null);
    }, toastLink ? 8000 : 6000);
    return () => clearTimeout(t);
  }, [toast, toastLink]);

  // La biblioteca se pone al día sola (archivos que entran por Telegram, subidas
  // desde otro dispositivo), pero SIN el `router.refresh()` de antes cada 25 s:
  // eso volvía a pedir al servidor la página entera (usuario, cámaras, totales,
  // 120 archivos) y re-renderizaba todas las celdas aunque no hubiera nada
  // nuevo — los tirones periódicos. Ahora se pide solo la primera página (una
  // petición ligera) y SOLO si algo ha cambiado se refresca la pantalla.
  const polling = useRef(false);
  const lastPoll = useRef(0);
  useEffect(() => {
    if (albumId) return;
    const ac = new AbortController();
    const poll = async () => {
      if (polling.current || document.hidden || openIdx !== null || selecting) return;
      if (Date.now() - lastPoll.current < 10_000) return;
      polling.current = true;
      lastPoll.current = Date.now();
      try {
        const params = new URLSearchParams({ limit: String(PAGE) });
        if (kind) params.set("kind", kind);
        if (fav) params.set("fav", "1");
        if (sort) params.set("sort", sort);
        if (q) params.set("q", q);
        if (camera) params.set("camera", camera);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const r = await fetch(`/api/assets?${params}`, { cache: "no-store", signal: ac.signal });
        if (!r.ok) return;
        const data = (await r.json()) as { items?: AssetListItem[] };
        const first = data.items ?? [];
        if (!first.length) return;
        if (sigOf(first) !== sigOf(assetsRef.current.slice(0, first.length))) router.refresh();
      } catch {
        /* sin red o cancelado: se reintenta en el siguiente ciclo */
      } finally {
        polling.current = false;
      }
    };
    const iv = setInterval(poll, 30_000);
    const onVis = () => !document.hidden && void poll();
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      ac.abort();
      window.removeEventListener("focus", onVis);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router, albumId, kind, fav, sort, q, camera, from, to, openIdx, selecting]);

  // índices O(1). TODOS los hooks van aquí arriba, antes de cualquier return.
  // Los días se recalculan desde `assets` (no desde la prop) para que el scroll
  // infinito pueda añadir días nuevos según se van pidiendo páginas.
  const liveGroups = useMemo(() => groupByDay(assets, orderBy), [assets, orderBy]);
  const idxById = useMemo(() => {
    const m = new Map<string, number>();
    assets.forEach((a, i) => m.set(a.id, i));
    return m;
  }, [assets]);
  const idxRef = useRef(idxById);
  idxRef.current = idxById;
  const selectingRef = useRef(selecting);
  selectingRef.current = selecting;

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
      const a = assetsRef.current[idx];
      if (a?.kind === "video") {
        warm.current?.abort();
        const ac = new AbortController();
        warm.current = ac;
        fetch(`/api/media/${a.id}`, { headers: { range: "bytes=0-1048575" }, signal: ac.signal }).catch(() => {});
      }
      setOpenIdx(idx);
    },
    [],
  );
  const closeViewer = useCallback(() => setOpenIdx(null), []);

  const toggleSelecting = useCallback(() => {
    setSelecting((v) => !v);
    setSel(new Set());
  }, []);

  const toggleSel = useCallback((id: string) => {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const onTileActivate = useCallback(
    (id: string) => {
      if (drag.current.didDrag) {
        drag.current.didDrag = false;
        return;
      }
      if (selectingRef.current) {
        toggleSel(id);
        return;
      }
      // sin `?? 0`: si por lo que sea el id no estuviera en el índice, abrir el
      // 0 sería abrir OTRA foto (la más reciente) — justo el fallo que ya se
      // arregló una vez.
      const i = idxRef.current.get(id);
      if (i !== undefined) openAt(i);
    },
    [toggleSel, openAt],
  );

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

  // Descargas. Una sola cosa = el original directo (sin ZIP). Varias = ZIP pedido
  // por POST (la selección no cabe en una URL). Si es MUCHO (descargar todo, o
  // selecciones de varios GB) se enseña antes la hoja con tamaño y partes.
  // formato de las descargas de este dispositivo (compatible con todo / original)
  const [dlCompat, setDlCompat] = useState(true);
  useEffect(() => {
    setDlCompat(formatoCompatible());
    const on = (e: Event) => setDlCompat(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(EVENTO_FORMATO, on);
    return () => window.removeEventListener(EVENTO_FORMATO, on);
  }, []);
  const [dlSheet, setDlSheet] = useState<{ fuente: FuenteZip; titulo: string } | null>(null);

  function downloadSelection(ids: string[]) {
    if (ids.length === 1) {
      descargarUno(ids[0]!);
      setToast("Descargando…");
      return;
    }
    const peso = new Map(assets.map((a) => [a.id, a.bytes]));
    const bytes = ids.reduce((n, id) => n + (peso.get(id) ?? 0), 0);
    if (bytes > UMBRAL_DIRECTO) {
      setDlSheet({ fuente: { ids }, titulo: "Descargar selección" });
      return;
    }
    descargarZip({ ids });
    setToast(`Preparando la descarga de ${ids.length}… se guardará en Descargas`);
  }

  function downloadAll() {
    setDlSheet({
      fuente: {
        ids: null,
        kind: kind ?? null,
        fav,
        album: albumId ?? null,
        q: q ?? null,
        camera: camera ?? null,
        from: from ?? null,
        to: to ?? null,
      },
      titulo: "Descargar todo",
    });
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
  // ¿hay algún filtro activo? Con filtros y 0 resultados NO se puede quitar la
  // barra: es donde está el buscador, y sin él no había forma de borrar la
  // búsqueda (salía «Tu biblioteca está vacía» y desaparecían los controles).
  const filtering = !!(kind || fav || q || camera || from || to);
  if (!assets.length && !filtering) {
    if (albumId) {
      return (
        <div className="empty">
          <EmptyMark />
          <h3>Este álbum está vacío</h3>
          <p>Añade fotos y vídeos desde la biblioteca: selecciónalos y pulsa «Añadir a álbum».</p>
        </div>
      );
    }
    // Primer contacto: tres pasos y un botón grande. Nada más.
    return (
      <div className="empty empty-first">
        <EmptyMark />
        <h3>Aquí vivirán tus recuerdos</h3>
        <p>Empieza con una sola foto. Tarda 10 segundos.</p>
        <ol className="first-steps">
          <li><b>1</b><span>Pulsa <em>Subir</em></span></li>
          <li><b>2</b><span>Elige fotos, vídeos o audios</span></li>
          <li><b>3</b><span>¡Listo! Se guardan tal cual, sin perder calidad</span></li>
        </ol>
        <button className="btn primary" type="button" onClick={() => window.dispatchEvent(new Event("upscale:pick"))}>
          Subir mis primeras fotos
        </button>
        <small>En el ordenador también puedes arrastrarlas hasta aquí.</small>
      </div>
    );
  }

  return (
    <>
      <div className="gallery-toolbar" ref={setToolbarEl}>
        <DensityControl value={density} onChange={setDensity} />

        {!albumId && (
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

          </div>
        )}

        <div className="gt-actions">
          <button
            className="btn ghost sm"
            onClick={toggleSelecting}
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
                    downloadAll();
                  }}
                >
                  Descargar todo ({(total || assets.length).toLocaleString("es-ES")})
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    guardarFormatoCompatible(!dlCompat);
                    setMenuOpen(false);
                    setToast(
                      !dlCompat
                        ? "Las descargas ahora se abren en cualquier aparato"
                        : "Las descargas ahora son el archivo exacto que subiste",
                    );
                  }}
                >
                  <span>Descarga: {dlCompat ? "fácil de abrir" : "tal cual la subiste"}</span>
                  <small className="gt-sub">{dlCompat ? "Se abre en cualquier aparato · toca para cambiar" : "El archivo exacto · toca para cambiar"}</small>
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

      {!assets.length && (
        <div className="empty" role="status">
          <h3>Sin resultados</h3>
          <p>Nada coincide con los filtros actuales. Cambia o borra la búsqueda para ver más.</p>
        </div>
      )}

      {liveGroups.map((g) => (
        <section className="daygroup" key={g.key}>
          <h3>
            <b>{g.label}</b>
            <i className="dg-count">{g.items.length}</i>
            <span className="dg-rule" aria-hidden="true" />
          </h3>
          <div
            className="grid"
            style={{ ["--tile" as string]: `${TILE[density]}px`, touchAction: selecting ? "pan-y" : undefined }}
            onPointerMove={onGridPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {g.items.map((a) => (
              <Tile
                key={a.id}
                a={a}
                selected={sel.has(a.id)}
                selecting={selecting}
                onDown={onTilePointerDown}
                onActivate={onTileActivate}
              />
            ))}
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
          {toastLink && (
            <Link href={toastLink.href} className="gt-toast-link">
              {toastLink.label}
            </Link>
          )}
        </motion.div>
      )}

      {/* Botón flotante: «Seleccionar» / «Listo» siempre al alcance del pulgar,
          aunque la barra de arriba ya no se vea. Mientras se selecciona se queda
          fijo (es la única salida del modo selección si no hay nada marcado). */}
      {(!toolbarInView || selecting) && !addIds && openIdx === null && (
        <button
          type="button"
          className={`sel-fab ${selecting ? "on" : ""} ${selecting && sel.size > 0 ? "with-bar" : ""}`}
          onClick={toggleSelecting}
          aria-pressed={selecting}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {selecting ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.2l2.5 2.5 4.5-5" /></>}
          </svg>
          {selecting ? "Listo" : "Seleccionar"}
        </button>
      )}

      {selecting && sel.size > 0 && (
        <motion.div className="selbar" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <span>
            <b>{sel.size}</b>
            <i className="selbar-long"> seleccionado{sel.size === 1 ? "" : "s"}</i>
          </span>
          <button className="btn sm" onClick={() => downloadSelection([...sel])}>
            Descargar
          </button>
          {assets.some((a) => sel.has(a.id) && a.kind === "photo") && (
            <button
              className="btn ghost sm"
              onClick={() => {
                const ids = assets.filter((a) => sel.has(a.id) && a.kind === "photo").slice(0, 30).map((a) => a.id);
                router.push(`/app/widgets/nuevo?fotos=${ids.join(",")}`);
              }}
            >
              Pantalla
            </button>
          )}
          {!albumId && (
            <button className="btn ghost sm" onClick={() => setAddIds([...sel])}>
              <span className="sb-lg">Añadir a álbum</span>
              <span className="sb-sm">Álbum</span>
            </button>
          )}
          <button className="btn ghost sm" onClick={bulkDelete}>
            {albumId ? (
              <>
                <span className="sb-lg">Quitar del álbum</span>
                <span className="sb-sm">Quitar</span>
              </>
            ) : (
              "Borrar"
            )}
          </button>
        </motion.div>
      )}

      {dlSheet && <DownloadSheet fuente={dlSheet.fuente} titulo={dlSheet.titulo} onClose={() => setDlSheet(null)} />}

      {addIds && (
        <AddToAlbumSheet
          assetIds={addIds}
          previews={assets.filter((a) => addIds.includes(a.id)).slice(0, 3).map((a) => a.thumbUrl)}
          onClose={() => setAddIds(null)}
          onAdded={(album, added) => {
            const multi = addIds.length > 1;
            setAddIds(null);
            if (multi) {
              setSelecting(false);
              setSel(new Set());
            }
            setToast(
              added === 0
                ? `Ya estaba en «${album.name}»`
                : `Añadido a «${album.name}»${added < addIds.length ? ` (${addIds.length - added} ya estaban)` : ""}`,
            );
            setToastLink({ href: `/app/albumes/${album.id}`, label: "Ver álbum" });
          }}
        />
      )}

      {viewerUsado.current && (
      <Viewer
        assets={assets}
        index={openIdx}
        // el visor también tira de la biblioteca: al acercarse al final de lo
        // cargado pide la página siguiente. Antes, abrir una foto y deslizar
        // se paraba en seco en la número 120 aunque hubiera 1.450.
        onNeedMore={cursor ? loadMore : undefined}
        onClose={closeViewer}
        onIndex={setOpenIdx}
        onFavorite={favorite}
        onDelete={del}
        inAlbum={!!albumId}
        onAddToAlbum={albumId ? undefined : (id) => setAddIds([id])}
      />
      )}
    </>
  );
}
