"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AssetListResponse } from "@upscale/shared";
import { useDialogFocus } from "@/lib/dialog";

type Foto = AssetListResponse["items"][number];

/**
 * Elegir fotos de la biblioteca (varias). Carga sola al bajar, con buscador. Las ya
 * elegidas vienen marcadas y se quitan tocándolas otra vez.
 */
export default function FotoPicker({
  inicial,
  max,
  min = 1,
  onClose,
  onListo,
}: {
  inicial: string[];
  max: number;
  min?: number;
  onClose: () => void;
  onListo: (ids: string[], miniaturas: Record<string, string>) => void;
}) {
  const ref = useDialogFocus<HTMLDivElement>(true);
  const [items, setItems] = useState<Foto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [q, setQ] = useState("");
  const [consulta, setConsulta] = useState("");
  const [sel, setSel] = useState<string[]>(inicial);
  const miniaturas = useRef<Record<string, string>>({});
  const lista = useRef<HTMLDivElement>(null);
  const centinela = useRef<HTMLDivElement>(null);
  const peticion = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setConsulta(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  async function cargar(c: string | null, nueva: boolean) {
    const mi = ++peticion.current;
    setCargando(true);
    try {
      const p = new URLSearchParams({ kind: "photo", limit: "120", sort: "added" });
      if (consulta) p.set("q", consulta);
      if (c) p.set("cursor", c);
      const r = await fetch(`/api/assets?${p}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as AssetListResponse;
      if (mi !== peticion.current) return;
      d.items.forEach((a) => (miniaturas.current[a.id] = a.thumbUrl));
      setItems((prev) => (!nueva && prev ? [...prev, ...d.items] : d.items));
      setCursor(d.nextCursor);
      setError(false);
    } catch {
      if (mi === peticion.current) setError(true);
    } finally {
      if (mi === peticion.current) setCargando(false);
    }
  }

  useEffect(() => {
    setItems(null);
    setCursor(null);
    void cargar(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta]);

  useEffect(() => {
    const el = centinela.current;
    if (!el || !cursor || cargando || error) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && void cargar(cursor, false), { root: lista.current, rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, cargando, error, items]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const alternar = (id: string) =>
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= max ? s : [...s, id]));

  return createPortal(
    <div className="nmodal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nmodal-box wide nlib-box" role="dialog" aria-modal="true" aria-label="Elegir fotos de la biblioteca" tabIndex={-1} ref={ref}>
        <div className="nlib-head">
          <h2>Elige tus fotos</h2>
          <span className="fp-count" aria-live="polite">
            {sel.length} de {max}
          </span>
        </div>
        <input type="search" className="nlib-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o fecha…" aria-label="Buscar en tu biblioteca" />
        <div className="nlib-scroll" ref={lista}>
          {error && items === null ? (
            <p className="sp-warn" role="alert">
              No se pudo cargar tu biblioteca. <button type="button" className="btn sm" onClick={() => void cargar(null, true)}>Reintentar</button>
            </p>
          ) : items === null ? (
            <p className="nocr-wait" role="status"><span className="nspin" aria-hidden="true" /> Cargando…</p>
          ) : items.length === 0 ? (
            <p className="natt-hint">{consulta ? "No hay fotos que coincidan." : "Todavía no tienes fotos en la biblioteca."}</p>
          ) : (
            <ul className="nlib">
              {items.map((a) => {
                const on = sel.includes(a.id);
                return (
                  <li key={a.id} className={on ? "on" : ""}>
                    <button type="button" aria-pressed={on} aria-label={a.filename} onClick={() => alternar(a.id)} disabled={!on && sel.length >= max}>
                      <img src={a.thumbUrl} alt="" loading="lazy" decoding="async" />
                      {on && <span className="fp-n">{sel.indexOf(a.id) + 1}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div ref={centinela} className="nlib-end" aria-hidden="true" />
          {cargando && items !== null && <p className="nocr-wait" role="status"><span className="nspin" aria-hidden="true" /> Cargando más…</p>}
        </div>
        <div className="nmodal-acts">
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn primary" disabled={sel.length < min} onClick={() => onListo(sel, miniaturas.current)}>
            {sel.length < min ? `Elige al menos ${min}` : `Usar ${sel.length} ${sel.length === 1 ? "foto" : "fotos"}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
