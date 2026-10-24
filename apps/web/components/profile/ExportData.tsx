"use client";

import { useState } from "react";
import DownloadSheet from "@/components/DownloadSheet";
import { api, textoDeDoc, type Note, type NoteListResponse } from "@/lib/notes";

export interface AccountSnapshot {
  email: string;
  name: string;
  bio: string;
  createdAt: string | null;
  lastSignInAt: string | null;
  providers: string[];
  items: number | null;
  bytes: number | null;
  albums: { name: string; count: number; createdAt: string }[];
}

/** Copias de seguridad: la biblioteca entera en ZIP y un JSON con los datos de la cuenta. */
export default function ExportData({ snapshot }: { snapshot: AccountSnapshot }) {
  const [sheet, setSheet] = useState(false);
  const [notas, setNotas] = useState<"idle" | "busy" | "error">("idle");

  /** Todas las notas (activas y archivadas) con su texto, estilo y documento original. */
  async function exportarNotas() {
    setNotas("busy");
    try {
      const ids: string[] = [];
      for (const view of ["active", "archived"]) {
        let cursor: string | null = null;
        do {
          const r: NoteListResponse = await api(`?view=${view}${cursor ? `&cursor=${cursor}` : ""}`);
          ids.push(...r.items.map((n) => n.id));
          cursor = r.nextCursor;
        } while (cursor);
      }
      const completas: Note[] = [];
      for (let i = 0; i < ids.length; i += 6) completas.push(...(await Promise.all(ids.slice(i, i + 6).map((id) => api<Note>(`/${id}`)))));
      const payload = {
        exportadoEl: new Date().toISOString(),
        notas: completas.map((n) => ({
          titulo: n.title,
          texto: textoDeDoc(n.body),
          etiquetas: n.tags,
          fijada: n.pinned,
          archivada: Boolean(n.archivedAt),
          creadaEl: n.createdAt,
          editadaEl: n.updatedAt,
          capturas: n.attachments.map((a) => a.filename),
          estilo: n.style,
          documento: n.body,
        })),
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "upscale-mis-notas.json" });
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      setNotas("idle");
    } catch {
      setNotas("error");
    }
  }

  function downloadJson() {
    const payload = {
      exportadoEl: new Date().toISOString(),
      cuenta: {
        correo: snapshot.email,
        nombre: snapshot.name,
        descripcion: snapshot.bio,
        creadaEl: snapshot.createdAt,
        ultimoAcceso: snapshot.lastSignInAt,
        metodosDeAcceso: snapshot.providers,
      },
      biblioteca: { elementos: snapshot.items, bytes: snapshot.bytes },
      albumes: snapshot.albums,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "upscale-mi-cuenta.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div className="psec">
      <div className="prow">
        <div>
          <b>Toda mi biblioteca</b>
          <small>Todos tus archivos, tal cual los subiste. Si tienes muchos, te los damos por partes.</small>
        </div>
        <button className="btn sm" type="button" onClick={() => setSheet(true)}>
          Descargar todo
        </button>
      </div>
      <div className="prow">
        <div>
          <b>Datos de mi cuenta</b>
          <small>Tu perfil, cómo entras, el espacio que usas y tus álbumes, en un archivo para guardar.</small>
        </div>
        <button className="btn sm" type="button" onClick={downloadJson}>
          Guardar mis datos
        </button>
      </div>
      <div className="prow">
        <div>
          <b>Mis notas</b>
          <small>{notas === "error" ? "No se pudieron exportar. Inténtalo de nuevo." : "Todas tus notas con su texto, etiquetas y color, en un archivo para guardar. Las capturas siguen en tu biblioteca."}</small>
        </div>
        <button className="btn sm" type="button" onClick={exportarNotas} disabled={notas === "busy"}>
          {notas === "busy" ? "Exportando…" : "Exportar notas"}
        </button>
      </div>
      {sheet && <DownloadSheet fuente={{ ids: null }} titulo="Toda mi biblioteca" formatoInicial="original" onClose={() => setSheet(false)} />}
    </div>
  );
}
