"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { useDialogFocus } from "@/lib/dialog";
import { bytesHuman } from "@/lib/format";
import { descargarZip, esMovil, formatoCompatible, guardarFormatoCompatible, type FuenteZip } from "@/lib/download";

interface Parte {
  ids: string[];
  count: number;
  bytes: number;
}
interface Plan {
  count: number;
  bytes: number;
  parts: Parte[];
}

/**
 * Hoja de descarga para lo grande («descargar todo», selecciones de varios GB).
 * Dice cuánto es y lo reparte en partes que quepan en el móvil (2 GB; en
 * ordenador, 8 GB): cada parte es un ZIP aparte con un solo toque, así no hay
 * que esperar a que se prepare una descarga de decenas de GB y, si falla una,
 * solo se repite esa.
 */
export default function DownloadSheet({
  fuente,
  titulo,
  onClose,
  formatoInicial,
}: {
  fuente: FuenteZip;
  titulo: string;
  onClose: () => void;
  /** «original» para copias de seguridad; si no se da, la preferencia del dispositivo */
  formatoInicial?: "compatible" | "original";
}) {
  const [mounted, setMounted] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hechas, setHechas] = useState<Set<number>>(new Set());
  const sheet = useDialogFocus<HTMLDivElement>(mounted);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const movil = useRef(false);
  const [compat, setCompat] = useState(true);
  const [formatoListo, setFormatoListo] = useState(false); // no se pide el plan hasta saber el formato
  useEffect(() => {
    setCompat(formatoInicial ? formatoInicial === "compatible" : formatoCompatible());
    setFormatoListo(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    movil.current = esMovil();
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !formatoListo) return;
    const ac = new AbortController();
    const GB = 1024 ** 3;
    fetch("/api/dl-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: fuente.ids,
        kind: fuente.kind ?? undefined,
        fav: fuente.fav || undefined,
        album: fuente.album ?? undefined,
        compat: compat || undefined,
        q: fuente.q ?? undefined,
        camera: fuente.camera ?? undefined,
        from: fuente.from ?? undefined,
        to: fuente.to ?? undefined,
        maxPartBytes: (movil.current ? 2 : 8) * GB,
      }),
      signal: ac.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as Plan;
      })
      .then((p) => (p.count ? setPlan(p) : setError("No hay nada que descargar con este filtro.")))
      .catch((e) => {
        if ((e as Error)?.name !== "AbortError") setError("No se pudo preparar la descarga. Comprueba la conexión e inténtalo de nuevo.");
      });
    return () => ac.abort();
    // la fuente no cambia mientras la hoja está abierta; el formato sí (cambia tamaño y partes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, formatoListo, compat]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted]);

  function bajar(i: number) {
    if (!plan) return;
    const p = plan.parts[i]!;
    descargarZip({ ...fuente, ids: p.ids }, { n: i + 1, de: plan.parts.length }, undefined, compat);
    setHechas((h) => new Set(h).add(i));
  }

  if (!mounted) return null;
  const varias = (plan?.parts.length ?? 0) > 1;

  return createPortal(
    <div className="atas-backdrop" onPointerDown={onClose}>
      <motion.div
        ref={sheet}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Descargar"
        className="atas-sheet"
        initial={{ y: 48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="atas-grab" aria-hidden="true" />
        <header className="atas-head">
          <div className="atas-title">
            <b>{titulo}</b>
            <span>
              {plan
                ? `${plan.count.toLocaleString("es-ES")} elemento${plan.count === 1 ? "" : "s"} · ${bytesHuman(plan.bytes)}`
                : error
                  ? "—"
                  : "Calculando…"}
            </span>
          </div>
          <button type="button" className="iconbtn" aria-label="Cerrar" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="dls-fmt" role="group" aria-label="Formato de la descarga">
          <button
            type="button"
            className={compat ? "on" : ""}
            aria-pressed={compat}
            onClick={() => {
              setPlan(null);
              setCompat(true);
              guardarFormatoCompatible(true);
            }}
          >
            <b>Fácil de abrir</b>
            <small>Se abre en cualquier aparato</small>
          </button>
          <button
            type="button"
            className={!compat ? "on" : ""}
            aria-pressed={!compat}
            onClick={() => {
              setPlan(null);
              setCompat(false);
              guardarFormatoCompatible(false);
            }}
          >
            <b>Original</b>
            <small>El archivo exacto que subiste</small>
          </button>
        </div>

        {error && (
          <p className="dls-msg" role="alert">
            {error}
          </p>
        )}
        {!plan && !error && <div className="dls-wait" aria-busy="true"><i /><i /><i /></div>}

        {plan && (
          <>
            <p className="dls-tip">
              {varias
                ? `Son muchos archivos: te lo damos en ${plan.parts.length} partes para que sea rápido y no falle. Toca una, espera a que termine y toca la siguiente.`
                : compat
                  ? "Todo en una sola descarga. Lo que algunos aparatos no abren se convierte para que funcione en cualquiera; lo demás, tal cual."
                  : "Todo en una sola descarga, exactamente como lo subiste (sin perder calidad)."}
            </p>
            <div className="dls-list">
              {plan.parts.map((p, i) => (
                <button key={i} type="button" className={`dls-part ${hechas.has(i) ? "done" : ""}`} onClick={() => bajar(i)}>
                  <span className="dls-n">{hechas.has(i) ? "✓" : varias ? i + 1 : "↓"}</span>
                  <span className="dls-t">
                    <b>{varias ? `Parte ${i + 1} de ${plan.parts.length}` : "Descargar"}</b>
                    <i>
                      {p.count.toLocaleString("es-ES")} elemento{p.count === 1 ? "" : "s"} · {bytesHuman(p.bytes)}
                    </i>
                  </span>
                  <span className="dls-go">{hechas.has(i) ? "Otra vez" : "Descargar"}</span>
                </button>
              ))}
            </div>
            <p className="dls-foot">Se guarda en Descargas (en iPhone: Archivos › Descargas).</p>
          </>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
