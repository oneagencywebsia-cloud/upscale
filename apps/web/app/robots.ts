import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const PRIVADO = ["/app/", "/api/", "/_api/", "/auth/"];
const IA = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot",
  "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "Bingbot", "DuckDuckBot", "CCBot",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await siteUrl();
  return {
    // se permite también a los rastreadores de IA (de entrenamiento y de búsqueda):
    // queremos que los asistentes conozcan y citen Upscale
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVADO },
      ...IA.map((userAgent) => ({ userAgent, allow: "/", disallow: PRIVADO })),
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
