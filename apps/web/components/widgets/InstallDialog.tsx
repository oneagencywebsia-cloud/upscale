"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/lib/dialog";
import { FONDOS, scriptScriptable, urlDibujo, type Widget } from "@/lib/widgets";

type Pestana = "iphone" | "android" | "fondo" | "marco";

function Copiar({ texto, etiqueta, grande = false }: { texto: string; etiqueta: string; grande?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={`btn ${grande ? "primary" : "sm"}`}
      onClick={() => {
        navigator.clipboard?.writeText(texto).then(() => { setOk(true); window.setTimeout(() => setOk(false), 2000); }).catch(() => {});
      }}
    >
      {ok ? "¡Copiado!" : etiqueta}
    </button>
  );
}

/** Cómo poner el widget donde se ve: iPhone, Android, fondo de pantalla o marco de fotos. */
export default function InstallDialog({ widget, onClose }: { widget: Widget; onClose: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>(true);
  const [origen, setOrigen] = useState("");
  const [tab, setTab] = useState<Pestana>("iphone");
  const [fondo, setFondo] = useState<string>("iphone");
  const [libre, setLibre] = useState(true);
  const [segundos, setSegundos] = useState(20);
  const [reloj, setReloj] = useState(true);

  useEffect(() => {
    setOrigen(window.location.origin);
    // sugerir la pestaña según el aparato
    const ua = navigator.userAgent;
    if (/Android/.test(ua)) setTab("android");
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const script = useMemo(() => (origen ? scriptScriptable(origen, widget) : ""), [origen, widget]);
  const f = FONDOS.find((x) => x.id === fondo) ?? FONDOS[0]!;
  const urlFondo = `/api/widgets/${widget.id}/image?w=${f.w}&h=${f.h}${libre ? "&wallpaper=1" : ""}&download=1`;
  const urlMarco = origen ? `${origen}/w/${widget.token}?seg=${segundos}${reloj ? "&reloj=1" : ""}` : "";

  const pestanas: [Pestana, string][] = [["iphone", "iPhone"], ["android", "Android"], ["fondo", "Fondo de pantalla"], ["marco", "Marco de fotos"]];

  return createPortal(
    <div className="nmodal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nmodal-box wide id-box" role="dialog" aria-modal="true" aria-label="Poner el widget en tu pantalla" tabIndex={-1} ref={ref}>
        <div className="nlib-head">
          <h2>Ponlo en tu pantalla</h2>
          <button type="button" className="btn sm" onClick={onClose}>Listo</button>
        </div>
        <p className="nmodal-sub">«{widget.name}» se actualiza solo: si cambias la nota, la foto o el álbum, el widget cambia con ellos.</p>

        <div className="sp-seg id-tabs" role="tablist" aria-label="Dónde ponerlo">
          {pestanas.map(([id, t]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{t}</button>
          ))}
        </div>

        <div className="id-panel" role="tabpanel">
          {tab === "iphone" && (
            <ol className="id-pasos">
              <li>Instala <b>Scriptable</b> desde la App Store (es gratis).</li>
              <li><Copiar texto={script} etiqueta="Copiar el script" grande /> y en Scriptable pulsa <b>+</b>, pega el script y ponle nombre.</li>
              <li>Mantén pulsada la pantalla de inicio → <b>+</b> → <b>Scriptable</b> → elige el tamaño y pulsa <b>Añadir widget</b>.</li>
              <li>Toca el widget nuevo → <b>Script</b> → elige el que acabas de guardar.</li>
            </ol>
          )}

          {tab === "android" && (
            <>
              <p className="natt-hint">Android no deja que una web cree widgets por sí sola. Si usas una app de widgets que muestre una <b>imagen desde una dirección de internet</b> (por ejemplo KWGT), pega la de tu tamaño:</p>
              <ul className="id-urls">
                {(["small", "medium", "large"] as const).map((t) => (
                  <li key={t}>
                    <span>{t === "small" ? "Pequeño" : t === "medium" ? "Mediano" : "Grande"}</span>
                    <code>{origen ? urlDibujo(origen, widget.token, t) : "…"}</code>
                    {origen && <Copiar texto={urlDibujo(origen, widget.token, t)} etiqueta="Copiar" />}
                  </li>
                ))}
              </ul>
              <p className="natt-hint">Sin ninguna app extra: usa la pestaña <b>Marco de fotos</b> (se añade a la pantalla de inicio desde Chrome) o <b>Fondo de pantalla</b>.</p>
            </>
          )}

          {tab === "fondo" && (
            <>
              <label className="wb-campo">
                <span>Tu aparato</span>
                <select className="tb-sel id-sel" value={fondo} onChange={(e) => setFondo(e.target.value)} aria-label="Tamaño del fondo">
                  {FONDOS.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </label>
              <label className="wb-check"><input type="checkbox" checked={libre} onChange={(e) => setLibre(e.target.checked)} /> Dejar libre la parte de arriba (para el reloj de la pantalla de bloqueo)</label>
              <div className="id-fondo">
                <img src={`/api/widgets/${widget.id}/image?w=${Math.round(f.w / 6)}&h=${Math.round(f.h / 6)}${libre ? "&wallpaper=1" : ""}`} alt="Vista previa del fondo de pantalla" width={Math.round(f.w / 6)} height={Math.round(f.h / 6)} />
              </div>
              <a className="btn primary" href={urlFondo} download>Descargar el fondo</a>
              <p className="natt-hint">Luego, en tu móvil: abre la imagen → <b>Usar como fondo de pantalla</b> (iPhone: Fotos → Compartir; Android: Galería → ⋮ → Establecer como).</p>
            </>
          )}

          {tab === "marco" && (
            <>
              <p className="natt-hint">Una pantalla completa que va cambiando sola y mantiene la pantalla encendida: ideal para un móvil o tableta viejos convertidos en marco de fotos.</p>
              <label className="wb-campo sp-range"><span>Cambiar cada <b>{segundos} s</b></span><input type="range" min={5} max={120} step={5} value={segundos} onChange={(e) => setSegundos(Number(e.target.value))} /></label>
              <label className="wb-check"><input type="checkbox" checked={reloj} onChange={(e) => setReloj(e.target.checked)} /> Mostrar la hora</label>
              <div className="id-acts">
                {urlMarco && <a className="btn primary" href={urlMarco} target="_blank" rel="noopener noreferrer">Abrir el marco</a>}
                {urlMarco && <Copiar texto={urlMarco} etiqueta="Copiar enlace" />}
              </div>
              <p className="natt-hint">Ábrelo en el aparato del marco y pulsa <b>Añadir a pantalla de inicio</b> para tenerlo como una app.</p>
            </>
          )}
        </div>

        <p className="id-aviso">🔒 Quien tenga esta dirección puede ver <b>solo este widget</b>, no tu cuenta ni tus originales. Si la compartes sin querer, en «Mis widgets» pulsa <b>Nueva dirección</b> y la anterior deja de funcionar.</p>
      </div>
    </div>,
    document.body,
  );
}
