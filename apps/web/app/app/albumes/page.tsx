import { listAlbums } from "@/lib/api";
import AlbumGrid from "@/components/AlbumGrid";

export const dynamic = "force-dynamic";

export default async function AlbumesPage() {
  let albums: Awaited<ReturnType<typeof listAlbums>>["albums"] = [];
  let error: string | null = null;
  try {
    ({ albums } = await listAlbums());
  } catch {
    error = "No se pudo conectar con el servidor de Upscale.";
  }

  return (
    <div className="app">
      <div className="libhead">
        <div>
          <h2>
            Álbumes
            <span className="lh-flourish" aria-hidden="true" />
          </h2>
          <p>{albums.length.toLocaleString("es-ES")} álbumes</p>
        </div>
      </div>
      <AlbumGrid initialAlbums={albums} error={error} />
    </div>
  );
}
