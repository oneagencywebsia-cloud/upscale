"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { gbHuman } from "@/lib/plans";
import { bytesHuman } from "@/lib/format";

/** «2,5 GB» a partir de 1 GB; «820 MB», «3,2 KB» por debajo (nunca «0 GB»). */
const sizeHuman = (b: number) => (b >= 1024 ** 3 ? gbHuman(b) : bytesHuman(Math.max(0, b)));

/**
 * Subida de archivos — pensada para que no haga falta explicarla:
 *  - un solo botón «Subir» (en el iPhone el sistema ya ofrece Fototeca / Hacer
 *    foto / Archivos) y, en el ordenador, ARRASTRAR Y SOLTAR en cualquier parte
 *    (carpetas incluidas);
 *  - varios archivos A LA VEZ (3), con reintento automático si la red o el
 *    servidor fallan un momento;
 *  - avisa ANTES de subir si algo no cabe en el espacio del plan;
 *  - al terminar, un resumen claro y un botón para ver lo recién subido.
 */

type Phase = "wait" | "upload" | "process" | "done" | "dup" | "error" | "nofit" | "skip";

interface Job {
  id: number;
  file: File;
  name: string;
  size: number;
  pct: number;
  phase: Phase;
  video: boolean;
  fps: number | null;
  degraded: boolean; // iOS lo recodificó (≈30 fps) al pasarlo por el navegador
  error?: string;
  tries: number;
  /** texto corto bajo el nombre («Reintentando…») */
  note?: string;
}

const MAX_PARALLEL = 3; // = tope por persona de la API (UPLOAD_MAX_PER_USER)
const MAX_TRIES = 4;

const MEDIA_EXT =
  /\.(heic|heif|jpe?g|png|webp|gif|tiff?|dng|avif|mov|mp4|m4v|hevc|3gp|avi|mkv|webm|mp3|m4a|m4b|aac|wav|flac|ogg|oga|opus|aiff?|caf|amr|wma)$/i;
const isMedia = (f: File) => /^(image|video|audio)\//.test(f.type || "") || MEDIA_EXT.test(f.name);
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

type UploadResult =
  | { ok: true; status: "saved" | "duplicate" }
  | { ok: false; retry: boolean; delayMs: number; error: string };

function uploadOne(
  file: File,
  xhrs: Map<number, XMLHttpRequest>,
  id: number,
  onPct: (p: number) => void,
  onProcessing: () => void,
): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhrs.set(id, xhr);
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("x-captured-at", new Date(file.lastModified || Date.now()).toISOString());

    // Un original puede ser de decenas de GB: no hay tope de duración, se vigila que
    // la subida AVANCE. Y tras el último byte el servidor puede tardar lo que haga
    // falta en trocear y guardar el archivo: cortar ahí sería peor que esperar.
    let last = Date.now();
    let uploaded = false;
    const watchdog = window.setInterval(() => {
      if (uploaded || Date.now() - last <= STALL_MS) return;
      window.clearInterval(watchdog);
      try {
        xhr.abort();
      } catch {
        /* ya estaba muerto */
      }
    }, 5_000);
    const end = (r: UploadResult) => {
      window.clearInterval(watchdog);
      xhrs.delete(id);
      resolve(r);
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
    xhr.onload = () => {
      let body: { status?: string; error?: string; code?: string } = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* respuesta sin JSON */
      }
      const s = xhr.status;
      if (s >= 200 && s < 300) return end({ ok: true, status: body.status === "duplicate" ? "duplicate" : "saved" });
      if (body.code === "INCOMPLETE" || s === 411) return end({ ok: false, retry: true, delayMs: 3000, error: "La subida se cortó; reintentando" });
      if (s === 429) {
        const wait = Number(xhr.getResponseHeader("retry-after")) || 5;
        return end({ ok: false, retry: true, delayMs: wait * 1000, error: "Hay mucha cola ahora mismo" });
      }
      if (s === 402) return end({ ok: false, retry: false, delayMs: 0, error: "No te queda espacio para este archivo" });
      if (s === 413) return end({ ok: false, retry: false, delayMs: 0, error: body.error ?? "Pesa más de lo que admite tu plan" });
      if (s === 401 || s === 403) return end({ ok: false, retry: false, delayMs: 0, error: "Por seguridad, tienes que entrar otra vez." });
      if (s >= 500 || s === 408 || s === 0) return end({ ok: false, retry: true, delayMs: 3000, error: "Está tardando más de lo normal. Se vuelve a intentar solo." });
      return end({ ok: false, retry: false, delayMs: 0, error: body.error ?? `No se pudo guardar (${s})` });
    };
    xhr.onerror = () => end({ ok: false, retry: true, delayMs: 3000, error: "Se cortó la conexión" });
    xhr.onabort = () => end({ ok: false, retry: false, delayMs: 0, error: "Cancelado" });
    xhr.ontimeout = () => end({ ok: false, retry: true, delayMs: 3000, error: "Se cortó la conexión" });
    xhr.timeout = 0; // sin tope: manda el vigilante de arriba
    xhr.send(file);
  });
}

/** Archivos de una operación de arrastrar (carpetas incluidas). Hay que leer las
 *  entradas ANTES de cualquier `await`: el navegador vacía el DataTransfer al acabar el evento. */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  type Entry = { isFile: boolean; isDirectory: boolean; file: (ok: (f: File) => void, no: (e: unknown) => void) => void; createReader: () => { readEntries: (ok: (e: Entry[]) => void, no: (e: unknown) => void) => void } };
  const entries = Array.from(dt.items ?? [])
    .map((i) => (i as unknown as { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null)
    .filter((e): e is Entry => !!e);
  const plain = Array.from(dt.files ?? []);
  if (!entries.length) return plain;
  const out: File[] = [];
  const walk = async (e: Entry): Promise<void> => {
    if (e.isFile) {
      out.push(await new Promise<File>((ok, no) => e.file(ok, no)));
    } else if (e.isDirectory) {
      const reader = e.createReader();
      for (;;) {
        const batch = await new Promise<Entry[]>((ok, no) => reader.readEntries(ok, no));
        if (!batch.length) break;
        for (const c of batch) await walk(c);
      }
    }
  };
  for (const e of entries) await walk(e).catch(() => {});
  return out.length ? out : plain;
}

interface Account {
  unlimited: boolean;
  remainingBytes: number | null;
  plan: { name: string; maxFileBytes: number | null };
}

export default function Uploader({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const jobsRef = useRef<Job[]>([]);
  const xhrs = useRef(new Map<number, XMLHttpRequest>());
  const active = useRef(0);
  const nextId = useRef(1);
  const savedSinceRefresh = useRef(0);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [min, setMin] = useState(false);
  const [dragging, setDragging] = useState(false);
  // acceso rápido «Subir» (mantener pulsado el icono de la app → /app?subir=1): el navegador solo
  // abre el selector de archivos tras un toque, así que primero se muestra un botón grande.
  const [pedir, setPedir] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("subir") !== "1") return;
    sp.delete("subir");
    window.history.replaceState(null, "", `${window.location.pathname}${sp.size ? `?${sp}` : ""}`);
    setPedir(true);
  }, []);

  const commit = useCallback((next: Job[]) => {
    jobsRef.current = next;
    setJobs(next);
  }, []);
  const patch = useCallback(
    (id: number, p: Partial<Job>) => commit(jobsRef.current.map((j) => (j.id === id ? { ...j, ...p } : j))),
    [commit],
  );

  const busy = jobs.some((j) => j.phase === "wait" || j.phase === "upload" || j.phase === "process");
  const real = jobs.filter((j) => j.phase !== "skip" && j.phase !== "nofit");
  const savedN = jobs.filter((j) => j.phase === "done").length;
  const dupN = jobs.filter((j) => j.phase === "dup").length;
  const errN = jobs.filter((j) => j.phase === "error").length;
  const nofitN = jobs.filter((j) => j.phase === "nofit").length;
  const skipN = jobs.filter((j) => j.phase === "skip").length;
  const settledN = real.filter((j) => j.phase === "done" || j.phase === "dup" || j.phase === "error").length;
  const totalBytes = real.reduce((s, j) => s + j.size, 0) || 1;
  const overall = Math.round(
    real.reduce((s, j) => s + j.size * (j.phase === "done" || j.phase === "dup" || j.phase === "error" ? 100 : j.pct), 0) / totalBytes,
  );
  const anyDegraded = jobs.some((j) => j.degraded);

  // cerrar la pestaña a mitad de una subida de varios GB la tira entera
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  // al terminar el lote: la galería se pone al día UNA vez, y si estaba minimizado se abre el resumen
  useEffect(() => {
    if (busy || !jobs.length) return;
    setMin(false);
    if (savedSinceRefresh.current > 0) {
      savedSinceRefresh.current = 0;
      onDone();
    }
  }, [busy, jobs.length, onDone]);

  const pump = useCallback(() => {
    while (active.current < MAX_PARALLEL) {
      const next = jobsRef.current.find((j) => j.phase === "wait");
      if (!next) break;
      active.current++;
      patch(next.id, { phase: "upload", pct: 0, note: undefined });
      void (async () => {
        let tries = next.tries;
        for (;;) {
          const r = await uploadOne(
            next.file,
            xhrs.current,
            next.id,
            (p) => patch(next.id, { pct: p }),
            () => patch(next.id, { phase: "process", note: undefined }),
          );
          if (r.ok) {
            if (r.status === "saved") savedSinceRefresh.current++;
            patch(next.id, { phase: r.status === "saved" ? "done" : "dup", pct: 100, note: undefined, error: undefined });
            break;
          }
          tries++;
          if (r.retry && tries < MAX_TRIES) {
            patch(next.id, { phase: "upload", pct: 0, tries, note: `${r.error}. Reintentando…` });
            await new Promise((ok) => setTimeout(ok, r.delayMs));
            continue;
          }
          patch(next.id, { phase: "error", pct: 100, tries, error: r.error, note: undefined });
          break;
        }
        active.current--;
        pump();
      })();
    }
  }, [patch]);

  /** ¿cabe? Se mira ANTES de subir: así no se gastan GB de subida en algo que el servidor va a rechazar. */
  async function fits(list: Job[]): Promise<Job[]> {
    const acc: Account | null = await fetch("/api/account", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!acc || acc.unlimited) return list;
    let remaining = acc.remainingBytes ?? Infinity;
    const maxFile = acc.plan.maxFileBytes ?? Infinity;
    return list.map((j) => {
      if (j.phase !== "wait") return j;
      if (j.size > maxFile) {
        return { ...j, phase: "nofit" as Phase, error: `Pesa más de ${sizeHuman(maxFile)}, el máximo por archivo del plan ${acc.plan.name}` };
      }
      if (j.size > remaining) {
        return { ...j, phase: "nofit" as Phase, error: `No cabe: te quedan ${sizeHuman(remaining)}` };
      }
      remaining -= j.size;
      return j;
    });
  }

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const fresh: Job[] = files.map((f) => {
        const media = isMedia(f);
        return {
          id: nextId.current++,
          file: f,
          name: f.name,
          size: f.size,
          pct: 0,
          phase: (media ? "wait" : "skip") as Phase,
          video: isVideo(f),
          fps: null,
          degraded: false,
          tries: 0,
          error: media ? undefined : "Solo se guardan fotos, vídeos y audio",
        };
      });
      // si ya había un lote terminado en pantalla, se empieza de cero
      const base = jobsRef.current.some((j) => j.phase === "wait" || j.phase === "upload" || j.phase === "process") ? jobsRef.current : [];
      commit([...base, ...fresh]);
      setOpen(true);
      setMin(false);
      const checked = await fits(jobsRef.current);
      commit(checked);
      pump();
      // fps reales de los vídeos (no bloquea la subida)
      for (const j of fresh) {
        if (!j.video || j.phase === "skip") continue;
        void probeFps(j.file).then((fps) => {
          if (fps != null) patch(j.id, { fps, degraded: fps > 0 && fps <= 32 });
        });
      }
    },
    [commit, patch, pump],
  );

  async function retryFailed() {
    const reset = jobsRef.current.map((j) =>
      j.phase === "error" || j.phase === "nofit" ? { ...j, phase: "wait" as Phase, pct: 0, tries: 0, error: undefined } : j,
    );
    commit(await fits(reset));
    pump();
  }

  function cancel(j: Job) {
    if (j.phase === "wait") patch(j.id, { phase: "skip", error: "Cancelado" });
    else xhrs.current.get(j.id)?.abort();
  }

  function close() {
    setOpen(false);
    commit([]);
  }

  // «Subir» desde otros sitios (p. ej. el estado vacío de la biblioteca)
  useEffect(() => {
    const pick = () => input.current?.click();
    window.addEventListener("upscale:pick", pick);
    return () => window.removeEventListener("upscale:pick", pick);
  }, []);

  // arrastrar y soltar en cualquier parte de la app
  useEffect(() => {
    let depth = 0;
    let lastOver = 0;
    // red de seguridad: si el navegador se pierde un `dragleave` (arrastrar fuera de la
    // ventana a toda prisa), el aviso no se queda pegado — `dragover` llega cada ~50 ms
    const watch = window.setInterval(() => {
      if (depth > 0 && Date.now() - lastOver > 1500) {
        depth = 0;
        setDragging(false);
      }
    }, 500);
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      lastOver = Date.now();
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      lastOver = Date.now();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer) void filesFromDrop(e.dataTransfer).then(addFiles);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.clearInterval(watch);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (input.current) input.current.value = "";
    void addFiles(files);
  }

  const allOk = !busy && errN === 0 && nofitN === 0 && savedN + dupN > 0;
  const title = busy
    ? "Guardando tus recuerdos…"
    : allOk
      ? "¡Todo a salvo!"
      : savedN + dupN > 0
        ? "Casi todo a salvo"
        : "No se ha podido guardar";
  const subtitle = busy
    ? `${Math.min(settledN + 1, real.length)} de ${real.length}`
    : [
        savedN ? `${savedN} ${savedN === 1 ? "archivo guardado" : "archivos guardados"}` : "",
        dupN ? `${dupN} ya ${dupN === 1 ? "lo tenías" : "los tenías"}` : "",
        errN ? `${errN} con error` : "",
        nofitN ? `${nofitN} no ${nofitN === 1 ? "cabe" : "caben"}` : "",
        skipN ? `${skipN} no ${skipN === 1 ? "es" : "son"} foto, vídeo ni audio` : "",
      ]
        .filter(Boolean)
        .join(" · ");

  const STATE_TEXT = (j: Job): string => {
    switch (j.phase) {
      case "wait": return "En cola";
      case "upload": return j.note ?? `${j.pct}%`;
      case "process": return "Guardando…";
      case "done": return "Guardado";
      case "dup": return "Ya lo tenías";
      case "nofit": return "No cabe";
      case "skip": return "Omitido";
      default: return "Error";
    }
  };

  const panel = open && mounted && (
    <>
      {/* minimizado: una píldora con el progreso, siempre al alcance */}
      {min && busy && (
        <motion.button
          type="button"
          className="up-pill"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => setMin(false)}
          aria-label="Ver la subida"
        >
          <span className="up-pill-ring" style={{ ["--p" as string]: `${overall}%` }} aria-hidden="true" />
          Subiendo {Math.min(settledN + 1, real.length)}/{real.length} · {overall}%
        </motion.button>
      )}

      {!(min && busy) && (
        <motion.div className="up-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className="up-card"
            role="dialog"
            aria-label="Subida de archivos"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
          >
            <div className="up-head">
              {allOk && (
                <motion.span
                  className="up-check"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 380, damping: 14 }}
                  aria-hidden="true"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                </motion.span>
              )}
              <div className="up-titles">
                <h3>{title}</h3>
                <p>{subtitle}</p>
              </div>
              {busy && <span className="up-pct">{overall}%</span>}
            </div>

            {busy && (
              <div className="up-track" role="progressbar" aria-valuenow={overall} aria-valuemin={0} aria-valuemax={100}>
                <motion.div className="up-fill" animate={{ width: `${overall}%` }} transition={{ type: "spring", stiffness: 120, damping: 24 }} />
              </div>
            )}

            <ul className="up-list">
              {jobs.map((j) => (
                <li key={j.id} className={`up-item ${j.phase}`}>
                  <span className="up-name" title={j.name}>{j.name}</span>
                  <span className="up-state">{STATE_TEXT(j)}</span>
                  {(j.phase === "upload" || j.phase === "process" || j.phase === "wait") && (
                    <button type="button" className="up-x" onClick={() => cancel(j)} aria-label={`Cancelar ${j.name}`}>×</button>
                  )}
                  {j.phase !== "skip" && j.phase !== "nofit" && (
                    <div className="up-mini">
                      <motion.div
                        className="up-mini-fill"
                        animate={{ width: `${j.phase === "done" || j.phase === "dup" || j.phase === "error" ? 100 : j.pct}%` }}
                        transition={{ type: "spring", stiffness: 140, damping: 22 }}
                      />
                    </div>
                  )}
                  {j.error && (j.phase === "error" || j.phase === "nofit" || j.phase === "skip") && <span className="up-err">{j.error}</span>}
                  {j.degraded && <span className="up-degraded">El iPhone lo ha bajado a ~{j.fps} fps al elegirlo desde Fotos.</span>}
                </li>
              ))}
            </ul>

            {anyDegraded && (
              <p className="up-hint up-warn">
                <b>Para el vídeo exacto, tal cual sale del iPhone:</b> en Fotos, ábrelo → Compartir → <b>Guardar en Archivos</b>, y aquí
                pulsa <b>Subir → Explorar</b> y elígelo de Archivos.
              </p>
            )}

            {nofitN > 0 && !busy && (
              <p className="up-hint up-nudge">
                Te falta espacio. <Link href="/app/espacio">Consigue más con un código, invitando a un amigo o con un plan →</Link>
              </p>
            )}

            <div className="up-actions">
              {busy ? (
                <button className="btn ghost sm" type="button" onClick={() => setMin(true)}>Seguir navegando</button>
              ) : (
                <>
                  {(errN > 0 || nofitN > 0) && (
                    <button className="btn sm" type="button" onClick={retryFailed}>Reintentar</button>
                  )}
                  {savedN > 0 && (
                    <Link className="btn primary sm" href="/app?sort=added" onClick={close}>Ver lo que acabas de subir</Link>
                  )}
                  <button className="btn ghost sm" type="button" onClick={close}>Cerrar</button>
                </>
              )}
            </div>
            {busy && <p className="up-hint">No cierres esta pestaña hasta que termine. Puedes seguir usando Upscale.</p>}
          </motion.div>
        </motion.div>
      )}
    </>
  );

  return (
    <>
      {/* Sin `accept` a propósito: con uno, Windows a veces esconde archivos del iPhone (HEIC,
          Live Photos…) antes de que la app los vea. Lo que no sea foto, vídeo o audio se avisa aquí. */}
      <input ref={input} type="file" multiple hidden onChange={onPick} />
      <motion.button
        className="upload"
        type="button"
        onClick={() => (busy && open ? setMin(false) : busy ? setOpen(true) : input.current?.click())}
        whileTap={{ scale: 0.94 }}
        whileHover={{ y: -1 }}
        transition={{ type: "spring", stiffness: 500, damping: 28 }}
      >
        <motion.svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"
          animate={busy ? { y: [0, -3, 0] } : { y: 0 }}
          transition={busy ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        >
          <path d="M12 19V5m0 0-6 6m6-6 6 6" />
        </motion.svg>
        {busy ? `Subiendo ${overall}%` : "Subir"}
      </motion.button>

      {mounted &&
        createPortal(
          <>
            <AnimatePresence>{dragging && (
              <motion.div className="up-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden="true">
                <div className="up-drop-box">
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5m0 0-6 6m6-6 6 6" /></svg>
                  <b>Suelta aquí para guardar</b>
                  <span>Fotos, vídeos y audio. También carpetas.</span>
                </div>
              </motion.div>
            )}</AnimatePresence>
            <AnimatePresence>{panel}</AnimatePresence>
            {pedir && (
              <div className="nmodal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setPedir(false)}>
                <div className="nmodal-box" role="dialog" aria-modal="true" aria-label="Subir archivos">
                  <h2>¿Qué quieres guardar?</h2>
                  <p className="nmodal-sub">Fotos, vídeos y música. Puedes elegir muchos a la vez.</p>
                  <div className="nmodal-acts">
                    <button type="button" className="btn ghost" onClick={() => setPedir(false)}>Ahora no</button>
                    <button
                      type="button"
                      className="btn primary"
                      autoFocus
                      onClick={() => {
                        setPedir(false);
                        input.current?.click();
                      }}
                    >
                      Elegir archivos
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>,
          document.body,
        )}
    </>
  );
}
