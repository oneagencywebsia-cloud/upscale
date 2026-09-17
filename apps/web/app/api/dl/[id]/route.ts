import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { crossSite, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

/** Pide a la API la URL firmada del original y redirige el navegador a ella. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (crossSite(request)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.redirect(new URL("/", request.url));

  const { id } = await params;
  const res = await fetch(`${API}/v1/assets/${id}/original`, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "manual",
  });

  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) {
    try {
      // absoluta siempre: un Location relativo hacía lanzar a
      // NextResponse.redirect y la descarga moría con un 500 sin explicación.
      return NextResponse.redirect(new URL(location, `${API}/`).toString(), {
        status: 307,
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return NextResponse.json({ error: "no se pudo descargar" }, { status: 502 });
    }
  }
  return NextResponse.json({ error: "no se pudo descargar" }, { status: res.status || 502 });
}
