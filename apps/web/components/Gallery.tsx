"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import type { AssetListItem } from "@upscale/shared";
import { durationHuman } from "@/lib/format";
import Viewer from "./Viewer";
import DensityControl from "./DensityControl";

interface DayGroup {
  key: string;
  label: string;
  items: AssetListItem[];
}

// px mínimos por celda: 0 = fotos grandes (menos columnas) … 2 = pequeñas (más columnas).
// En un móvil de ~360px dan 2 / 3 / 4 columnas. CSS lo escala x1.4 en desktop.
const TILE = [172, 108, 78];

export default function Gallery({ groups, error }: { groups: DayGroup[]; error: string | null }) {
  const router = useRouter();
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const [assets, setAssets] = useState(flat);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState(1);

  // sincroniza si el server manda datos nuevos
  useEffect(() => setAssets(flat), [flat]);

  function toggleSel(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function favorite(id: string, value: boolean) {
    setAssets((as) => as.map((a) => (a.id === id ? { ...a, isFavorite: value } : a)));
    const r = await fetch(`/api/assets/${id}/favorite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    }).catch(() => null);
    if (!r || !r.ok) {
      // revierte el cambio optimista si el servidor no lo aceptó
      setAssets((as) => as.map((a) => (a.id === id ? { ...a, isFavorite: !value } : a)));
    }
  }

  async function del(id: string) {
    setAssets((as) => as.filter((a) => a.id !== id));
    setOpenIdx(null);
    await fetch(`/api/assets/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function bulkDownload() {
    for (const id of sel) {
      const el = document.createElement("a");
      el.href = `/api/dl/${id}`;
      el.download = "";
      document.body.appendChild(el);
      el.click();
      el.remove();
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  async function bulkDelete() {
    if (!confirm(`Borrar ${sel.size} elementos? Es definitivo.`)) return;
    const ids = [...sel];
    setAssets((as) => as.filter((a) => !sel.has(a.id)));
    setSel(new Set());
    setSelecting(false);
    await Promise.allSettled(ids.map((id) => fetch(`/api/assets/${id}`, { method: "DELETE" })));
    router.refresh();
  }

  if (error) {
    return (
      <div className="empty">
        <h3>Sin conexión</h3>
        <p>{error}</p>
      </div>
    );
  }
  if (!assets.length) {
    return (
      <div className="empty">
        <h3>Tu biblioteca está vacía</h3>
        <p>Sube desde el iPhone con el botón «Subir» (o con el Atajo, ver Ajustes).</p>
      </div>
    );
  }

  // reagrupa los assets vivos por su día original
  const liveGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((it) => assets.some((a) => a.id === it.id)).map((it) => assets.find((a) => a.id === it.id)!) }))
    .filter((g) => g.items.length);

  return (
    <>
      <div className="gallery-toolbar">
        <DensityControl value={density} onChange={setDensity} />
        <button
          className="btn ghost sm"
          onClick={() => {
            setSelecting((v) => !v);
            setSel(new Set());
          }}
        >
          {selecting ? "Cancelar" : "Seleccionar"}
        </button>
      </div>

      {liveGroups.map((g) => (
        <section className="daygroup" key={g.key}>
          <h3><b>{g.label}</b></h3>
          <div
            className="grid"
            role="list"
            style={{ ["--tile" as string]: `${TILE[density]}px` }}
          >
            {g.items.map((a) => {
              const idx = assets.findIndex((x) => x.id === a.id);
              const selected = sel.has(a.id);
              return (
                <motion.button
                  key={a.id}
                  className="frame tilt"
                  role="listitem"
                  aria-label={a.filename}
                  aria-current={selected}
                  initial={{ opacity: 0, y: 22, rotateX: 16, scale: 0.94 }}
                  whileInView={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
                  viewport={{ once: true, margin: "120px" }}
                  transition={{ duration: 0.42, ease: [0.2, 0.7, 0.2, 1] }}
                  whileHover={{ y: -4, scale: 1.02, transition: { duration: 0.15 } }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => (selecting ? toggleSel(a.id) : setOpenIdx(idx))}
                >
                  <motion.img layoutId={`ph-${a.id}`} src={a.thumbUrl} alt={a.filename} loading="lazy" />
                  {a.isFavorite && <span className="badge fav" aria-hidden="true">★</span>}
                  {a.kind === "video" && (
                    <span className="badge vid">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                      {durationHuman(a.durationS)}
                    </span>
                  )}
                  {a.isLive && <span className="badge live">LIVE</span>}
                  {selecting && <span className={`selmark ${selected ? "on" : ""}`} aria-hidden="true" />}
                </motion.button>
              );
            })}
          </div>
        </section>
      ))}

      {selecting && sel.size > 0 && (
        <motion.div className="selbar" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <span>{sel.size} seleccionados</span>
          <button className="btn sm" onClick={bulkDownload}>Descargar</button>
          <button className="btn ghost sm" onClick={bulkDelete}>Borrar</button>
        </motion.div>
      )}

      <Viewer
        assets={assets}
        index={openIdx}
        onClose={() => setOpenIdx(null)}
        onIndex={setOpenIdx}
        onFavorite={favorite}
        onDelete={del}
      />
    </>
  );
}
