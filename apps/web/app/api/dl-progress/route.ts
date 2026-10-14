import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { crossSite, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

/** Progreso de un ZIP en marcha (lo pregunta la barra de descarga cada poco). */
export async function GET(request: Request) {
  if (crossSite(request)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const job = new URL(request.url).searchParams.get("job") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(job)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const res = await fetch(`${API}/v1/assets/zip/progress?job=${encodeURIComponent(job)}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => ({})), {
    status: res.status,
    headers: { "cache-control": "no-store" },
  });
}
