import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export const runtime = "nodejs";
export const maxDuration = 800;

/**
 * Sube desde el navegador. El cliente manda el archivo como cuerpo binario crudo
 * (no multipart) para no bufferizarlo: se hace passthrough del stream a la API.
 */
export async function POST(request: Request) {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });

  const filename = request.headers.get("x-filename") ?? "IMG.bin";
  const contentType = request.headers.get("content-type") || "application/octet-stream";
  const capturedAt = request.headers.get("x-captured-at") ?? new Date().toISOString();

  if (!request.body) return NextResponse.json({ error: "falta el archivo" }, { status: 400 });

  const res = await fetch(`${API}/v1/assets`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-filename": filename,
      "content-type": contentType,
      "x-captured-at": capturedAt,
    },
    body: request.body,
    // @ts-expect-error -- requerido por undici para body de tipo stream
    duplex: "half",
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
