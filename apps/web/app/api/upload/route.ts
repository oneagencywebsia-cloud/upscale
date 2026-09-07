import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Sube desde el navegador: reenvía cada archivo a la API con la sesión del usuario. */
export async function POST(request: Request) {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "falta el archivo" }, { status: 400 });
  }

  const res = await fetch(`${API}/v1/assets`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-filename": file.name,
      "content-type": file.type || "application/octet-stream",
      "x-captured-at": new Date(file.lastModified).toISOString(),
    },
    body: file.stream(),
    // @ts-expect-error -- requerido por undici para body de tipo stream
    duplex: "half",
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
