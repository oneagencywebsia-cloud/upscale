"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/lib/dialog";
import { scriptScriptable, urlDibujo, type Widget } from "@/lib/widgets";

type Aparato = "iphone" | "android" | "otro";

/** Detecta el aparato solo: la persona nunca tiene que decir qué móvil tiene. */
function detectarAparato(): Aparato {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  const ipadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || ipadOs) return "iphone";
  return "otro";
}

function Copiar({ texto, etiqueta, grande = false, alCopiar }: { texto: string; etiqueta: string; grande?: boolean; alCopiar?: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={`btn${grande ? " primary id-grande" : " sm"}`}
      onClick={() => {
        navigator.clipboard
          ?.writeText(texto)
          .then(() => {
            setOk(true);
            window.setTimeout(() => setOk(false), 2200);
            alCopiar?.();
          })
          .catch(() => {});
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
 * «Ponlo en tu pantalla». Se adapta solo al aparato: en iPhone, tres pasos con Scriptable
 * (gratis); en Android, una app de widgets gratuita; en ordenador, se explica que se hace desde el móvil.
 * El widget se pone al día solo: cada vez que el móvil lo pide, el servidor lo dibuja con los datos de ese momento.
 */
export default function InstallDialog({ widget, onClose }: { widget: Widget; onClose: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>(true);
  const [origen, setOrigen] = useState("");
  const [aparato, setAparato] = useState<Aparato>("otro");

  useEffect(() => {
    setOrigen(window.location.origin);
    setAparato(detectarAparato());
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
          {aparato === "iphone" && (
            <ol className="id-pasos">
              <Paso n={1} texto={<><b>Instala Scriptable</b>. Es una app gratuita que enseña widgets.</>}>
                <a className="btn id-grande" href="https://apps.apple.com/app/scriptable/id1405459188" target="_blank" rel="noopener noreferrer">Abrir en la App Store</a>
              </Paso>
              <Paso n={2} texto={<>Toca el botón: <b>copia el código</b> y abre Scriptable. Allí pulsa <b>+</b>, <b>pega</b> y vuelve atrás.</>}>
                <Copiar texto={script} etiqueta="Copiar código y abrir Scriptable" grande alCopiar={() => { window.location.href = "scriptable:///"; }} />
              </Paso>
              <Paso n={3} texto={<>Mantén pulsado un hueco de la pantalla de inicio → <b>+</b> → <b>Scriptable</b> → <b>Añadir</b>. Toca el widget, en <b>Script</b> elige este y listo.</>} />
            </ol>
          )}

          {aparato === "android" && (
            <ol className="id-pasos">
              <Paso n={1} texto={<>Instala <b>KWGT</b>, una app gratuita que enseña widgets.</>}>
                <a className="btn id-grande" href="https://play.google.com/store/apps/details?id=org.kustom.widget" target="_blank" rel="noopener noreferrer">Abrir en Google Play</a>
              </Paso>
              <Paso n={2} texto={<>Copia el enlace del tamaño que quieras y pégalo en KWGT como imagen de internet:</>}>
                <ul className="id-urls">
                  {(["small", "medium", "large"] as const).map((t) => (
                    <li key={t}>
                      <span>{t === "small" ? "Pequeño" : t === "medium" ? "Mediano" : "Grande"}</span>
                      {origen && <Copiar texto={urlDibujo(origen, widget.token, t)} etiqueta="Copiar" />}
                    </li>
                  ))}
                </ul>
              </Paso>
              <Paso n={3} texto={<>Mantén pulsado un hueco de la pantalla de inicio → <b>Widgets</b> → <b>KWGT</b> → elige el tamaño.</>} />
            </ol>
          )}

          {aparato === "otro" && (
            <div className="id-panel">
              <p className="id-lead">Los widgets se ponen desde el móvil.</p>
              <p className="wb-ayuda">Abre Upscale en tu móvil, entra en <b>En mi pantalla</b>, toca los tres puntos de este elemento y elige <b>Poner en mi pantalla</b>. Te guiamos allí en tres pasos.</p>
            </div>
          )}

          <p className="id-aviso">🔒 Quien tenga este enlace ve <b>solo esto</b>, no tu cuenta ni tus archivos originales. Si lo compartes sin querer, en «En mi pantalla» toca <b>⋯ → Crear un enlace nuevo</b> y el anterior deja de funcionar.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
