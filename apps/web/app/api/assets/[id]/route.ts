import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${API}/v1/assets/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  return new NextResponse(null, { status: res.status });
}
