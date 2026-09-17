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
/**
 * Tope de lo que se acepta por "Compartir". OJO: esto NO es un capricho de
 * producto, es autodefensa. `request.formData()` es la ÚNICA forma de leer un
 * multipart aquí, y parsea el cuerpo ENTERO en memoria antes de devolver nada
 * (no hay streaming posible sin un parser multipart propio). Compartir un 4K
 * de varios GB desde Android reventaría el proceso de Next por falta de
 * memoria y tiraría la web entera. Mejor decirlo que morirse.
 *
 * La vía buena para archivos enormes es "Subir" (POST crudo a /api/upload, que
 * sí va en streaming) o el Atajo de iOS.
 */
const SHARE_MAX_BYTES = 512 * 1024 * 1024;

export async function POST(request: Request) {
  const token = await getAccessToken();
  if (!token) return NextResponse.redirect(new URL("/?next=/app", request.url), 303);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > SHARE_MAX_BYTES) {
    return NextResponse.redirect(new URL("/app?shared=0&tooBig=1", request.url), 303);
  }

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
