import { proxyJson } from "@/lib/proxy";

export async function POST(req: Request) {
  const raw = await req.json().catch(() => ({}));
  return proxyJson(req, "/v1/me/referral", "POST", { code: typeof raw?.code === "string" ? raw.code : "" });
}
