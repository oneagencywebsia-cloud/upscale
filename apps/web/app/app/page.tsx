import { listAssets, getStorage } from "@/lib/api";
import { groupByDay, bytesHuman } from "@/lib/format";
import Gallery from "@/components/Gallery";
import PrismMount from "@/components/PrismMount";
import ErrorBoundary from "@/components/ErrorBoundary";

export const dynamic = "force-dynamic";

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; fav?: string }>;
}) {
  const { kind, fav } = await searchParams;
  const filter = kind === "photo" || kind === "video" ? kind : undefined;
  const onlyFav = fav === "1";

  let items: Awaited<ReturnType<typeof listAssets>>["items"] = [];
  let cursor: string | null = null;
  let error: string | null = null;
  try {
    // SOLO la primera página: la biblioteca puede tener cientos de miles de
    // archivos. El resto entra por scroll infinito (cursor keyset).
    const data = await listAssets({ limit: 120, kind: filter, fav: onlyFav });
    items = data.items;
    cursor = data.nextCursor ?? null;
  } catch {
    error = "No se pudo conectar con el servidor de Upscale.";
  }

  // Totales REALES de toda la biblioteca (un sum/count en la BD), no solo de lo
  // que se ha cargado en pantalla.
  let totalCount = items.length;
  let totalBytes = items.reduce((s, a) => s + a.bytes, 0);
  try {
    const s = await getStorage();
    totalCount = s.count;
    totalBytes = s.usedBytes;
  } catch {
    /* si falla, se enseña lo cargado */
  }

  const groups = groupByDay(items);

  return (
    <div className="app">
      <div className="libhead">
        <div>
          <h2>{onlyFav ? "Favoritos" : "Tu biblioteca"}</h2>
          <p>
            {totalCount.toLocaleString("es-ES")} elementos · {bytesHuman(totalBytes)} · todo íntegro
          </p>
        </div>
        <PrismMount />
      </div>
      <ErrorBoundary
        fallback={
          <div className="empty">
            <h3>No se pudo mostrar la galería</h3>
            <p>Recarga la página.</p>
          </div>
        }
      >
        <Gallery
          groups={groups}
          error={error}
          initialCursor={cursor}
          kind={filter}
          fav={onlyFav}
          total={totalCount}
        />
      </ErrorBoundary>
    </div>
  );
}
