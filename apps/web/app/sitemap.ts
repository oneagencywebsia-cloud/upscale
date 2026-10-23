import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { PAGINAS, CONTENIDO_ACTUALIZADO } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await siteUrl();
  const lastModified = new Date(CONTENIDO_ACTUALIZADO);
  return [
    { url: `${base}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    ...PAGINAS.map((p) => ({ url: `${base}${p.path}`, lastModified, changeFrequency: p.changeFrequency, priority: p.priority })),
  ];
}
