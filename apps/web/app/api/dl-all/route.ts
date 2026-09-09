import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export const maxDuration = 800;

/** Descarga TODO (o `?ids=a,b,c`) en un ZIP. Hace de proxy con streaming. */
export async function GET(request: Request) {
  const token = await getAccessToken();
  if (!token) return NextResponse.redirect(new URL("/", request.url));

  const ids = new URL(request.url).searchParams.get("ids") ?? "";
  const upstream = await fetch(`${API}/v1/assets/zip${ids ? `?ids=${encodeURIComponent(ids)}` : ""}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "no se pudo generar la descarga" }, { status: upstream.status || 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": upstream.headers.get("content-disposition") ?? 'attachment; filename="Recuerdos.zip"',
      "cache-control": "no-store",
    },
  });
}
