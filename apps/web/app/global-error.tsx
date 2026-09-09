"use client";

async function nuke() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await caches?.keys?.()) ?? [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* nada */
  }
  location.reload();
}

export default function GlobalError({ reset }: { error: unknown; reset: () => void }) {
  return (
    <html lang="es">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          background: "#0b0e14",
          color: "#e8ecf4",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div>
          <h2 style={{ marginBottom: 8 }}>Algo ha fallado</h2>
          <p style={{ opacity: 0.7, marginBottom: 18 }}>Recarga la app.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{ padding: "9px 16px", borderRadius: 10, border: "1px solid #2a3346", background: "#141a26", color: "#fff" }}
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => void nuke()}
              style={{ padding: "9px 16px", borderRadius: 10, border: 0, background: "#1c8fac", color: "#fff" }}
            >
              Limpiar y recargar
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
