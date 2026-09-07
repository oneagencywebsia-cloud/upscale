"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AssetListItem } from "@upscale/shared";
import { bytesHuman } from "@/lib/format";

const D = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" });

export default function SpaceManager({ biggest }: { biggest: AssetListItem[] }) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  async function del(a: AssetListItem) {
    if (!confirm(`Borrar ${a.filename} (${bytesHuman(a.bytes)})? Es definitivo.`)) return;
    setBusy(a.id);
    const res = await fetch(`/api/assets/${a.id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) {
      setGone((g) => new Set(g).add(a.id));
      router.refresh();
    }
  }

  const list = biggest.filter((a) => !gone.has(a.id));
  if (!list.length) return <div className="empty"><p>Nada que mostrar.</p></div>;

  return (
    <ul className="space-list">
      {list.map((a) => (
        <li key={a.id}>
          <img src={a.thumbUrl} alt="" loading="lazy" />
          <div className="space-meta">
            <b>{a.filename}</b>
            <span>
              {bytesHuman(a.bytes)} · {a.kind === "video" ? "vídeo" : "foto"} · {D.format(new Date(a.capturedAt))}
            </span>
          </div>
          <button className="btn ghost sm" type="button" disabled={busy === a.id} onClick={() => del(a)}>
            {busy === a.id ? "…" : "Borrar"}
          </button>
        </li>
      ))}
    </ul>
  );
}
