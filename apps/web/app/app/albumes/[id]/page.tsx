import { notFound } from "next/navigation";
import { getAlbum, getAlbumAssets } from "@/lib/api";
import { groupByDay } from "@/lib/format";
import Gallery from "@/components/Gallery";
import ErrorBoundary from "@/components/ErrorBoundary";

export const dynamic = "force-dynamic";

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let album: Awaited<ReturnType<typeof getAlbum>> = null;
  let items: Awaited<ReturnType<typeof getAlbumAssets>>["items"] = [];
  let cursor: string | null = null;
  let error: string | null = null;
  try {
    // Solo la primera página: el resto entra por scroll infinito (cursor keyset),
    // igual que la galería principal.
    [album, { items, nextCursor: cursor }] = await Promise.all([
      getAlbum(id),
      getAlbumAssets(id, undefined),
    ]);
  } catch {
    error = "No se pudo conectar con el servidor de Upscale.";
  }

  if (!error && !album) notFound();

  const groups = groupByDay(items);

  return (
    <div className="app">
      <div className="libhead">
        <div>
          <h2>
            {album?.name ?? "Álbum"}
            <span className="lh-flourish" aria-hidden="true" />
          </h2>
          <p>{items.length.toLocaleString("es-ES")} elementos</p>
        </div>
      </div>
      <ErrorBoundary
        fallback={
          <div className="empty">
            <h3>No se pudo mostrar el álbum</h3>
            <p>Recarga la página.</p>
          </div>
        }
      >
        <Gallery groups={groups} error={error} initialCursor={cursor} albumId={id} />
      </ErrorBoundary>
    </div>
  );
}
