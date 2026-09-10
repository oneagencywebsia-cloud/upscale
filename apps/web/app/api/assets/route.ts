import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { sameOrigin, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

/**
 * Página siguiente de la galería (scroll infinito). La biblioteca puede tener
 * cientos de miles de archivos: NUNCA se cargan todos: se piden de 120 en 120
 * con cursor de tipo keyset (captured_at, id), que en Postgres es una búsqueda
 * directa por índice — igual de rápida en el archivo 10 que en el 500.000.
 */
export async function GET(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });

  const url = new URL(req.url);
  const q = new URLSearchParams();
  const cursor = url.searchParams.get("cursor");
  const kind = url.searchParams.get("kind");
  const limit = Number(url.searchParams.get("limit")) || 120;
  if (cursor) q.set("cursor", cursor);
  if (kind === "photo" || kind === "video") q.set("kind", kind);
  if (url.searchParams.get("fav") === "1") q.set("fav", "1");
  q.set("limit", String(Math.min(Math.max(limit, 1), 300)));

  const res = await fetch(`${API}/v1/assets?${q.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => ({ items: [], nextCursor: null })), {
    status: res.status,
  });
}
