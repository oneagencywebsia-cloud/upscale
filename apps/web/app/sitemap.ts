import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await siteUrl();
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/privacidad`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terminos`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
