"use client";

import { useEffect, useState } from "react";

type State = { boundTo: string | null; you: string; isYou: boolean } | null;

export default function IngestBind() {
  const [state, setState] = useState<State>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/ingest-bind", { cache: "no-store" });
      if (r.ok) setState(await r.json());
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
      setErr("No se pudo. Reintenta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ingestbind">
      {state?.isYou ? (
        <p className="ok">✓ Los vídeos que envíes por Telegram llegan a esta cuenta.</p>
      ) : (
        <>
          <button className="btn primary sm" type="button" disabled={busy} onClick={bind}>
            {busy ? "Atando…" : "Recibir aquí los vídeos de Telegram"}
          </button>
          {state && state.boundTo && !state.isYou && (
            <small className="muted"> (ahora van a otra cuenta)</small>
          )}
        </>
      )}
      {err && <small className="muted"> {err}</small>}
    </div>
  );
}
