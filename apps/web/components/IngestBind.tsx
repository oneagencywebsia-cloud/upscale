"use client";

import { useEffect, useState } from "react";

type State = { isYou: boolean; canBind: boolean } | null;

interface Envio {
  t: string;
  msgId: number;
  filename: string;
  bytes: number;
  resultado: "nuevo" | "duplicado" | "error" | "omitido" | "sin_usuario" | "aplazado";
  detalle?: string;
}

const ETIQUETA: Record<Envio["resultado"], { txt: string; clase: string }> = {
  nuevo: { txt: "Nuevo ✓", clase: "ok" },
  duplicado: { txt: "Ya estaba", clase: "dup" },
  error: { txt: "Error (reintenta)", clase: "bad" },
  omitido: { txt: "Omitido", clase: "bad" },
  sin_usuario: { txt: "Sin cuenta", clase: "bad" },
  aplazado: { txt: "Aplazado", clase: "dup" },
};

const FECHA = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

/** Qué pasó con lo último que mandaste por Telegram: nuevo, ya estaba (y cuál es), o error. */
function EnviosRecientes() {
  const [items, setItems] = useState<Envio[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function cargar() {
    setBusy(true);
    try {
      const r = await fetch("/api/ingest-status", { cache: "no-store" });
      if (r.ok) {
        const d = (await r.json()) as { recent?: Envio[]; totalImported?: number };
        setItems(d.recent ?? []);
        setTotal(d.totalImported ?? null);
      }
    } catch {
      /* sin conexión: se queda como estaba */
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void cargar();
  }, []);

  return (
    <div className="envios">
      <div className="envios-head">
        <b>Lo último que llegó por Telegram</b>
        <button className="btn ghost sm" type="button" onClick={cargar} disabled={busy}>
          {busy ? "…" : "Actualizar"}
        </button>
      </div>
      {items === null ? (
        <small className="muted">Cargando…</small>
      ) : items.length === 0 ? (
        <small className="muted">
          Todavía no ha llegado nada desde el último reinicio. Manda un archivo «como archivo» a Mensajes guardados y toca Actualizar.
        </small>
      ) : (
        <ul>
          {items.slice(0, 12).map((e) => {
            const et = ETIQUETA[e.resultado];
            return (
              <li key={`${e.msgId}-${e.t}`}>
                <span className={`envio-badge ${et.clase}`}>{et.txt}</span>
                <span className="envio-name">{e.filename}</span>
                <small>
                  {FECHA.format(new Date(e.t))} · {mb(e.bytes)}
                  {e.resultado !== "nuevo" && e.detalle ? ` · ${e.detalle}` : ""}
                </small>
              </li>
            );
          })}
        </ul>
      )}
      {total !== null && <small className="muted">Procesados desde el último reinicio: {total}</small>}
    </div>
  );
}

export default function IngestBind() {
  const [state, setState] = useState<State>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/ingest-bind", { cache: "no-store" });
      if (r.ok) setState(await r.json());
      else if (r.status === 403) setState({ isYou: false, canBind: false });
    } catch {
      /* ignora */
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function bind() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/ingest-bind", { method: "POST" });
      if (!r.ok) throw new Error(String(r.status));
      await load();
    } catch {
      setErr("No se pudo. Solo el administrador puede cambiarlo.");
    } finally {
      setBusy(false);
    }
  }

  // Solo el administrador lo ve: la ingesta de Telegram es global del servidor.
  if (state && !state.isYou && !state.canBind) return null;

  return (
    <div className="ingestbind">
      {state?.isYou ? (
        <p className="ok">✓ Los vídeos que envíes por Telegram llegan a esta cuenta.</p>
      ) : (
        <>
          <button className="btn primary sm" type="button" disabled={busy} onClick={bind}>
            {busy ? "Atando…" : "Recibir aquí los vídeos de Telegram"}
          </button>
          {state && !state.isYou && state.canBind && (
            <small className="muted"> (ahora puede que lleguen a otra cuenta)</small>
          )}
        </>
      )}
      {err && <small className="muted"> {err}</small>}
      {state?.isYou && <EnviosRecientes />}
    </div>
  );
}
