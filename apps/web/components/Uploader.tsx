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
  fps: number | null;
  degraded: boolean; // iOS lo recodificó (≈30 fps) al pasarlo por el navegador
}

const PHASE_TEXT: Record<Phase, string> = {
  wait: "En cola",
  upload: "Subiendo",
  process: "Procesando en el servidor…",
  done: "Guardado",
  error: "Error",
};

const isVideo = (f: File) =>
  (f.type || "").startsWith("video/") || /\.(mov|mp4|m4v|hevc|webm|mkv)$/i.test(f.name);

/** Mide los fps reales del archivo reproduciendo unos fotogramas en un <video> oculto. */
function probeFps(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    let done = false;
    let guard = 0;
    const finish = (fps: number | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(guard);
      try {
        v.pause();
        // soltar el archivo de verdad: sin esto el navegador se queda con el
        // decodificador y el buffer de un vídeo que puede ser de varios GB
        // mientras dura la subida.
        v.removeAttribute("src");
        v.load();
      } catch {}
      URL.revokeObjectURL(url);
      resolve(fps);
    };
    const rvfc = (
      v as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      }
    ).requestVideoFrameCallback?.bind(v);
    if (!rvfc) return finish(null);

    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;

    let frames = 0;
    let t0 = -1;
    let lastT = -1;
    const tick = (_now: number, meta: { mediaTime: number }) => {
      if (t0 < 0) t0 = meta.mediaTime;
      lastT = meta.mediaTime;
      frames++;
      const elapsed = lastT - t0;
      if (elapsed >= 0.7 && frames > 4) return finish(Math.round(frames / elapsed));
      rvfc(tick);
    };
    v.onloadeddata = () => {
      v.play().then(() => rvfc(tick)).catch(() => finish(null));
    };
    v.onerror = () => finish(null);
    guard = window.setTimeout(() => {
      const elapsed = lastT - t0;
      finish(frames > 4 && elapsed > 0.2 ? Math.round(frames / elapsed) : null);
    }, 3500);
  });
}

/** Sin señales de vida durante este tiempo, se da por muerta la conexión. */
const STALL_MS = 3 * 60 * 1000;

function uploadOne(file: File, onPct: (p: number) => void, onProcessing: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("x-captured-at", new Date(file.lastModified || Date.now()).toISOString());

    // Un original ya puede ser de decenas de GB: con `xhr.timeout = 45 min` una
    // subida perfectamente sana se abortaba a mitad por el simple hecho de ser
    // grande (un vídeo de 30 GB por una subida doméstica son horas). En su
    // lugar, no hay tope de duración: se vigila que la subida AVANCE. Y tras el
    // último byte hay que darle su tiempo al servidor, que aún tiene que
    // trocear y guardar el archivo antes de contestar.
    let last = Date.now();
    let uploaded = false;
    const watchdog = window.setInterval(() => {
      // Solo mientras se están mandando bytes. Una vez enviado el último, el
      // servidor puede tardar lo que haga falta (trocear 30 GB hacia Telegram
      // no es rápido) y cortar AQUÍ sería peor que esperar: el archivo se
      // guardaría igual en el servidor y la app diría "Error".
      if (uploaded || Date.now() - last <= STALL_MS) return;
      window.clearInterval(watchdog);
      try {
        xhr.abort();
      } catch {
        /* ya estaba muerto */
      }
      resolve(false);
    }, 5_000);
    const stop = (ok: boolean) => {
      window.clearInterval(watchdog);
      resolve(ok);
    };

    xhr.upload.onprogress = (e) => {
      last = Date.now();
      if (e.lengthComputable) onPct(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.upload.onload = () => {
      last = Date.now();
      uploaded = true;
      onPct(100);
      onProcessing();
    };
    xhr.onprogress = () => (last = Date.now());
    xhr.onload = () => stop(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => stop(false);
    xhr.onabort = () => stop(false);
    xhr.ontimeout = () => stop(false);
    xhr.timeout = 0; // sin tope: manda el vigilante de arriba
    xhr.send(file);
  });
}

export default function Uploader({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const running = jobs !== null;
  const allSettled = running && jobs.every((j) => j.phase === "done" || j.phase === "error");

  // Cerrar la pestaña a mitad de una subida de varios GB la tira entera y no
  // hay forma de retomarla. Al menos que el navegador pregunte.
  useEffect(() => {
    if (!running || allSettled) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running, allSettled]);

  const overall = running
    ? Math.round(
        jobs.reduce((s, j) => s + (j.phase === "done" || j.phase === "error" ? 100 : j.pct), 0) / jobs.length,
      )
    : 0;
  const failed = running ? jobs.filter((j) => j.phase === "error").length : 0;
  const anyDegraded = running ? jobs.some((j) => j.degraded) : false;
  const anyVideo = running ? jobs.some((j) => j.video) : false;

  async function run(files: File[]) {
    const set = (i: number, patch: Partial<Job>) =>
      setJobs((js) => (js ? js.map((j, k) => (k === i ? { ...j, ...patch } : j)) : js));

    setJobs(
      files.map((f) => ({
        name: f.name,
        pct: 0,
        phase: "wait",
        video: isVideo(f),
        fps: null,
        degraded: false,
      })),
    );

    // mide fps de los vídeos en paralelo (no bloquea la subida)
    files.forEach((f, i) => {
      if (!isVideo(f)) return;
      probeFps(f).then((fps) => {
        if (fps == null) return;
        set(i, { fps, degraded: fps > 0 && fps <= 32 });
      });
    });

    for (let i = 0; i < files.length; i++) {
      set(i, { phase: "upload" });
      const ok = await uploadOne(
        files[i]!,
        (p) => set(i, { pct: p }),
        () => set(i, { phase: "process" }),
      );
      set(i, { phase: ok ? "done" : "error", pct: 100 });
    }
    onDone();
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (input.current) input.current.value = "";
    if (files.length) run(files);
  }

  const overlay = running && mounted && (
    <motion.div className="up-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
              <span className="up-state">{j.phase === "upload" ? `${j.pct}%` : PHASE_TEXT[j.phase]}</span>
              <div className="up-mini">
                <motion.div
                  className="up-mini-fill"
                  animate={{ width: `${j.phase === "done" || j.phase === "error" ? 100 : j.pct}%` }}
                  transition={{ type: "spring", stiffness: 140, damping: 22 }}
                />
              </div>
              {j.degraded && (
                <span className="up-degraded">
                  iOS lo ha bajado a ~{j.fps} fps. Súbelo desde <b>Archivos</b> o con el Atajo para el original.
                </span>
              )}
              {j.video && !j.degraded && j.fps != null && (
                <span className="up-ok">{j.fps} fps · íntegro</span>
              )}
            </li>
          ))}
        </ul>

        {anyDegraded ? (
          <div className="up-hint up-warn">
            <b>Vídeo recodificado por iOS.</b> Al elegirlo desde <b>Fototeca</b> en el navegador,
            iOS baja los fps y el bitrate antes de subirlo. Para el archivo tal cual sale del iPhone:
            <ol>
              <li>En <b>Fotos</b>, abre el vídeo → <b>Compartir</b> → <b>Guardar en Archivos</b>.</li>
              <li>Aquí, pulsa <b>Subir</b> → <b>Explorar</b> → cógelo de <b>Archivos</b>.</li>
            </ol>
            O monta el <b>Atajo de iOS</b> (Ajustes) y se sube solo, siempre íntegro.
          </div>
        ) : (
          anyVideo &&
          !allSettled && (
            <p className="up-hint">
              Para vídeo en calidad original: elige <b>Explorar → Archivos</b>, no <b>Fototeca</b>.
            </p>
          )
        )}

        {allSettled ? (
          <button className="btn primary sm" type="button" onClick={() => setJobs(null)}>
            Cerrar
          </button>
        ) : (
          <p className="up-hint">No cierres esta ventana hasta que termine.</p>
        )}
      </motion.div>
    </motion.div>
  );

  return (
    <>
      {/* Sin `accept`: con uno (aunque fuera "image/*,video/*") el propio SISTEMA
          OPERATIVO decide qué mostrar en gris/oculto según el tipo de archivo que
          él mismo detecte — y Windows a menudo no reconoce bien archivos que
          vienen del iPhone por cable (algunos HEIC, Live Photos, etc.), dejándolos
          fuera del selector antes de que la app llegue a verlos. El servidor ya
          admite cualquier archivo sin restricción; el filtro vivía solo aquí. */}
      <input ref={input} type="file" multiple hidden onChange={onPick} />
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
        {running && !allSettled ? "Subiendo…" : "Subir"}
      </motion.button>

      {mounted && createPortal(<AnimatePresence>{overlay}</AnimatePresence>, document.body)}
    </>
  );
}
