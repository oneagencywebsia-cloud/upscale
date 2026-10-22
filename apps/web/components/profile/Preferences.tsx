"use client";

import { useEffect, useState } from "react";
import { formatoCompatible, guardarFormatoCompatible } from "@/lib/download";

type Theme = "system" | "light" | "dark";
const THEMES: { key: Theme; label: string }[] = [
  { key: "system", label: "Sistema" },
  { key: "light", label: "Claro" },
  { key: "dark", label: "Oscuro" },
];
const DENSITIES = ["Grandes", "Medias", "Pequeñas"];

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* modo privado: la preferencia vale solo para esta sesión */
  }
};

/** Preferencias de ESTE dispositivo (se guardan en el navegador). */
export default function Preferences() {
  const [theme, setTheme] = useState<Theme>("system");
  const [density, setDensity] = useState(1);
  const [motionOn, setMotionOn] = useState(true);
  const [dlCompat, setDlCompat] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = read("upscale-theme");
    setTheme(t === "light" || t === "dark" ? t : "system");
    const d = Number(read("upscale-density"));
    setDensity(d === 0 || d === 1 || d === 2 ? d : 1);
    setMotionOn(read("upscale-motion") !== "off");
    setDlCompat(formatoCompatible());
    setReady(true);
  }, []);

  function pickTheme(t: Theme) {
    setTheme(t);
    const root = document.documentElement;
    if (t === "system") {
      root.removeAttribute("data-theme");
      write("upscale-theme", null);
    } else {
      root.setAttribute("data-theme", t);
      write("upscale-theme", t);
    }
  }
  function pickDensity(i: number) {
    setDensity(i);
    write("upscale-density", String(i));
  }
  function toggleMotion(on: boolean) {
    setMotionOn(on);
    const root = document.documentElement;
    if (on) {
      root.removeAttribute("data-motion");
      write("upscale-motion", null);
    } else {
      root.setAttribute("data-motion", "off");
      write("upscale-motion", "off");
    }
  }

  return (
    <div className="psec" aria-busy={!ready}>
      <div className="prow">
        <div>
          <b>Tema</b>
          <small>Claro, oscuro o el de tu dispositivo.</small>
        </div>
        <div className="seg" role="group" aria-label="Tema">
          {THEMES.map((t) => (
            <button key={t.key} type="button" className={theme === t.key ? "on" : ""} aria-pressed={theme === t.key} onClick={() => pickTheme(t.key)}>
              <span className="seg-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="prow">
        <div>
          <b>Formato de las descargas</b>
          <small>
            «Compatible» se abre en cualquier aparato (fotos HEIC → JPG, vídeos HEVC → MP4, audios raros → MP3). «Original» es el
            archivo exacto.
          </small>
        </div>
        <div className="seg" role="group" aria-label="Formato de las descargas">
          {[
            { v: true, label: "Compatible" },
            { v: false, label: "Original" },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              className={dlCompat === o.v ? "on" : ""}
              aria-pressed={dlCompat === o.v}
              onClick={() => {
                setDlCompat(o.v);
                guardarFormatoCompatible(o.v);
              }}
            >
              <span className="seg-label">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="prow">
        <div>
          <b>Tamaño de las fotos</b>
          <small>Con el que se abre la biblioteca.</small>
        </div>
        <div className="seg" role="group" aria-label="Tamaño de las fotos">
          {DENSITIES.map((l, i) => (
            <button key={l} type="button" className={density === i ? "on" : ""} aria-pressed={density === i} onClick={() => pickDensity(i)}>
              <span className="seg-label">{l}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="prow">
        <div>
          <b>Animaciones</b>
          <small>Fondo en movimiento y transiciones de pantalla. Apágalas para ahorrar batería.</small>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={motionOn}
          aria-label="Animaciones"
          className={`switch ${motionOn ? "on" : ""}`}
          onClick={() => toggleMotion(!motionOn)}
        >
          <span />
        </button>
      </div>
    </div>
  );
}
