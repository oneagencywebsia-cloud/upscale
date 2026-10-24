"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/lib/dialog";
import { FONDOS, scriptScriptable, urlDibujo, type Widget } from "@/lib/widgets";
import Opciones from "./Opciones";

type Modo = "widget" | "fondo" | "marco";
type Aparato = "iphone" | "android";

function Copiar({ texto, etiqueta, grande = false }: { texto: string; etiqueta: string; grande?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={`btn${grande ? " primary" : " sm"}`}
      onClick={() => {
        navigator.clipboard?.writeText(texto).then(() => { setOk(true); window.setTimeout(() => setOk(false), 2200); }).catch(() => {});
      }}
    >
      {ok ? "¡Copiado!" : etiqueta}
    </button>
  );
}

function Paso({ n, texto, children }: { n: number; texto: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="id-paso">
      <span className="id-n" aria-hidden="true">{n}</span>
      <div>
        <p>{texto}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * «Ponlo en tu pantalla»: tres caminos, de lo más fácil a lo más completo.
 * Widget (iPhone con Scriptable / Android con una app de widgets), Fondo de pantalla y Marco de fotos.
 * En el móvil es una hoja a pantalla completa, con pasos numerados y botones grandes.
 */
export default function InstallDialog({ widget, onClose }: { widget: Widget; onClose: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>(true);
  const [origen, setOrigen] = useState("");
  const [modo, setModo] = useState<Modo>("fondo");
  const [aparato, setAparato] = useState<Aparato>("iphone");
  const [fondo, setFondo] = useState<string>("iphone");
  const [libre, setLibre] = useState(true);
  const [segundos, setSegundos] = useState(20);
  const [reloj, setReloj] = useState(true);

  useEffect(() => {
    setOrigen(window.location.origin);
    const android = /Android/.test(navigator.userAgent);
    setAparato(android ? "android" : "iphone");
    setFondo(android ? "android" : "iphone");
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const script = useMemo(() => (origen ? scriptScriptable(origen, widget) : ""), [origen, widget]);
  const f = FONDOS.find((x) => x.id === fondo) ?? FONDOS[0]!;
  const urlFondo = `/api/widgets/${widget.id}/image?w=${f.w}&h=${f.h}${libre ? "&wallpaper=1" : ""}&download=1`;
  const urlMarco = origen ? `${origen}/w/${widget.token}?seg=${segundos}${reloj ? "&reloj=1" : ""}` : "";

  return createPortal(
    <div className="nmodal id-modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nmodal-box wide id-box" role="dialog" aria-modal="true" aria-label="Ponlo en tu pantalla" tabIndex={-1} ref={ref}>
        <div className="id-cab">
          <div>
            <h2>Ponlo en tu pantalla</h2>
            <p>«{widget.name}» se pone al día solo.</p>
          </div>
          <button type="button" className="btn primary sm" onClick={onClose}>Listo</button>
        </div>

        <div className="id-cuerpo">
          <Opciones
            etiqueta="Cómo quieres verlo"
            valor={modo}
            opciones={[["fondo", "Fondo de pantalla"], ["widget", "Pantalla de inicio"], ["marco", "Marco de fotos"]]}
            onChange={setModo}
            columnas={3}
          />

          {modo === "fondo" && (
            <div className="id-panel">
              <p className="id-lead">Lo más fácil: una imagen que pones de fondo y listo.</p>
              <label className="wb-campo">
                <span>Tu aparato</span>
                <select className="id-sel" value={fondo} onChange={(e) => setFondo(e.target.value)} aria-label="Tamaño del fondo">
                  {FONDOS.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </label>
              <label className="wb-check"><input type="checkbox" checked={libre} onChange={(e) => setLibre(e.target.checked)} /> Dejar libre arriba, para el reloj de la pantalla de bloqueo</label>
              <div className="id-fondo">
                <img src={`/api/widgets/${widget.id}/image?w=${Math.round(f.w / 6)}&h=${Math.round(f.h / 6)}${libre ? "&wallpaper=1" : ""}`} alt="Vista previa del fondo de pantalla" width={Math.round(f.w / 6)} height={Math.round(f.h / 6)} />
              </div>
              <a className="btn primary id-grande" href={urlFondo} download>Descargar el fondo</a>
              <p className="wb-ayuda">Después ábrela y elige <b>Usar como fondo de pantalla</b> (iPhone: en Fotos, botón Compartir · Android: en la Galería, ⋮ → Establecer como).</p>
            </div>
          )}

          {modo === "widget" && (
            <div className="id-panel">
              <Opciones etiqueta="Tu aparato" valor={aparato} opciones={[["iphone", "iPhone"], ["android", "Android"]]} onChange={setAparato} columnas={2} />
              {aparato === "iphone" ? (
                <ol className="id-pasos">
                  <Paso n={1} texto={<><b>Instala Scriptable</b> (es gratis).</>}>
                    <a className="btn id-grande" href="https://apps.apple.com/app/scriptable/id1405459188" target="_blank" rel="noopener noreferrer">Abrir en la App Store</a>
                  </Paso>
                  <Paso n={2} texto={<><b>Copia el código</b> de este elemento.</>}>
                    <Copiar texto={script} etiqueta="Copiar el código" grande />
                  </Paso>
                  <Paso n={3} texto={<><b>Pégalo en Scriptable</b>: ábrela, pulsa <b>+</b>, pega y guarda.</>}>
                    <a className="btn id-grande" href="scriptable:///">Abrir Scriptable</a>
                  </Paso>
                  <Paso n={4} texto={<><b>Colócalo</b>: mantén pulsado un hueco de la pantalla de inicio → <b>+</b> → <b>Scriptable</b> → elige el tamaño → <b>Añadir</b>. Toca el widget, después <b>Script</b>, y elige el tuyo.</>} />
                </ol>
              ) : (
                <ol className="id-pasos">
                  <Paso n={1} texto={<>En Android hace falta una app gratuita que enseñe una <b>imagen de internet</b>, por ejemplo <b>KWGT</b>.</>}>
                    <a className="btn id-grande" href="https://play.google.com/store/apps/details?id=org.kustom.widget" target="_blank" rel="noopener noreferrer">Ver KWGT en Google Play</a>
                  </Paso>
                  <Paso n={2} texto={<><b>Copia la dirección</b> del tamaño que quieras y pégala en la app:</>}>
                    <ul className="id-urls">
                      {(["small", "medium", "large"] as const).map((t) => (
                        <li key={t}>
                          <span>{t === "small" ? "Pequeño" : t === "medium" ? "Mediano" : "Grande"}</span>
                          {origen && <Copiar texto={urlDibujo(origen, widget.token, t)} etiqueta="Copiar" />}
                        </li>
                      ))}
                    </ul>
                  </Paso>
                  <Paso n={3} texto={<>Sin apps extra: usa <b>Fondo de pantalla</b> o <b>Marco de fotos</b>.</>} />
                </ol>
              )}
            </div>
          )}

          {modo === "marco" && (
            <div className="id-panel">
              <p className="id-lead">Una pantalla completa que cambia sola y no se apaga. Ideal para un móvil o tableta viejos.</p>
              <label className="wb-campo sp-range"><span>Cambia cada <b>{segundos} segundos</b></span><input type="range" min={5} max={120} step={5} value={segundos} onChange={(e) => setSegundos(Number(e.target.value))} /></label>
              <label className="wb-check"><input type="checkbox" checked={reloj} onChange={(e) => setReloj(e.target.checked)} /> Mostrar la hora</label>
              {urlMarco && <a className="btn primary id-grande" href={urlMarco} target="_blank" rel="noopener noreferrer">Abrir el marco</a>}
              {urlMarco && <Copiar texto={urlMarco} etiqueta="Copiar el enlace para otro aparato" />}
              <p className="wb-ayuda">Ábrelo en el aparato del marco y pulsa <b>Añadir a pantalla de inicio</b> para tenerlo como una app.</p>
            </div>
          )}

          <p className="id-aviso">🔒 Quien tenga este enlace ve <b>solo esto</b>, no tu cuenta ni tus archivos originales. Si lo compartes sin querer, en «En mi pantalla» toca <b>⋯ → Crear un enlace nuevo</b> y el anterior deja de funcionar.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
