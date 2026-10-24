import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { sameOrigin, forbidden } from "@/lib/guard";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

/**
 * Proxy de Notas: la sesión (cookie) se convierte en el token que entiende la API.
 * Solo reenvía rutas conocidas: /api/notes, /api/notes/tags, /api/notes/trash,
 * /api/notes/:id, /:id/restore, /:id/attachments[/:assetId[/ocr|/text]].
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RUTAS = new RegExp(
  `^(?:|tags|trash|${UUID}(?:/restore|/attachments(?:/${UUID}(?:/ocr|/text)?)?)?)$`,
  "i",
);

async function reenviar(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  if (req.method !== "GET" && !sameOrigin(req)) return forbidden();
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "no autorizado" }, { status: 401 });

  const { path = [] } = await ctx.params;
  const sub = path.join("/");
  if (!RUTAS.test(sub)) return NextResponse.json({ error: "no existe" }, { status: 404 });

  const url = new URL(req.url);
  const hayCuerpo = req.method === "POST" || req.method === "PATCH";
  const cuerpo = hayCuerpo ? await req.text() : undefined;
  if (cuerpo && cuerpo.length > 600_000) return NextResponse.json({ error: "la nota es demasiado grande" }, { status: 413 });

  const res = await fetch(`${API}/v1/notes${sub ? `/${sub}` : ""}${url.search}`, {
    method: req.method,
    headers: { authorization: `Bearer ${token}`, ...(cuerpo ? { "content-type": "application/json" } : {}) },
    body: cuerpo,
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export const GET = reenviar;
export const POST = reenviar;
export const PATCH = reenviar;
export const DELETE = reenviar;
