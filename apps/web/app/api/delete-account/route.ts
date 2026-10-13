import { proxyJson } from "@/lib/proxy";

export async function POST(req: Request) {
  const raw = await req.json().catch(() => ({}));
  return proxyJson(req, "/v1/me/delete", "POST", { confirm: typeof raw?.confirm === "string" ? raw.confirm : "" });
}
