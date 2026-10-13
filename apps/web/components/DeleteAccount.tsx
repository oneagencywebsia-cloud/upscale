"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Borrar la cuenta, en dos pasos y escribiendo BORRAR: es irreversible. */
export default function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/delete-account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: text }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(j.error ?? "No se pudo borrar. Inténtalo de nuevo.");
        setBusy(false);
        return;
      }
      await supabaseBrowser().auth.signOut();
      router.push("/?adios=1");
      router.refresh();
    } catch {
      setErr("Sin conexión. Inténtalo de nuevo.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn danger" onClick={() => setOpen(true)}>
        Borrar mi cuenta…
      </button>
    );
  }

  return (
    <form className="danger-form" onSubmit={go}>
      <p>
        Se borrarán <b>todas tus fotos, vídeos y audios</b>, tus álbumes y tus datos. No se puede deshacer.
        Si quieres conservarlos, descárgalos antes.
      </p>
      <label>
        Para confirmar, escribe <b>BORRAR</b>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="BORRAR"
        />
      </label>
      <div className="danger-actions">
        <button type="button" className="btn ghost" onClick={() => { setOpen(false); setText(""); setErr(null); }} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="btn danger" disabled={busy || text.trim().toUpperCase() !== "BORRAR"}>
          {busy ? "Borrando…" : "Borrar todo para siempre"}
        </button>
      </div>
      {err && <p className="plan-msg err" role="alert">{err}</p>}
    </form>
  );
}
