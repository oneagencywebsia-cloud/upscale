import Link from "next/link";
import Mark3D from "@/components/Mark3D";

/** 404 dentro de la app (un álbum que ya no existe, un enlace roto): sin salir de la barra de navegación. */
export default function AppNotFound() {
  return (
    <div className="app">
      <div className="empty">
        <div className="empty-mark" aria-hidden="true">
          <Mark3D size={104} />
        </div>
        <h3>No encontramos esto</h3>
        <p>Puede que lo hayas borrado o que el enlace no sea correcto.</p>
        <div className="nf-actions">
          <Link className="btn primary" href="/app/albumes">Ver mis álbumes</Link>
          <Link className="btn" href="/app">Ir a la biblioteca</Link>
        </div>
      </div>
    </div>
  );
}
