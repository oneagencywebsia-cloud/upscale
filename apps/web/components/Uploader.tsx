"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";

type Phase = "wait" | "upload" | "process" | "done" | "error";
interface Job {
  name: string;
  pct: number;
  phase: Phase;
  video: boolean;
}

const PHASE_TEXT: Record<Phase, string> = {
  wait: "En cola",
  upload: "Subiendo",
  process: "Procesando en el servidor…",
  done: "Guardado",
  error: "Error",
};

function uploadOne(
  file: File,
  onPct: (p: number) => void,
  onProcessing: () => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("x-captured-at", new Date(file.lastModified || Date.now()).toISOString());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPct(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.upload.onload = () => {
      onPct(100);
      onProcessing();
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.ontimeout = () => resolve(false);
    xhr.timeout = 45 * 60 * 1000;
    xhr.send(file);
  });
}

export default function Uploader({ onDone, busyLabel }: { onDone: () => void; busyLabel?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const running = jobs !== null;
  const allSettled = running && jobs.every((j) => j.phase === "done" || j.phase === "error");
  const overall = running
    ? Math.round(jobs.reduce((s, j) => s + (j.phase === "done" || j.phase === "error" ? 100 : j.pct), 0) / jobs.length)
    : 0;
  const failed = running ? jobs.filter((j) => j.phase === "error").length : 0;
  const hasVideo = running ? jobs.some((j) => j.video) : false;

  async function run(files: File[]) {
    const init: Job[] = files.map((f) => ({
      name: f.name,
      pct: 0,
      phase: "wait",
      video: (f.type || "").startsWith("video/") || /\.(mov|mp4|m4v|hevc)$/i.test(f.name),
    }));
    setJobs(init);
    for (let i = 0; i < files.length; i++) {
      const set = (patch: Partial<Job>) =>
        setJobs((js) => (js ? js.map((j, k) => (k === i ? { ...j, ...patch } : j)) : js));
      set({ phase: "upload" });
      const ok = await uploadOne(
        files[i]!,
        (p) => set({ pct: p }),
        () => set({ phase: "process" }),
      );
      set({ phase: ok ? "done" : "error", pct: 100 });
    }
    onDone();
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (input.current) input.current.value = "";
    if (files.length) run(files);
  }

  const overlay = running && mounted && (
    <motion.div
      className="up-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="up-card"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
      >
        <div className="up-head">
          <h3>{allSettled ? (failed ? "Subida terminada con errores" : "Todo guardado") : "Subiendo a Upscale"}</h3>
          <span className="up-pct">{overall}%</span>
        </div>

        <div className="up-track">
          <motion.div
            className="up-fill"
            animate={{ width: `${overall}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 24 }}
          />
        </div>

        <ul className="up-list">
          {jobs.map((j, i) => (
            <li key={i} className={`up-item ${j.phase}`}>
              <span className="up-name">{j.name}</span>
              <span className="up-state">
                {j.phase === "upload" ? `${j.pct}%` : PHASE_TEXT[j.phase]}
              </span>
              <div className="up-mini">
                <motion.div
                  className="up-mini-fill"
                  animate={{ width: `${j.phase === "done" || j.phase === "error" ? 100 : j.pct}%` }}
                  transition={{ type: "spring", stiffness: 140, damping: 22 }}
                />
              </div>
            </li>
          ))}
        </ul>

        {hasVideo && (
          <p className="up-hint up-warn">
            Los vídeos subidos desde el navegador del iPhone pueden perder fps y calidad
            (iOS los recodifica). Para el original íntegro usa el Atajo — mira Ajustes.
          </p>
        )}
        {allSettled && (
          <button className="btn primary sm" type="button" onClick={() => setJobs(null)}>
            Cerrar
          </button>
        )}
        {!allSettled && <p className="up-hint">No cierres esta ventana hasta que termine.</p>}
      </motion.div>
    </motion.div>
  );

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={onPick}
      />
      <motion.button
        className="upload"
        type="button"
        disabled={running && !allSettled}
        onClick={() => input.current?.click()}
        whileTap={{ scale: 0.94 }}
        whileHover={{ y: -1 }}
        transition={{ type: "spring", stiffness: 500, damping: 28 }}
      >
        <motion.svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"
          animate={running && !allSettled ? { y: [0, -3, 0] } : { y: 0 }}
          transition={running && !allSettled ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        >
          <path d="M12 19V5m0 0-6 6m6-6 6 6" />
        </motion.svg>
        {running && !allSettled ? (busyLabel ?? "Subiendo…") : "Subir"}
      </motion.button>

      {mounted && createPortal(<AnimatePresence>{overlay}</AnimatePresence>, document.body)}
    </>
  );
}
