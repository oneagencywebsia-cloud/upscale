"use client";

import { useState } from "react";
import { motion } from "motion/react";

type Status = "idle" | "running" | "done" | "error";

/**
 * Vídeos que se rindieron tras agotar reintentos (preview_state=-1) se quedan
 * SIN copia ligera para siempre — reproducirlos cae al original de bitrate
 * completo, que es la causa real de las pausas de carga. Este botón los
 * vuelve a poner en cola; el worker de fondo los reintenta con el fix de
 * menos conexiones simultáneas ya desplegado.
 */
export default function PreviewsRetry() {
  const [status, setStatus] = useState<Status>("idle");
  const [reabiertos, setReabiertos] = useState<number | null>(null);

  async function run() {
    setStatus("running");
    try {
      const r = await fetch("/api/previews-reabrir", { method: "POST" });
      if (!r.ok) throw new Error("fallo");
      const data = (await r.json()) as { reabiertos: number };
      setReabiertos(data.reabiertos);
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
        {status === "running" ? "Reabriendo…" : "Reintentar vídeos sin vista previa"}
      </motion.button>
      {status === "done" && (
        <p className="panel-lede">
          {reabiertos === 0
            ? "No había ninguno pendiente de reintentar."
            : `${reabiertos} vídeos vueltos a poner en cola — tardarán según su tamaño.`}
        </p>
      )}
      {status === "error" && <p className="panel-lede">No se pudo completar. Reinténtalo.</p>}
    </div>
  );
}
