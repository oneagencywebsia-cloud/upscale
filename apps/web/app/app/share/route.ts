import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

/**
 * Objetivo del "Compartir" de iOS/Android (Web Share Target, declarado en el manifest).
 * Recibe los archivos compartidos desde Fotos y los reenvía a la API con la sesión
 * del usuario. Luego devuelve a la galería.
 */
export async function POST(request: Request) {
  const token = await getAccessToken();
  if (!token) return NextResponse.redirect(new URL("/?next=/app", request.url), 303);

  const form = await request.formData().catch(() => null);
  const files = form
    ? form.getAll("media").filter((x): x is File => x instanceof File && x.size > 0)
    : [];

  let ok = 0;
  for (const file of files) {
    const res = await fetch(`${API}/v1/assets`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "x-filename": encodeURIComponent(file.name || "IMG.bin"),
        "content-type": file.type || "application/octet-stream",
        "x-captured-at": new Date(file.lastModified || Date.now()).toISOString(),
      },
      body: file.stream(),
      // @ts-expect-error -- requerido por undici para body de tipo stream
      duplex: "half",
    }).catch(() => null);
    if (res && res.ok) ok++;
  }

  return NextResponse.redirect(new URL(`/app?shared=${ok}`, request.url), 303);
}

export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/app", request.url), 303);
}
