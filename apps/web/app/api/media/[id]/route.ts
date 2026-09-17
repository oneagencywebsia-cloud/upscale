import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { crossSite, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

/**
 * Redirige a la URL firmada del original para verlo/reproducirlo en línea (no
 * descarga). NUNCA hace de tubería del vídeo: devolver un 307 es lo que hace
 * que el navegador pida los rangos (byte-range) DIRECTAMENTE al almacén, y que
 * un vídeo de 100 GB no pase por la memoria de este proceso.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (crossSite(request)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });

  const { id } = await params;
  const res = await fetch(`${API}/v1/assets/${id}/stream`, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "manual",
  });

  const location = res.headers.get("location");
  // 303/308 además de 302/307 por si la API cambia de opinión algún día, y
  // `new URL(...)` para no reventar con un 500 si llega un Location relativo
  // (NextResponse.redirect exige URL absoluta y lanza si no lo es).
  if (res.status >= 300 && res.status < 400 && location) {
    try {
      const abs = new URL(location, `${API}/`).toString();
      return NextResponse.redirect(abs, { status: 307, headers: { "cache-control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "no disponible" }, { status: 502 });
    }
  }
  return NextResponse.json({ error: "no disponible" }, { status: res.status || 502 });
}
