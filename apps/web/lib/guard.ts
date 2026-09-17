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

/**
 * Para rutas GET que NO se pueden proteger con `sameOrigin()` porque son
 * navegaciones o `src` de medios (ahí el navegador no manda `Origin`, y el
 * `Referer` no siempre llega: bloquear por él se arriesga a romper la descarga
 * o la reproducción en algún navegador). Se usa `Sec-Fetch-Site`, que lo pone
 * el propio navegador y la página atacante no puede falsear: solo se rechaza
 * lo que viene marcado explícitamente como de OTRO sitio. Si la cabecera no
 * llega (navegador viejo), se deja pasar — igual que antes.
 *
 * Con esto, una web cualquiera ya no puede colar un <img src=".../api/dl-all">
 * y poner al servidor a empaquetar la biblioteca entera en un ZIP.
 */
export function crossSite(request: Request): boolean {
  return request.headers.get("sec-fetch-site") === "cross-site";
}

export function forbidden() {
  return Response.json({ error: "origen no permitido" }, { status: 403 });
}
