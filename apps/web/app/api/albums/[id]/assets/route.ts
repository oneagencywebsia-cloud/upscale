import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { sameOrigin, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

/**
 * Página siguiente del contenido de un álbum (scroll infinito) — mismo patrón
 * y mismo tope de `limit` que /api/assets, solo que aquí el álbum ya viene
 * fijado por la URL en vez de por un query param.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const { id } = await params;

  const url = new URL(req.url);
  const q = new URLSearchParams();
  const cursor = url.searchParams.get("cursor");
  const limit = Number(url.searchParams.get("limit")) || 120;
  if (cursor) q.set("cursor", cursor);
  q.set("limit", String(Math.min(Math.max(limit, 1), 300)));

  const res = await fetch(`${API}/v1/albums/${id}/assets?${q.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => ({ items: [], nextCursor: null })), {
    status: res.status,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const { id } = await params;
  const raw = await req.json().catch(() => ({}));
  const ids = Array.isArray(raw?.ids) ? raw.ids.filter((x: unknown) => typeof x === "string") : [];
  const res = await fetch(`${API}/v1/albums/${id}/assets`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
