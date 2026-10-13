"use client";

import { useEffect, useState } from "react";

type State = { isYou: boolean; canBind: boolean } | null;

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
    </div>
  );
}
