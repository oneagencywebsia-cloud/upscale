"use client";

import { useState } from "react";
import { motion } from "motion/react";

type Status = "idle" | "running" | "done" | "error";

/**
 * Las fotos subidas antes del arreglo del mapa (sacaba GPS solo de vídeos
 * QuickTime, nunca de fotos) se quedaron sin lat/lon. Este botón re-procesa
 * los originales existentes en lotes de 40 hasta que no quede ninguno —
 * cada lote descarga el original de Telegram, así que tarda según cuántas
 * fotos falten.
 */
export default function GpsBackfill() {
  const [status, setStatus] = useState<Status>("idle");
  const [total, setTotal] = useState(0);
  const [actualizados, setActualizados] = useState(0);

  async function run() {
    setStatus("running");
    setTotal(0);
    setActualizados(0);
    try {
      for (;;) {
        const r = await fetch("/api/gps-backfill", { method: "POST" });
        if (!r.ok) throw new Error("fallo");
        const data = (await r.json()) as { procesados: number; actualizados: number };
        setTotal((t) => t + data.procesados);
        setActualizados((a) => a + data.actualizados);
        if (data.procesados < 40) break;
      }
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="gps-backfill">
      <motion.button
        type="button"
        className="btn"
        whileTap={{ scale: 0.96 }}
        onClick={run}
        disabled={status === "running"}
      >
        {status === "running" ? "Actualizando ubicaciones…" : "Actualizar ubicaciones en el mapa"}
      </motion.button>
      {status === "running" && <p className="panel-lede">{total} fotos revisadas…</p>}
      {status === "done" && (
        <p className="panel-lede">
          Listo — {total} fotos revisadas, {actualizados} con ubicación nueva encontrada.
        </p>
      )}
      {status === "error" && <p className="panel-lede">No se pudo completar. Reinténtalo.</p>}
    </div>
  );
}
