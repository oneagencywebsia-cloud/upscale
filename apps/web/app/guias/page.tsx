import type { Metadata, Viewport } from "next";
import Link from "next/link";
import PublicPage from "@/components/public/PublicPage";
import { pageMeta, publicViewport, PAGINAS } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const viewport: Viewport = publicViewport;
const PATH = "/guias";
export const metadata: Metadata = pageMeta(PATH);

export default async function Page() {
  const base = await siteUrl();
  const guias = PAGINAS.filter((p) => p.kind === "guia");
  const lista = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: guias.map((g, i) => ({ "@type": "ListItem", position: i + 1, name: g.title, url: `${base}${g.path}` })),
  };
  return (
    <PublicPage
      path={PATH}
      title="Guías"
      lead="Respuestas prácticas para guardar, abrir y descargar tus fotos, vídeos y música sin perder calidad."
      jsonLd={[lista]}
    >
      <ul className="pub-guides">
        {guias.map((g) => (
          <li key={g.path}>
            <h2><Link href={g.path}>{g.label}</Link></h2>
            <p>{g.description}</p>
          </li>
        ))}
      </ul>
    </PublicPage>
  );
}
