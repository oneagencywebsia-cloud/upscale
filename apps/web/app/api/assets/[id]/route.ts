import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { sameOrigin, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

/**
 * Detalle de un asset, con `originalUrl` firmada incluida — lo usa el zoom del
 * visor para pedir la foto a resolución COMPLETA solo cuando hace falta (al
 * hacer zoom), no en cada apertura del visor (el póster de ~1600px ya sirve
 * para verla a pantalla completa sin zoom).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${API}/v1/assets/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => ({ error: "fallo al obtener el asset" })), {
    status: res.status,
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${API}/v1/assets/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  return new NextResponse(null, { status: res.status });
}
