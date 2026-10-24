import { proxyJson } from "@/lib/proxy";

/** Cuánto pesa lo que se quiere bajar y en cuántas partes conviene (ver DownloadSheet). */
export async function POST(req: Request) {
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const body: Record<string, unknown> = {};
  for (const k of ["ids", "kind", "fav", "album", "q", "camera", "orientation", "from", "to", "maxPartBytes", "compat"]) if (raw[k] !== undefined && raw[k] !== null) body[k] = raw[k];
  return proxyJson(req, "/v1/assets/zip/plan", "POST", body);
}
