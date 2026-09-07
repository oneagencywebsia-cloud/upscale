"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UploadToken } from "@upscale/shared";

export default function TokenManager({ initialTokens }: { initialTokens: UploadToken[] }) {
  const router = useRouter();
  const [tokens, setTokens] = useState(initialTokens);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/tokens", { method: "POST" });
      const data = (await res.json()) as { token?: string };
      if (data.token) {
        setFresh(data.token);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    setTokens((t) => t.filter((x) => x.id !== id));
  }

  return (
    <div className="tokenmgr">
      {fresh && (
        <div className="token-fresh">
          <code>{fresh}</code>
          <button className="btn sm" type="button" onClick={() => navigator.clipboard?.writeText(fresh)}>
            Copiar
          </button>
          <small>Cópialo ahora — no se vuelve a mostrar entero.</small>
        </div>
      )}

      <button className="btn primary sm" type="button" disabled={busy} onClick={create}>
        {busy ? "Creando…" : "Crear token"}
      </button>

      {tokens.length > 0 && (
        <ul className="token-list">
          {tokens.map((t) => (
            <li key={t.id}>
              <code>{t.preview}</code>
              <span>{t.label ?? "iPhone"}</span>
              <span className="muted">
                {t.last_used ? `usado ${new Date(t.last_used).toLocaleDateString("es-ES")}` : "sin usar"}
              </span>
              <button className="btn ghost sm" type="button" onClick={() => remove(t.id)}>
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
