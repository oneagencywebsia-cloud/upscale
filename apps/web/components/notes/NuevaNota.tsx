"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ErrorApi, type Note, type NoteListResponse } from "@/lib/notes";

/**
 * Crea una nota y abre el editor. Si la última nota sigue vacía (y es reciente) se
 * reutiliza: abrir el acceso rápido dos veces no deja notas vacías por todas partes.
 */
export default function NuevaNota() {
  const router = useRouter();
  const hecho = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hecho.current) return;
    hecho.current = true;
    (async () => {
      try {
        const r = await api<NoteListResponse>("?view=active");
        const vacia = r.items.find(
          (n) => !n.title.trim() && !n.preview && n.attachmentCount === 0 && Date.now() - new Date(n.createdAt).getTime() < 24 * 3600_000,
        );
        const id = vacia?.id ?? (await api<Note>("", { method: "POST", json: {} })).id;
        router.replace(`/app/notas/${id}?nueva=1`);
      } catch (e) {
        setError(e instanceof ErrorApi ? e.message : "No se pudo crear la nota");
      }
    })();
  }, [router]);

  return (
    <div className="app notes">
      {error ? (
        <div className="empty" role="alert">
          <h3>{error}</h3>
          <Link className="btn primary" href="/app/notas">Ir a Notas</Link>
        </div>
      ) : (
        <p className="nocr-wait" role="status"><span className="nspin" aria-hidden="true" /> Abriendo una nota nueva…</p>
      )}
    </div>
  );
}
