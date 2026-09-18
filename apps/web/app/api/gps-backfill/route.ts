import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { sameOrigin, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

/**
 * Un lote del backfill de GPS (fotos antiguas sin lat/lon por EXIF). El botón
 * de Ajustes llama esto en bucle hasta que `procesados < n` — cada lote re-lee
 * el original de Telegram, así que se hace de a poco en vez de todo de golpe.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const res = await fetch(`${API}/v1/diag/gps/backfill?n=40`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
