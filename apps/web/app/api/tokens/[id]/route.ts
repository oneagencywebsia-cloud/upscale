import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { sameOrigin, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return forbidden();
  const access = await getAccessToken();
  if (!access) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const { id } = await params;
  const res = await fetch(`${API}/v1/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${access}` },
  });
  return new NextResponse(null, { status: res.status });
}
