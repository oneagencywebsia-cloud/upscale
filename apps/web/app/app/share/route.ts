import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { publicUrl } from "@/lib/origin";

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
  if (!token) return NextResponse.redirect(publicUrl("/?next=/app", request), 303);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > SHARE_MAX_BYTES) {
    return NextResponse.redirect(publicUrl("/app?shared=0&tooBig=1", request), 303);
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
        // el tamaño exacto: la API comprueba cuota y que el archivo llegue entero (sin él, no se podía)
        "content-length": String(file.size),
      },
      body: file.stream(),
      // @ts-expect-error -- requerido por undici para body de tipo stream
      duplex: "half",
    }).catch(() => null);
    if (res && res.ok) ok++;
  }

  // Sin archivos pero con texto o un enlace (Compartir desde el navegador, Notas, WhatsApp…): se guarda como nota.
  if (!files.length && form) {
    const campo = (n: string) => (typeof form.get(n) === "string" ? (form.get(n) as string).trim() : "");
    const titulo = campo("title").slice(0, 200);
    const texto = [campo("text"), campo("url")].filter(Boolean).join("\n\n").slice(0, 50_000);
    if (titulo || texto) {
      const res = await fetch(`${API}/v1/notes`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ title: titulo, text: texto }),
      }).catch(() => null);
      const nota = res && res.ok ? ((await res.json().catch(() => null)) as { id?: string } | null) : null;
      if (nota?.id) return NextResponse.redirect(publicUrl(`/app/notas/${nota.id}`, request), 303);
    }
  }

  return NextResponse.redirect(publicUrl(`/app?shared=${ok}`, request), 303);
}

export async function GET(request: Request) {
  return NextResponse.redirect(publicUrl("/app", request), 303);
}
