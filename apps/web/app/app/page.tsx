import { listAssets, getStorage, listCameras } from "@/lib/api";
import { groupByDay, bytesHuman } from "@/lib/format";
import Gallery from "@/components/Gallery";
import PrismMount from "@/components/PrismMount";
import ErrorBoundary from "@/components/ErrorBoundary";
import LibraryAurora from "@/components/LibraryAurora";

export const dynamic = "force-dynamic";

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    fav?: string;
    tooBig?: string;
    q?: string;
    camera?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { kind, fav, tooBig, q, camera, from, to } = await searchParams;
  const filter = kind === "photo" || kind === "video" ? kind : undefined;
  const onlyFav = fav === "1";

  let items: Awaited<ReturnType<typeof listAssets>>["items"] = [];
  let cursor: string | null = null;
  let error: string | null = null;
  try {
    // SOLO la primera página: la biblioteca puede tener cientos de miles de
    // archivos. El resto entra por scroll infinito (cursor keyset).
    const data = await listAssets({ limit: 120, kind: filter, fav: onlyFav, q, camera, from, to });
    items = data.items;
    cursor = data.nextCursor ?? null;
  } catch {
    error = "No se pudo conectar con el servidor de Upscale.";
  }

  let cameras: string[] = [];
  try {
    cameras = (await listCameras()).cameras;
  } catch {
    /* si falla, el desplegable de cámara sale vacío */
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
    <>
      <LibraryAurora />
      <div className="app">
        <div className="libhead">
          <div>
            <h2>
              {onlyFav ? "Favoritos" : "Tu biblioteca"}
              <span className="lh-flourish" aria-hidden="true" />
            </h2>
            <p>
              {totalCount.toLocaleString("es-ES")} elementos · {bytesHuman(totalBytes)} · todo íntegro
            </p>
          </div>
          <PrismMount />
        </div>
        {tooBig === "1" && (
          <div className="empty" role="status">
            <h3>Ese archivo es demasiado grande para «Compartir»</h3>
            <p>Súbelo con el botón «Subir» (o con el Atajo de iOS): esa vía no tiene tope de tamaño.</p>
          </div>
        )}
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
            q={q}
            camera={camera}
            from={from}
            to={to}
            cameras={cameras}
          />
        </ErrorBoundary>
      </div>
    </>
  );
}
