import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { safeNext } from "@/lib/safe-next";

/** Refresca la sesión de Supabase y protege /app/*.
 *
 *  Usa `getSession()` (lee la cookie y SOLO llama a Supabase si el token está a
 *  punto de caducar y hay que refrescarlo). Antes usaba `getUser()`, que hace
 *  un viaje de red a Supabase en CADA petición: páginas, /api/* y hasta cada
 *  miniatura — la causa principal de que todo fuera lento.
 *
 *  Es seguro: aquí solo se decide una redirección de comodidad. Quien sirve
 *  datos valida el token de verdad: el layout de /app con `getUser()` y la API
 *  con `/auth/v1/user`. Una cookie falsificada pasa este filtro pero no ve
 *  nada. */
/** Un solo dominio canónico (para SEO y para que las sesiones no se partan entre
 *  hosts). Es opt-in: solo actúa con `CANONICAL_REDIRECT=1` y `SITE_URL` definidas,
 *  así que activar upscale.com no deja fuera a nadie hasta que el DNS esté listo.
 *  Manda `www.` y cualquier otro host (el de EasyPanel incluido) al dominio final. */
function aDominioCanonico(req: NextRequest): NextResponse | null {
  if (process.env.CANONICAL_REDIRECT !== "1") return null;
  const site = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (!site || (req.method !== "GET" && req.method !== "HEAD")) return null;
  let canon: URL;
  try {
    canon = new URL(site);
  } catch {
    return null;
  }
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (!host || host === canon.host.toLowerCase() || host.startsWith("localhost") || host.startsWith("127.0.0.1")) return null;
  return NextResponse.redirect(`${canon.origin}${req.nextUrl.pathname}${req.nextUrl.search}`, 308);
}

export async function middleware(req: NextRequest) {
  const canon = aDominioCanonico(req);
  if (canon) return canon;
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        // tipo explícito: sin él el parámetro entra como `any` (ver server.ts)
        setAll: ((toSet) => {
          toSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        }) satisfies SetAllCookies,
      },
    },
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { pathname } = req.nextUrl;
  const protectedPath = pathname === "/app" || pathname.startsWith("/app/");
  if (protectedPath && !session) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    url.searchParams.set("next", safeNext(pathname));
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: [
    // `api/upload` queda FUERA: Next 15.5 clona el cuerpo para el middleware y lo
    // RECORTA a 10 MB sin avisar (los vídeos grandes llegaban a medias y se
    // guardaban igual). La ruta valida la sesión ella misma.
    // `_api/` queda FUERA: es el proxy a la API de Upscale (miniaturas con URL
    // firmada por HMAC, sin sesión). Pasar cada miniatura por el middleware
    // era un viaje a Supabase por imagen.
    "/((?!api/upload|_next/static|_next/image|_api/|favicon.ico|favicon-32.png|icons/|icon.svg|icon-maskable.svg|icon-192.png|icon-512.png|apple-icon.png|apple-touch-icon.png|manifest.webmanifest|sw.js|robots.txt|sitemap.xml|llms.txt|llms-full.txt|opengraph-image).*)",
  ],
};
