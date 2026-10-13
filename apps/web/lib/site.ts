import { headers } from "next/headers";

/** URL pública del sitio. `SITE_URL` si está definida (recomendado: el dominio
 *  final); si no, la deduce de la petición — así funciona en cualquier host sin
 *  configurar nada, y sitemap/canonical/OG apuntan siempre a donde estás. */
export async function siteUrl(): Promise<string> {
  const env = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (env) return env;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
