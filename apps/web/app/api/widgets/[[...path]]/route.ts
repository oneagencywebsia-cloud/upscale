import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { sameOrigin, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

/**
 * Proxy de Widgets (con sesión). Reenvía solo rutas conocidas:
 * /api/widgets, /preview, /:id, /:id/regenerate, /:id/image. Devuelve JSON o la imagen tal cual.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RUTAS = new RegExp(`^(?:|preview|${UUID}(?:/regenerate|/image)?)$`, "i");

async function reenviar(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  if (req.method !== "GET" && !sameOrigin(req)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });

  const { path = [] } = await ctx.params;
  const sub = path.join("/");
  if (!RUTAS.test(sub)) return NextResponse.json({ error: "no existe" }, { status: 404 });

  const hayCuerpo = req.method === "POST" || req.method === "PATCH";
  const cuerpo = hayCuerpo ? await req.text() : undefined;
  if (cuerpo && cuerpo.length > 100_000) return NextResponse.json({ error: "petición demasiado grande" }, { status: 413 });

  const res = await fetch(`${API}/v1/widgets${sub ? `/${sub}` : ""}${new URL(req.url).search}`, {
    method: req.method,
    headers: { authorization: `Bearer ${token}`, ...(cuerpo ? { "content-type": "application/json" } : {}) },
    body: cuerpo,
    cache: "no-store",
  });
  const tipo = res.headers.get("content-type") ?? "";
  if (tipo.startsWith("image/")) {
    const h = new Headers({ "content-type": tipo, "cache-control": res.headers.get("cache-control") ?? "no-store", "x-content-type-options": "nosniff" });
    const cd = res.headers.get("content-disposition");
    if (cd) h.set("content-disposition", cd);
    return new Response(await res.arrayBuffer(), { status: res.status, headers: h });
  }
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export const GET = reenviar;
export const POST = reenviar;
export const PATCH = reenviar;
export const DELETE = reenviar;
