import { proxyJson } from "@/lib/proxy";

/** Estado de la ingesta de Telegram (solo el administrador: la API responde 403 al resto). */
export async function GET(req: Request) {
  return proxyJson(req, "/v1/ingest/status", "GET");
}
