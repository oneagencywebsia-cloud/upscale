import { getActivity } from "@/lib/api";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  view: "Abriste",
  download: "Descargaste",
  list: "Abriste la biblioteca",
};

const FMT = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" });

export default async function ActividadPage() {
  let items: Awaited<ReturnType<typeof getActivity>>["items"] = [];
  let error: string | null = null;
  try {
    ({ items } = await getActivity());
  } catch {
    error = "No se pudo cargar la actividad.";
  }

  return (
    <div className="app">
      <div className="libhead">
        <h2>Actividad</h2>
        <p>{items.length} eventos recientes · registro de lo que ves y descargas</p>
      </div>

      {error ? (
        <div className="empty">
          <h3>Sin conexión</h3>
          <p>{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <h3>Todavía no hay actividad</h3>
          <p>Aquí aparecerá cada vez que abras o descargues una foto.</p>
        </div>
      ) : (
        <ol className="activity">
          {items.map((it) => (
            <li key={it.id}>
              <span className={`act-dot act-${it.action}`} aria-hidden="true" />
              <div className="act-main">
                <b>{LABEL[it.action] ?? it.action}</b>
                {it.filename && <span className="act-file">{it.filename}</span>}
              </div>
              <time>{FMT.format(new Date(it.at))}</time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
