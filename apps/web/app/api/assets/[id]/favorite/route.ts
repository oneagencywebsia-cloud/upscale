import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/v1/assets/${id}/favorite`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
