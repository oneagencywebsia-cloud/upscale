"use client";

import { useEffect } from "react";

async function nukeCaches() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await caches?.keys?.()) ?? [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* nada */
  }
}

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const chunkish = /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch dynamically/i.test(
      error?.message ?? "",
    );
    // error típico tras un despliegue (bundle viejo en caché del SW): limpia y recarga UNA vez
    if (chunkish && !sessionStorage.getItem("_recovered")) {
      sessionStorage.setItem("_recovered", "1");
      void nukeCaches().then(() => location.reload());
    }
  }, [error]);

  return (
    <div className="empty">
      <h3>Algo ha fallado</h3>
      <p>Recarga la página. Si sigue igual, limpia la caché.</p>
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", justifyContent: "center" }}>
        <button className="btn primary sm" type="button" onClick={() => reset()}>
          Reintentar
        </button>
        <button
          className="btn sm"
          type="button"
          onClick={() => void nukeCaches().then(() => location.reload())}
        >
          Limpiar y recargar
        </button>
      </div>
    </div>
  );
}
