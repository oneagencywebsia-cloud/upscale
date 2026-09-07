import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

/** Intercambia el código OAuth de Google/Apple por una sesión y entra a la app. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  return NextResponse.redirect(new URL("/?error=auth", origin));
}
