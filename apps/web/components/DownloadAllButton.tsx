"use client";

import { useState } from "react";
import DownloadSheet from "./DownloadSheet";

/** «Descargar todo» para páginas del servidor (Ajustes): abre la hoja con tamaño y partes. */
export default function DownloadAllButton({ label = "Descargar todo (ZIP)" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn primary" type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <DownloadSheet fuente={{ ids: null }} titulo="Toda mi biblioteca" onClose={() => setOpen(false)} />}
    </>
  );
}
