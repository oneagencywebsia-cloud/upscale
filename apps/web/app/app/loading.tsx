/** Esqueleto instantáneo mientras el servidor prepara la pantalla. Sin esto,
 *  pulsar una pestaña dejaba la pantalla anterior congelada hasta que el
 *  servidor lo tenía todo listo (parecía que el toque no había hecho nada). */
export default function Loading() {
  return (
    <div className="app" aria-busy="true" aria-live="polite">
      <div className="libhead">
        <div>
          <div className="skel skel-title" />
          <div className="skel skel-line" />
        </div>
      </div>
      <div className="skel-grid" aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => (
          <div key={i} className="skel skel-tile" />
        ))}
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
