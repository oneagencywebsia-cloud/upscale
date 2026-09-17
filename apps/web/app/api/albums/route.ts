import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { sameOrigin, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export async function GET(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const res = await fetch(`${API}/v1/albums`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => ({ albums: [] })), { status: res.status });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const raw = await req.json().catch(() => ({}));
  const body = { name: typeof raw?.name === "string" ? raw.name : "" };
  const res = await fetch(`${API}/v1/albums`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
