"use client";

import { useState } from "react";
import DownloadSheet from "@/components/DownloadSheet";

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
          <small>ZIP con los originales, byte a byte. Si tienes muchos, te lo damos en partes.</small>
        </div>
        <button className="btn sm" type="button" onClick={() => setSheet(true)}>
          Descargar ZIP
        </button>
      </div>
      <div className="prow">
        <div>
          <b>Datos de mi cuenta</b>
          <small>Perfil, métodos de acceso, espacio y lista de álbumes en JSON.</small>
        </div>
        <button className="btn sm" type="button" onClick={downloadJson}>
          Exportar JSON
        </button>
      </div>
      {sheet && <DownloadSheet fuente={{ ids: null }} titulo="Toda mi biblioteca" formatoInicial="original" onClose={() => setSheet(false)} />}
    </div>
  );
}
