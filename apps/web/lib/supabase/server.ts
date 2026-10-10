import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient, type SetAllCookies } from "@supabase/ssr";

/** Cliente Supabase para Server Components / route handlers (lee y escribe cookies).
 *  `cache`: dentro de una misma petición se reutiliza el mismo cliente. */
export const supabaseServer = cache(async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        // el tipo va explícito: el parámetro de `setAll` no se puede inferir
        // (la opción `cookies` es una unión de formas) y salía como `any`, lo
        // que dejaba `tsc --noEmit` siempre en rojo y por tanto inservible como
        // red de seguridad.
        setAll: ((toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            /* llamado desde un Server Component: lo maneja el middleware */
          }
        }) satisfies SetAllCookies,
      },
    },
  );
});

/** Devuelve el usuario actual o null. Valida contra Supabase (viaje de red),
 *  así que se memoiza por petición: layout + página lo piden y pagaban dos. */
export const getUser = cache(async function getUser() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** access_token de la sesión actual, para llamar a la API de Upscale. Memoizado
 *  por petición: cada llamada a la API de una misma página lo repetía. */
export const getAccessToken = cache(async function getAccessToken(): Promise<string | null> {
  const supabase = await supabaseServer();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
});
