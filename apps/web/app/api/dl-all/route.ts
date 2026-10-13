import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/supabase/server";
import { crossSite, forbidden } from "@/lib/guard";
import { publicUrl } from "@/lib/origin";

const API = process.env.UPSCALE_API_URL ?? "http://localhost:8080";

export const runtime = "nodejs";
export const maxDuration = 800;

/** Página mínima para errores: esta ruta se abre en una pestaña nueva (descarga),
 *  y un JSON crudo ahí es incomprensible. */
function errorPage(msg: string, status: number): Response {
  const safe = msg.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Descarga</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0d14;color:#eef2fb;text-align:center;padding:24px}
main{max-width:30rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#98a2b8;margin:0 0 1.25rem}a{display:inline-block;padding:.7rem 1.4rem;border-radius:12px;background:#4fc5dc;color:#04121a;font-weight:700;text-decoration:none}</style></head>
<body><main><h1>No se pudo empezar la descarga</h1><p>${safe}</p><a href="/app">Volver a mi biblioteca</a></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

/** Lo que el navegador manda (formulario o JSON) → cuerpo para la API. Solo campos conocidos. */
async function cuerpoDe(request: Request): Promise<Record<string, unknown>> {
  const ct = request.headers.get("content-type") ?? "";
  let raw: Record<string, unknown> = {};
  if (ct.includes("application/json")) {
    raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } else {
    const f = await request.formData().catch(() => null);
    if (f) for (const [k, v] of f.entries()) if (typeof v === "string") raw[k] = v;
  }
  const out: Record<string, unknown> = {};
  for (const k of ["ids", "kind", "fav", "album", "q", "camera", "from", "to", "part", "of"]) if (raw[k] !== undefined && raw[k] !== "") out[k] = raw[k];
  return out;
}

async function pasar(request: Request, init: { method: "GET" | "POST"; path: string; body?: Record<string, unknown> }) {
  if (crossSite(request)) return forbidden();
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get("host")) return forbidden();
    } catch {
      return forbidden();
    }
  }
  const token = await getAccessToken();
  if (!token) return NextResponse.redirect(publicUrl("/", request), 303);

  let upstream: Response;
  try {
    upstream = await fetch(`${API}${init.path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      // si el navegador cancela la descarga, se corta también hacia la API
      // (sin esto seguía bajando y empaquetando para nadie)
      signal: request.signal,
    });
  } catch {
    return errorPage("No hay conexión con el servidor. Inténtalo de nuevo en un momento.", 502);
  }

  if (!upstream.ok || !upstream.body) {
    const j = (await upstream.json().catch(() => ({}))) as { error?: string };
    return errorPage(j.error ?? "No se pudo generar la descarga.", upstream.status || 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": upstream.headers.get("content-disposition") ?? 'attachment; filename="Recuerdos.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Descarga TODO (o `?ids=a,b,c`) en un ZIP. Se mantiene por enlaces antiguos. */
export async function GET(request: Request) {
  const u = new URL(request.url);
  const body: Record<string, unknown> = {};
  for (const k of ["ids", "kind", "fav", "album", "q", "camera", "from", "to", "part", "of"]) {
    const v = u.searchParams.get(k);
    if (v) body[k] = v;
  }
  return pasar(request, { method: "POST", path: "/v1/assets/zip", body });
}

/** Lo normal: formulario con la selección (con cientos de fotos los ids no caben en una URL). */
export async function POST(request: Request) {
  return pasar(request, { method: "POST", path: "/v1/assets/zip", body: await cuerpoDe(request) });
}
