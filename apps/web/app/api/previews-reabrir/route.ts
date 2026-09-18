import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { sameOrigin, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

/** Reabre los vídeos cuya copia de reproducción se rindió tras agotar reintentos. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const res = await fetch(`${API}/v1/diag/previews/reabrir`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
