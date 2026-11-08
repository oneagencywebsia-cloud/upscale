import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const res = await fetch(`${API}/v1/me/files/check`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
