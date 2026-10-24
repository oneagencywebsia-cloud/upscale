"use client";

import Link from "next/link";
import type { NoteListItem } from "@/lib/notes";
import { estiloCss, haceTiempo } from "@/lib/notes";

const pin = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M14 3l7 7-2 1-3-1-4 4v5l-2 2-2-5-5-2 2-2h5l4-4-1-3z" />
  </svg>
);
const clip = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m21 11-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />
  </svg>
);

export interface AccionesNota {
  fijar: (n: NoteListItem) => void;
  archivar: (n: NoteListItem) => void;
  borrar: (n: NoteListItem) => void;
  restaurar: (n: NoteListItem) => void;
  borrarYa: (n: NoteListItem) => void;
}

/** Tarjeta de nota con SU estilo (fondo, recuadro, tipografía). Enlace + acciones sueltas (sin interactivos anidados). */
export default function NoteCard({ n, vista, a, lista }: { n: NoteListItem; vista: "activas" | "archivadas" | "papelera"; a: AccionesNota; lista: boolean }) {
  const titulo = n.title.trim() || "Sin título";
  return (
    <li className={`ncard${lista ? " row" : ""}${n.pinned ? " pinned" : ""}`} style={estiloCss(n.style, { compacto: true })}>
      <Link href={`/app/notas/${n.id}`} className="ncard-link" aria-label={`${titulo}${n.preview ? `. ${n.preview}` : ""}`}>
        <span className="ncard-body">
          <span className="ncard-title">
            {n.pinned && <span className="ncard-pin" title="Fijada">{pin}</span>}
            {titulo}
          </span>
          {n.preview && <span className="ncard-prev">{n.preview}</span>}
        </span>
        {n.coverUrl && <img className="ncard-cover" src={n.coverUrl} alt="" loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.display = "none")} />}
        <span className="ncard-foot">
          {n.tags.slice(0, 3).map((t) => (
            <span key={t} className="ntag">{t}</span>
          ))}
          {n.tags.length > 3 && <span className="ntag">+{n.tags.length - 3}</span>}
          <span className="ncard-meta">
            {n.attachmentCount > 0 && (
              <span className="ncard-att" title={`${n.attachmentCount} capturas`}>
                {clip}
                {n.attachmentCount}
              </span>
            )}
            <time dateTime={n.updatedAt}>{haceTiempo(vista === "papelera" && n.deletedAt ? n.deletedAt : n.updatedAt)}</time>
          </span>
        </span>
      </Link>
      <span className="ncard-acts">
        {vista === "papelera" ? (
          <>
            <button type="button" onClick={() => a.restaurar(n)}>Restaurar</button>
            <button type="button" className="warn" onClick={() => a.borrarYa(n)}>Borrar ya</button>
          </>
        ) : (
          <>
            {vista === "activas" && (
              <button type="button" aria-pressed={n.pinned} onClick={() => a.fijar(n)}>
                {n.pinned ? "Quitar fijada" : "Fijar"}
              </button>
            )}
            <button type="button" onClick={() => a.archivar(n)}>{vista === "archivadas" ? "Desarchivar" : "Archivar"}</button>
            <button type="button" className="warn" onClick={() => a.borrar(n)}>Eliminar</button>
          </>
        )}
      </span>
    </li>
  );
}
