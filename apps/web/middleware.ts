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
export async function middleware(req: NextRequest) {
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
    // `_api/` queda FUERA: es el proxy a la API de Upscale (miniaturas con URL
    // firmada por HMAC, sin sesión). Pasar cada miniatura por el middleware
    // era un viaje a Supabase por imagen.
    "/((?!_next/static|_next/image|_api/|favicon.ico|favicon-32.png|icons/|icon.svg|icon-maskable.svg|icon-192.png|icon-512.png|apple-icon.png|apple-touch-icon.png|manifest.webmanifest|sw.js|robots.txt|sitemap.xml|llms.txt|opengraph-image).*)",
  ],
};
