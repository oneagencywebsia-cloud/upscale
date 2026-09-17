import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { sameOrigin, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const { id, assetId } = await params;
  const res = await fetch(`${API}/v1/albums/${id}/assets/${assetId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  return new NextResponse(null, { status: res.status });
}
