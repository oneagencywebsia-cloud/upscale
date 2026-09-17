import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { sameOrigin, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const { id } = await params;
  const raw = await req.json().catch(() => ({}));
  const body = { name: typeof raw?.name === "string" ? raw.name : "" };
  const res = await fetch(`${API}/v1/albums/${id}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${API}/v1/albums/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  return new NextResponse(null, { status: res.status });
}
