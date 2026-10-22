import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { crossSite, forbidden } from "@/lib/guard";
import { publicUrl } from "@/lib/origin";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

/** Pide a la API la URL firmada del original y redirige el navegador a ella. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (crossSite(request)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.redirect(publicUrl("/", request));

  const { id } = await params;
  // ?compat=1 → versión que se abre en cualquier aparato (HEIC→JPG, CAF→MP3…)
  const compat = new URL(request.url).searchParams.get("compat") === "1";
  const res = await fetch(`${API}/v1/assets/${id}/original${compat ? "?compat=1" : ""}`, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "manual",
    // si el navegador cancela, se corta también hacia la API
    signal: request.signal,
  });

  // la API ya convirtió el archivo y lo entrega directamente (no hay enlace firmado)
  if (res.ok && res.body) {
    return new Response(res.body, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition": res.headers.get("content-disposition") ?? "attachment",
        ...(res.headers.get("content-length") ? { "content-length": res.headers.get("content-length")! } : {}),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

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
