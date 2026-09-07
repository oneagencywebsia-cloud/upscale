import { listAssets } from "@/lib/api";
import { groupByDay, bytesHuman } from "@/lib/format";
import Gallery from "@/components/Gallery";
import PrismMount from "@/components/PrismMount";

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
  let error: string | null = null;
  try {
    const data = await listAssets({ limit: 200, kind: filter, fav: onlyFav });
    items = data.items;
  } catch {
    error = "No se pudo conectar con el servidor de Upscale.";
  }

  const groups = groupByDay(items);
  const totalBytes = items.reduce((s, a) => s + a.bytes, 0);

  return (
    <div className="app">
      <div className="libhead">
        <div>
          <h2>{onlyFav ? "Favoritos" : "Tu biblioteca"}</h2>
          <p>
            {items.length.toLocaleString("es-ES")} elementos · {bytesHuman(totalBytes)} · todo íntegro
          </p>
        </div>
        <PrismMount />
      </div>
      <Gallery groups={groups} error={error} />
    </div>
  );
}
