/**
 * Valida el parámetro `next` de los flujos de login para evitar open-redirects.
 * Solo se permiten rutas internas bajo "/app". Cualquier otra cosa -> fallback.
 */
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.includes("://") || next.includes("\\") || /[\x00-\x1f\x7f]/.test(next)) return fallback;
  if (next !== "/app" && !next.startsWith("/app/") && !next.startsWith("/app?")) return fallback;
  return next;
}
