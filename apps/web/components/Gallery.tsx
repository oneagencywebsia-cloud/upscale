"use client";

import { useMemo, useState } from "react";
import type { AssetListItem } from "@upscale/shared";
import { durationHuman, specRows } from "@/lib/format";
import TiltFrame from "./TiltFrame";

interface DayGroup {
  key: string;
  label: string;
  items: AssetListItem[];
}

export default function Gallery({
  groups,
  error,
  filter,
}: {
  groups: DayGroup[];
  error: string | null;
  filter: string;
}) {
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const [selectedId, setSelectedId] = useState<string | null>(flat[0]?.id ?? null);
  const selected = flat.find((a) => a.id === selectedId) ?? flat[0] ?? null;

  if (error) {
    return (
      <div className="empty">
        <h3>Sin conexión</h3>
        <p>{error}</p>
      </div>
    );
  }
  if (!flat.length) {
    return (
      <div className="empty">
        <h3>Tu biblioteca está vacía</h3>
        <p>Sube desde el iPhone con el Atajo (ver Ajustes), o arrastra archivos con «Subir».</p>
      </div>
    );
  }

  return (
    <div className="layout">
      <main>
        {groups.map((g) => (
          <section className="daygroup" key={g.key}>
            <h3>
              <b>{g.label}</b>
            </h3>
            <div className="grid" role="list">
              {g.items.map((a) => (
                <TiltFrame
                  key={a.id}
                  current={a.id === selected?.id}
                  label={a.filename}
                  onClick={() => setSelectedId(a.id)}
                >
                  <img src={a.thumbUrl} alt={a.filename} loading="lazy" />
                  {a.kind === "video" && (
                    <span className="badge vid">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      {durationHuman(a.durationS)}
                    </span>
                  )}
                  {a.isLive && <span className="badge live">LIVE</span>}
                </TiltFrame>
              ))}
            </div>
          </section>
        ))}
      </main>

      {selected && <Inspector asset={selected} />}
    </div>
  );
}

function Inspector({ asset }: { asset: AssetListItem }) {
  const rows = specRows(asset);
  return (
    <aside className="inspector" aria-live="polite">
      <div className="preview">
        <img src={asset.posterUrl ?? asset.thumbUrl} alt={asset.filename} />
        {asset.kind === "video" && (
          <div className="play">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
      </div>
      <div className="ins-body">
        <div className="ins-title">
          <h3>{asset.filename}</h3>
          <span className="chip">{asset.kind === "video" ? "Vídeo" : asset.isLive ? "Live" : "Foto"}</span>
        </div>

        <div className="integ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="m8.5 12 2.5 2.5 4.5-5" />
          </svg>
          <div>
            Original íntegro
            <small>SHA-256 {asset.sha256.slice(0, 16)}… · sin recompresión</small>
          </div>
        </div>

        <dl className="specs">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        <div className="actions">
          <a className="btn primary" href={`/api/dl/${asset.id}`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14m0 0 6-6m-6 6-6-6" />
            </svg>
            Descargar original
          </a>
          {asset.liveVideoUrl && (
            <a className="btn" href={asset.liveVideoUrl}>
              Vídeo Live
            </a>
          )}
        </div>
      </div>
    </aside>
  );
}
