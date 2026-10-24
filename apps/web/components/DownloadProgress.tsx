"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bytesHuman } from "@/lib/format";
import { EVENTO_DESCARGA, type DetalleDescarga } from "@/lib/download";

interface Progreso {
  etapa: "preparando" | "enviando" | "listo" | "error" | "cancelado";
  total: number;
  hechos: number;
  bytesTotal: number;
  bytesEnviados: number;
  omitidos: number;
  parte: { n: number; de: number } | null;
  error: string | null;
}

/**
 * Barra de progreso de las descargas en ZIP. El navegador gestiona la descarga
 * (en iPhone, el gestor del sistema) y la página no puede medirla; el servidor sí:
 * `descargarZip()` manda un id y aquí se pregunta por él cada poco.
 *
 * Una sola barra a la vez (el servidor ya limita a un ZIP por persona).
 */
export default function DownloadProgress() {
  const [mounted, setMounted] = useState(false);
  const [det, setDet] = useState<DetalleDescarga | null>(null);
  const [p, setP] = useState<Progreso | null>(null);
  const [sinRespuesta, setSinRespuesta] = useState(false);
  const [oculta, setOculta] = useState(false);
  const jobRef = useRef<string | null>(null);

  useEffect(() => setMounted(true), []);

  // nueva descarga → se empieza de cero
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<DetalleDescarga>).detail;
      jobRef.current = d.job;
      setDet(d);
      setP(null);
      setSinRespuesta(false);
      setOculta(false);
    };
    window.addEventListener(EVENTO_DESCARGA, on);
    return () => window.removeEventListener(EVENTO_DESCARGA, on);
  }, []);

  // pregunta al servidor mientras la descarga siga viva
  useEffect(() => {
    if (!det) return;
    const job = det.job;
    const ac = new AbortController();
    const inicio = Date.now();
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (!vivo || jobRef.current !== job) return;
      let siguiente = 700;
      try {
        const r = await fetch(`/api/dl-progress?job=${job}`, { cache: "no-store", signal: ac.signal });
        if (r.ok) {
          const d = (await r.json()) as Progreso;
          if (!vivo || jobRef.current !== job) return;
          setP(d);
          setSinRespuesta(false);
          if (d.etapa === "listo" || d.etapa === "error" || d.etapa === "cancelado") return; // fin
        } else if (r.status === 404 && Date.now() - inicio > 12_000) {
          // el servidor nunca llegó a registrar la descarga: ventana bloqueada o petición perdida
          setSinRespuesta(true);
          return;
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        siguiente = 1500; // sin conexión un momento: se sigue intentando
      }
      if (Date.now() - inicio > 60 * 60 * 1000) return; // tope de seguridad: 1 h
      timer = setTimeout(tick, siguiente);
    };
    tick();
    return () => {
      vivo = false;
      ac.abort();
      if (timer) clearTimeout(timer);
    };
  }, [det]);

  // la tarjeta se retira sola unos segundos después de terminar bien
  useEffect(() => {
    if (p?.etapa !== "listo") return;
    const t = setTimeout(() => setDet(null), 9000);
    return () => clearTimeout(t);
  }, [p?.etapa]);

  if (!mounted || !det || oculta) return null;

  const etapa = sinRespuesta ? "error" : (p?.etapa ?? "preparando");
  const total = p?.bytesTotal ?? 0;
  const pct =
    etapa === "listo"
      ? 100
      : total > 0
        ? Math.min(99, Math.floor(((p?.bytesEnviados ?? 0) / total) * 100))
        : 0;
  const parte = p?.parte ?? det.parte;
  const titulo = det.titulo ?? (parte && parte.de > 1 ? `Parte ${parte.n} de ${parte.de}` : "Descargando");

  let linea: string;
  if (etapa === "error") {
    linea = sinRespuesta
      ? "No se pudo empezar. Puede que tu navegador haya bloqueado la ventana de descarga: permítela y vuelve a intentarlo."
      : (p?.error ?? "La descarga falló. Vuelve a intentarlo.");
  } else if (etapa === "cancelado") {
    linea = "Descarga cancelada.";
  } else if (etapa === "listo") {
    linea =
      p && p.omitidos > 0
        ? p.omitidos === 1
          ? "Listo · 1 archivo no se pudo incluir (lo explicamos en el archivo LEEME que viene dentro)."
          : `Listo · ${p.omitidos} archivos no se pudieron incluir (lo explicamos en el archivo LEEME que viene dentro).`
      : "Listo ✓ Lo tienes en Descargas.";
  } else if (!p || p.total === 0) {
    linea = "Preparando tu descarga…";
  } else {
    linea = `${p.hechos.toLocaleString("es-ES")} de ${p.total.toLocaleString("es-ES")} archivos · ${bytesHuman(p.bytesEnviados)} de ${bytesHuman(p.bytesTotal)}`;
  }

  const activa = etapa === "preparando" || etapa === "enviando";
  const clase = etapa === "error" || etapa === "cancelado" ? "bad" : etapa === "listo" ? "ok" : "";

  return createPortal(
    <div className={`dlp ${clase}`} role="status" aria-live="polite">
      <div className="dlp-top">
        <b>{titulo}</b>
        <span className="dlp-pct">{activa && total === 0 ? "" : etapa === "error" || etapa === "cancelado" ? "" : `${pct}%`}</span>
        <button type="button" className="dlp-x" aria-label="Cerrar" onClick={() => (activa ? setOculta(true) : setDet(null))}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div
        className={`dlp-bar ${activa && total === 0 ? "indet" : ""}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={activa && total === 0 ? undefined : pct}
        aria-label="Progreso de la descarga"
      >
        <i style={{ width: `${activa && total === 0 ? 35 : pct}%` }} />
      </div>
      <p className="dlp-line">{linea}</p>
    </div>,
    document.body,
  );
}
