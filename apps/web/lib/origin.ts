import "server-only";

/**
 * Origen público de una petición (https://tu-dominio) — NO `new URL(request.url).origin`.
 *
 * En producción la web corre en modo «standalone» detrás del proxy de
 * EasyPanel: `request.url` trae el host INTERNO del contenedor
 * (`http://0.0.0.0:80/...`), así que todo `redirect(new URL("/", request.url))`
 * mandaba a quien tenía la sesión caducada (o volvía de entrar con Google/Apple)
 * a `https://0.0.0.0:80/`. El host bueno llega en las cabeceras del proxy.
 */
export function publicOrigin(request: Request): string {
  const h = request.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]!.trim();
  if (!host) return new URL(request.url).origin;
  const proto = (h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")).split(",")[0]!.trim();
  return `${proto}://${host}`;
}

/** `new URL(path, origen público)`: para `NextResponse.redirect(...)`. */
export function publicUrl(path: string, request: Request): URL {
  return new URL(path, publicOrigin(request));
}
