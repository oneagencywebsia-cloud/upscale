import { listAssets } from "@/lib/api";
import { groupByDay, bytesHuman } from "@/lib/format";
import Gallery from "@/components/Gallery";

export const dynamic = "force-dynamic";

export default async function GalleryPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const filter = kind === "photo" || kind === "video" ? kind : undefined;

  let items: Awaited<ReturnType<typeof listAssets>>["items"] = [];
  let error: string | null = null;
  try {
    const data = await listAssets({ limit: 150, kind: filter });
    items = data.items;
  } catch {
    error = "No se pudo conectar con el servidor de Upscale. ¿Está encendida la API?";
  }

  const groups = groupByDay(items);
  const totalBytes = items.reduce((s, a) => s + a.bytes, 0);

  return (
    <div className="app">
      <div className="libhead">
        <h2>Tu biblioteca</h2>
        <p>
          {items.length.toLocaleString("es-ES")} elementos · {bytesHuman(totalBytes)} · todo íntegro
        </p>
      </div>
      <Gallery groups={groups} error={error} filter={filter ?? "all"} />
    </div>
  );
}
