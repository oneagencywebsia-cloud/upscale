import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { sameOrigin, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export const runtime = "nodejs";
// Un original ya no está limitado a 2GB (se trocea automáticamente al
// guardarlo, ver putSplit en la API) — un archivo de decenas de GB puede
// tardar bastante en subir según el ancho de banda de SUBIDA del usuario
// (nada que ver con la descarga desde Telegram, tramo totalmente distinto).
// Nota: maxDuration es una config específica de Vercel Serverless Functions;
// en este despliegue autoalojado (Docker/EasyPanel) no tiene efecto — se deja
// documentado por si algún día se despliega ahí.
export const maxDuration = 21_600; // 6h

/**
 * Sube un archivo (navegador o Atajo de iOS). El cliente manda el binario crudo
 * como cuerpo (no multipart); aquí se hace passthrough del stream a la API sin
 * bufferizar. Auth: sesión Supabase (navegador) o cabecera X-Upload-Token (Atajo).
 */
export async function POST(request: Request) {
  const uploadToken = request.headers.get("x-upload-token");

  let auth: Record<string, string>;
  if (uploadToken) {
    auth = { "x-upload-token": uploadToken };
  } else {
    if (!sameOrigin(request)) return forbidden();
    const token = await getAccessToken();
    if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
    auth = { authorization: `Bearer ${token}` };
  }

  const filename = request.headers.get("x-filename") ?? "IMG";
  const contentType = request.headers.get("content-type") || "application/octet-stream";
  const capturedAt = request.headers.get("x-captured-at") ?? new Date().toISOString();

  if (!request.body) return NextResponse.json({ error: "falta el archivo" }, { status: 400 });

  const res = await fetch(`${API}/v1/assets`, {
    method: "POST",
    headers: { ...auth, "x-filename": filename, "content-type": contentType, "x-captured-at": capturedAt },
    body: request.body,
    // @ts-expect-error -- requerido por undici para body de tipo stream
    duplex: "half",
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
