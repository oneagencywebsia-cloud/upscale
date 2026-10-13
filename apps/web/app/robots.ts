import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await siteUrl();
  return {
    // se permite también a los rastreadores de IA: queremos que citen la portada
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app/", "/api/", "/_api/", "/auth/"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
