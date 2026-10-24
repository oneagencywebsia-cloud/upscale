"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AssetListResponse } from "@upscale/shared";
import { api, ErrorApi, type NoteAttachment } from "@/lib/notes";
import { useDialogFocus } from "@/lib/dialog";
import { atajo, useTeclado } from "@/lib/dispositivo";

const MAX_BYTES = 40 * 1024 * 1024;

export type SubirFn = (files: File[]) => void;

interface Props {
  noteId: string;
  adjuntos: NoteAttachment[];
  setAdjuntos: (a: NoteAttachment[]) => void;
  /** inserta texto (editable) en el cuerpo de la nota */
  insertar: (texto: string) => void;
  aviso: (t: string) => void;
  /** el padre registra aquí la función de «subir estos archivos» (pegar/arrastrar sobre el editor) */
  registrar: (f: SubirFn) => void;
}

interface Lectura {
  assetId: string;
  nombre: string;
  texto: string;
  estado: "leyendo" | "listo" | "error";
  error?: string;
}

/** Capturas adjuntas: subir (o elegir de la biblioteca), leer su texto (OCR) y dejarlo editable. */
export default function NoteAttachments({ noteId, adjuntos, setAdjuntos, insertar, aviso, registrar }: Props) {
  const teclado = useTeclado();
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState<string[]>([]);
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [biblioteca, setBiblioteca] = useState(false);
  const adjRef = useRef(adjuntos);
  adjRef.current = adjuntos;

  async function leer(a: Pick<NoteAttachment, "assetId" | "filename" | "ocrDone">, forzar = false) {
    setLectura({ assetId: a.assetId, nombre: a.filename, texto: "", estado: "leyendo" });
    try {
      if (a.ocrDone && !forzar) {
        const r = await api<{ text: string }>(`/${noteId}/attachments/${a.assetId}/text`);
        setLectura({ assetId: a.assetId, nombre: a.filename, texto: r.text, estado: "listo" });
        return;
      }
      const r = await api<{ text: string }>(`/${noteId}/attachments/${a.assetId}/ocr`, { method: "POST" });
      setAdjuntos(adjRef.current.map((x) => (x.assetId === a.assetId ? { ...x, ocrDone: true } : x)));
      setLectura({ assetId: a.assetId, nombre: a.filename, texto: r.text, estado: "listo" });
    } catch (e) {
      setLectura({ assetId: a.assetId, nombre: a.filename, texto: "", estado: "error", error: e instanceof ErrorApi ? e.message : "No se pudo leer el texto" });
    }
  }

  async function adjuntar(assetId: string, nombre: string) {
    const r = await api<{ attachments: NoteAttachment[] }>(`/${noteId}/attachments`, { method: "POST", json: { assetId } });
    setAdjuntos(r.attachments);
    const nuevo = r.attachments.find((x) => x.assetId === assetId);
    if (nuevo) void leer(nuevo);
    else aviso(`«${nombre}» adjuntada`);
  }

  async function subir(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length < files.length) aviso("Solo se pueden adjuntar imágenes");
    for (const f of imgs) {
      if (f.size > MAX_BYTES) {
        aviso(`«${f.name}» pesa demasiado para una nota (máx. 40 MB)`);
        continue;
      }
      const nombre = f.name && f.name !== "image.png" ? f.name : `captura-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.png`;
      setSubiendo((p) => [...p, nombre]);
      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: {
            "content-type": f.type || "application/octet-stream",
            "x-filename": encodeURIComponent(nombre),
            "x-captured-at": new Date(f.lastModified || Date.now()).toISOString(),
          },
          body: f,
        });
        const d = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!res.ok || !d.id) throw new Error(d.error ?? "No se pudo subir");
        await adjuntar(d.id, nombre);
      } catch (e) {
        aviso(e instanceof Error ? e.message : "No se pudo subir la captura");
      } finally {
        setSubiendo((p) => p.filter((x) => x !== nombre));
      }
    }
  }

  const subirRef = useRef(subir);
  subirRef.current = subir;
  useEffect(() => registrar((f) => void subirRef.current(f)), [registrar]);

  async function quitar(a: NoteAttachment) {
    try {
      const r = await api<{ attachments: NoteAttachment[] }>(`/${noteId}/attachments/${a.assetId}`, { method: "DELETE" });
        setAdjuntos(r.attachments);
      if (lectura?.assetId === a.assetId) setLectura(null);
      aviso("Captura quitada de la nota (sigue en tu biblioteca)");
    } catch {
      aviso("No se pudo quitar la captura");
    }
  }

  return (
    <section className="natt" aria-label="Capturas de la nota">
      <div className="natt-head">
        <h2>Capturas</h2>
        <div className="natt-add">
          <button type="button" className="btn sm" onClick={() => input.current?.click()}>Subir imagen</button>
          <button type="button" className="btn sm ghost" onClick={() => setBiblioteca(true)}>De mi biblioteca</button>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; void subir(fs); }} />
        </div>
      </div>
      <p className="natt-hint">{teclado ? `Sube, arrastra o pega (${atajo("V")}) una captura` : "Sube una captura"} y Upscale lee su texto para que lo puedas editar. Se guarda en tu biblioteca, no en el servidor.</p>

      {(adjuntos.length > 0 || subiendo.length > 0) && (
        <ul className="natt-list">
          {adjuntos.map((a) => (
            <li key={a.assetId}>
              <button type="button" className="natt-thumb" onClick={() => void leer(a)} aria-label={`Ver el texto de ${a.filename}`}>
                <img src={a.thumbUrl} alt="" loading="lazy" decoding="async" />
                <span>{a.ocrDone ? "Ver texto" : "Leer texto"}</span>
              </button>
              <button type="button" className="natt-x" aria-label={`Quitar ${a.filename}`} onClick={() => void quitar(a)}>✕</button>
            </li>
          ))}
          {subiendo.map((n) => (
            <li key={n} className="natt-up" aria-busy="true"><span>Subiendo…</span></li>
          ))}
        </ul>
      )}

      {lectura && (
        <PanelTexto
          l={lectura}
          onClose={() => setLectura(null)}
          onTexto={(t) => setLectura((p) => (p ? { ...p, texto: t } : p))}
          onInsertar={() => {
            insertar(lectura.texto);
            setLectura(null);
            aviso("Texto añadido a la nota");
          }}
          onReleer={() => {
            const a = adjuntos.find((x) => x.assetId === lectura.assetId);
            if (a) void leer(a, true);
          }}
        />
      )}
      {biblioteca && <Biblioteca onClose={() => setBiblioteca(false)} ya={new Set(adjuntos.map((a) => a.assetId))} onElegir={(id, n) => { setBiblioteca(false); void adjuntar(id, n).catch((e) => aviso(e instanceof ErrorApi ? e.message : "No se pudo adjuntar")); }} />}
    </section>
  );
}

function PanelTexto({ l, onClose, onTexto, onInsertar, onReleer }: { l: Lectura; onClose: () => void; onTexto: (t: string) => void; onInsertar: () => void; onReleer: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>(true);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div className="nmodal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nmodal-box wide" role="dialog" aria-modal="true" aria-label={`Texto de ${l.nombre}`} tabIndex={-1} ref={ref}>
        <h2>Texto de la captura</h2>
        <p className="nmodal-sub">{l.nombre}</p>
        {l.estado === "leyendo" && <p className="nocr-wait" role="status"><span className="nspin" aria-hidden="true" /> Leyendo el texto de la imagen…</p>}
        {l.estado === "error" && <p className="sp-warn" role="alert">{l.error}</p>}
        {l.estado === "listo" && (
          <>
            {l.texto.trim() === "" && <p className="sp-warn" role="status">No se encontró texto en esta imagen.</p>}
            <label className="sr-only" htmlFor="ocr-texto">Texto extraído (editable)</label>
            <textarea id="ocr-texto" className="nocr-text" value={l.texto} onChange={(e) => onTexto(e.target.value)} rows={10} spellCheck />
            <p className="natt-hint">Puedes corregirlo aquí antes de añadirlo a la nota.</p>
          </>
        )}
        <div className="nmodal-acts">
          <button type="button" className="btn ghost" onClick={onClose}>Cerrar</button>
          {l.estado !== "leyendo" && <button type="button" className="btn ghost" onClick={onReleer}>Volver a leer</button>}
          {l.estado === "listo" && l.texto.trim() !== "" && (
            <>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  navigator.clipboard?.writeText(l.texto).then(() => { setCopiado(true); window.setTimeout(() => setCopiado(false), 1800); }).catch(() => {});
                }}
              >
                {copiado ? "¡Copiado!" : "Copiar"}
              </button>
              <button type="button" className="btn primary" onClick={onInsertar}>Añadir a la nota</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Biblioteca({ onClose, onElegir, ya }: { onClose: () => void; onElegir: (id: string, nombre: string) => void; ya: Set<string> }) {
  const ref = useDialogFocus<HTMLDivElement>(true);
  const [items, setItems] = useState<AssetListResponse["items"] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [mas, setMas] = useState(false);

  async function cargar(c?: string) {
    try {
      const p = new URLSearchParams({ kind: "photo", limit: "60", sort: "added" });
      if (c) p.set("cursor", c);
      const r = await fetch(`/api/assets?${p}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as AssetListResponse;
      setItems((prev) => (c && prev ? [...prev, ...d.items] : d.items));
      setCursor(d.nextCursor);
    } catch {
      setError(true);
    }
  }
  useEffect(() => {
    void cargar();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="nmodal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nmodal-box wide" role="dialog" aria-modal="true" aria-label="Elegir una imagen de la biblioteca" tabIndex={-1} ref={ref}>
        <h2>Elige una imagen</h2>
        {error ? (
          <p className="sp-warn" role="alert">No se pudo cargar tu biblioteca.</p>
        ) : items === null ? (
          <p className="nocr-wait" role="status"><span className="nspin" aria-hidden="true" /> Cargando…</p>
        ) : items.length === 0 ? (
          <p className="natt-hint">Todavía no tienes fotos en la biblioteca.</p>
        ) : (
          <ul className="nlib">
            {items.map((a) => (
              <li key={a.id}>
                <button type="button" disabled={ya.has(a.id)} onClick={() => onElegir(a.id, a.filename)} aria-label={`${a.filename}${ya.has(a.id) ? " (ya adjunta)" : ""}`}>
                  <img src={a.thumbUrl} alt="" loading="lazy" decoding="async" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="nmodal-acts">
          {cursor && <button type="button" className="btn ghost" disabled={mas} onClick={async () => { setMas(true); await cargar(cursor); setMas(false); }}>Cargar más</button>}
          <button type="button" className="btn" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
