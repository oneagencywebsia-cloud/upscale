"use client";

import { useState } from "react";

type Problema = { codigo: string; titulo: string; detalle: string; n: number; ejemplos: { id: string; nombre: string }[]; arreglable: boolean };
type Informe = {
  resumen: { total: number; fotos: number; videos: number; audios: number };
  problemas: Problema[];
  muestra: { probados: number; fallidos: number; items: { nombre: string; tipo: string; ok: boolean; ms: number; motivo?: string; tecnico?: string }[] };
  servidor: { almacen: string; minutosEncendido: number; cacheArchivos: number; cacheMB: number };
};

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString("es-ES")} ${n === 1 ? uno : varios}`;

/**
 * «Revisar mis archivos»: cuando algo no carga o da error al descargar, prueba una muestra real y lo explica
 * en cristiano. Solo lee; «Arreglar» es un botón aparte (ver api/routes/filecheck.ts).
 */
export default function FileCheck() {
  const [estado, setEstado] = useState<"quieto" | "revisando" | "listo" | "error">("quieto");
  const [informe, setInforme] = useState<Informe | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [arreglando, setArreglando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function revisar() {
    setEstado("revisando");
    setResultado(null);
    setAviso(null);
    try {
      const r = await fetch("/api/files/check", { cache: "no-store" });
      const data = (await r.json().catch(() => ({}))) as Informe & { error?: string };
      if (!r.ok) {
        setAviso(data.error ?? "No se pudo revisar ahora mismo. Inténtalo en un minuto.");
        setEstado("error");
        return;
      }
      setInforme(data);
      setEstado("listo");
    } catch {
      setAviso("No se pudo revisar ahora mismo. Inténtalo en un minuto.");
      setEstado("error");
    }
  }

  async function arreglar() {
    setArreglando(true);
    try {
      const r = await fetch("/api/files/repair", { method: "POST" });
      const d = (await r.json().catch(() => ({}))) as { previewsReabiertas?: number; danadosReintentados?: number };
      if (!r.ok) throw new Error("fallo");
      const partes = [
        d.previewsReabiertas ? `${plural(d.previewsReabiertas, "vídeo", "vídeos")} vuelven a prepararse` : "",
        d.danadosReintentados ? `${plural(d.danadosReintentados, "archivo", "archivos")} vuelven a intentarse` : "",
      ].filter(Boolean);
      setResultado(partes.length ? `Hecho: ${partes.join(" y ")}. Tarda un rato en segundo plano; vuelve a revisar en unos minutos.` : "No había nada que reintentar.");
    } catch {
      setResultado("No se pudo completar. Inténtalo de nuevo.");
    } finally {
      setArreglando(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(informe, null, 2));
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2200);
    } catch {
      /* sin portapapeles */
    }
  }

  const fallos = informe?.muestra.items.filter((i) => !i.ok) ?? [];
  const lentos = informe ? informe.muestra.items.filter((i) => i.ok && i.ms > 6000).length : 0;
  const reciente = informe ? informe.servidor.minutosEncendido < 180 && informe.servidor.cacheArchivos < 100 : false;
  const hayArreglo = informe?.problemas.some((p) => p.arreglable) ?? false;

  return (
    <div className="filecheck">
      <button type="button" className="btn primary" onClick={revisar} disabled={estado === "revisando"}>
        {estado === "revisando" ? "Revisando… unos segundos" : informe ? "Volver a revisar" : "Revisar ahora"}
      </button>
      {aviso && <p className="panel-lede" role="alert">{aviso}</p>}

      {informe && estado === "listo" && (
        <div className="fc-informe" aria-live="polite">
          <p className="panel-lede">
            Tienes <b>{plural(informe.resumen.total, "archivo", "archivos")}</b> ({plural(informe.resumen.fotos, "foto", "fotos")}, {plural(informe.resumen.videos, "vídeo", "vídeos")} y {plural(informe.resumen.audios, "audio", "audios")}).
          </p>

          <h4>Prueba real</h4>
          <p className="panel-lede">
            Abrimos {plural(informe.muestra.probados, "archivo", "archivos")} al azar en el almacén:{" "}
            <b>{informe.muestra.probados - informe.muestra.fallidos} bien</b>
            {informe.muestra.fallidos ? <>, <b>{informe.muestra.fallidos} con error</b></> : null}.
            {lentos > 0 && ` ${plural(lentos, "tardó", "tardaron")} más de 6 segundos.`}
          </p>
          {fallos.length > 0 && (
            <ul className="fc-lista">
              {fallos.map((f, i) => (
                <li key={i}><b>{f.nombre}</b> — {f.motivo}</li>
              ))}
            </ul>
          )}

          {informe.problemas.length > 0 && (
            <>
              <h4>Lo que hemos encontrado</h4>
              <ul className="fc-lista">
                {informe.problemas.map((p) => (
                  <li key={p.codigo}>
                    <b>{plural(p.n, "archivo", "archivos")}: {p.titulo.toLowerCase()}.</b> {p.detalle}
                    {p.ejemplos.length > 0 && <small> Por ejemplo: {p.ejemplos.map((e) => e.nombre).join(", ")}.</small>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {reciente && (
            <p className="panel-lede">
              <b>El servidor se ha reiniciado hace poco</b> ({informe.servidor.minutosEncendido} min) y su memoria rápida está casi vacía: mientras se vuelve a llenar, las miniaturas y las descargas tardan más. Suele pasar justo después de actualizar la web.
            </p>
          )}
          {informe.problemas.length === 0 && fallos.length === 0 && !reciente && (
            <p className="panel-lede">No hemos encontrado nada raro. Si sigue fallando, copia el informe y envíanoslo.</p>
          )}

          <div className="fc-acciones">
            {hayArreglo && (
              <button type="button" className="btn" onClick={arreglar} disabled={arreglando}>
                {arreglando ? "Reintentando…" : "Arreglar lo que se pueda"}
              </button>
            )}
            <button type="button" className="btn ghost" onClick={copiar}>{copiado ? "¡Copiado!" : "Copiar informe"}</button>
          </div>
          {resultado && <p className="panel-lede" role="status">{resultado}</p>}
        </div>
      )}
    </div>
  );
}
