import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export async function DELETE(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const access = await getAccessToken();
  if (!access) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const { token } = await params;
  const res = await fetch(`${API}/v1/tokens/${token}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${access}` },
  });
  return new NextResponse(null, { status: res.status });
}
