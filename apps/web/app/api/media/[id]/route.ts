import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

/** Redirige a la URL firmada del original para verlo/reproducirlo en línea (no descarga). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });

  const { id } = await params;
  const res = await fetch(`${API}/v1/assets/${id}/stream`, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "manual",
  });

  const location = res.headers.get("location");
  if ((res.status === 302 || res.status === 307) && location) {
    return NextResponse.redirect(location);
  }
  return NextResponse.json({ error: "no disponible" }, { status: res.status || 502 });
}
