/**
 * Comprueba que una petición mutante viene del propio sitio (defensa CSRF además
 * del SameSite=Lax de las cookies de Supabase). El Atajo de iOS no usa estas rutas
 * (llama a /_api directamente), así que exigir mismo origen no rompe nada.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin) {
    // sin cabecera Origin: exigimos que el Referer, si existe, sea del mismo host
    const referer = request.headers.get("referer");
    if (!referer) return false;
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function forbidden() {
  return Response.json({ error: "origen no permitido" }, { status: 403 });
}
