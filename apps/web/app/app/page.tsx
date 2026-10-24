import type { Metadata } from "next";
import { listAssets, getStorage, listCameras } from "@/lib/api";
import { groupByDay, bytesHuman } from "@/lib/format";
import Gallery from "@/components/Gallery";
import PrismMount from "@/components/PrismMount";
import ErrorBoundary from "@/components/ErrorBoundary";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Biblioteca" };

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    fav?: string;
    sort?: string;
    tooBig?: string;
    q?: string;
    camera?: string;
    orientation?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { kind, fav, sort, tooBig, q, camera, orientation: rawOri, from, to } = await searchParams;
  const orientation = rawOri === "vertical" || rawOri === "horizontal" || rawOri === "cuadrada" ? rawOri : undefined;
  const filter = kind === "photo" || kind === "video" || kind === "audio" ? kind : undefined;
  const onlyFav = fav === "1";
  const sortAdded = sort === "added";

  // Las tres consultas son independientes: en paralelo (antes iban en serie,
  // sumando sus latencias en cada carga y cada refresco).
  const [list, cams, store] = await Promise.allSettled([
    // SOLO la primera página: la biblioteca puede tener cientos de miles de
    // archivos. El resto entra por scroll infinito (cursor keyset).
    listAssets({ limit: 120, kind: filter, fav: onlyFav, q, camera, orientation, from, to, sort: sortAdded ? "added" : undefined }),
    listCameras(),
    getStorage(),
  ]);

  let items: Awaited<ReturnType<typeof listAssets>>["items"] = [];
  let cursor: string | null = null;
  let error: string | null = null;
  if (list.status === "fulfilled") {
    items = list.value.items;
    cursor = list.value.nextCursor ?? null;
  } else {
    error = "No se pudo conectar con Upscale. Mira tu conexión a internet e inténtalo otra vez.";
  }

  // si falla, el desplegable de cámara sale vacío
  const cameras = cams.status === "fulfilled" ? cams.value.cameras : [];

  // Totales REALES de toda la biblioteca (un sum/count en la BD), no solo de lo
  // que se ha cargado en pantalla. Si falla, se enseña lo cargado.
  let totalCount = items.length;
  let totalBytes = items.reduce((s, a) => s + a.bytes, 0);
  if (store.status === "fulfilled") {
    totalCount = store.value.count;
    totalBytes = store.value.usedBytes;
  }

  const groups = groupByDay(items, sortAdded ? "uploadedAt" : "capturedAt");

  return (
    <>
      <div className="app">
        <div className="libhead">
          <div>
            <h2>
              {onlyFav ? "Favoritos" : sortAdded ? "Recién subidos" : "Tu biblioteca"}
              <span className="lh-flourish" aria-hidden="true" />
            </h2>
            <p>
              {totalCount.toLocaleString("es-ES")} elementos · {bytesHuman(totalBytes)} · todo a salvo
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
            sort={sortAdded ? "added" : undefined}
            total={totalCount}
            q={q}
            camera={camera}
            orientation={orientation}
            from={from}
            to={to}
            cameras={cameras}
          />
        </ErrorBoundary>
      </div>
    </>
  );
}
