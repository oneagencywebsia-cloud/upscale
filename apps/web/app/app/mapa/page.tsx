import { getMapPoints } from "@/lib/api";
import MapView from "@/components/MapView";

export const dynamic = "force-dynamic";

export default async function MapaPage() {
  let points: Awaited<ReturnType<typeof getMapPoints>>["points"] = [];
  let error: string | null = null;
  try {
    ({ points } = await getMapPoints());
  } catch {
    error = "No se pudo conectar con el servidor de Upscale.";
  }

  return (
    <div className="app">
      <div className="libhead">
        <div>
          <h2>Mapa</h2>
          <p>
            {error ? "sin datos" : `${points.length.toLocaleString("es-ES")} archivos geolocalizados`}
          </p>
        </div>
      </div>

      {error ? (
        <div className="empty">
          <h3>Sin conexión</h3>
          <p>{error}</p>
        </div>
      ) : (
        <MapView points={points} />
      )}
    </div>
  );
}
