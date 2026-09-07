"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function AuthButtons({ next = "/app", label = "Registrar" }: { next?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"google" | "apple" | "email" | null>(null);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function oauth(provider: "google" | "apple") {
    setBusy(provider);
    const supabase = supabaseBrowser();
    const redirectTo = `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) {
      setBusy(null);
      setMsg(`${provider}: ${error.message}`);
    }
  }

  async function withEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy("email");
    setMsg(null);
    const supabase = supabaseBrowser();
    const { error, data } =
      mode === "signup"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
    setBusy(null);
    if (error) {
      setMsg(error.message);
      return;
    }
    if (data.session) {
      router.push(next);
      router.refresh();
    } else {
      setMsg("Cuenta creada. Revisa tu correo para confirmarla y luego entra.");
      setMode("signin");
    }
  }

  return (
    <div className="auth-box">
      <div className="auth-buttons">
        <button className="oauth google" type="button" disabled={busy !== null} onClick={() => oauth("google")}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.15-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
            <path fill="#FBBC05" d="M5.85 14.1a6.6 6.6 0 0 1 0-4.2V7.05H2.18a11 11 0 0 0 0 9.9l3.67-2.85Z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05L5.85 9.9C6.71 7.3 9.14 5.38 12 5.38Z" />
          </svg>
          {busy === "google" ? "Abriendo…" : `${label} con Google`}
        </button>

        <button className="oauth apple" type="button" disabled={busy !== null} onClick={() => oauth("apple")}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.05 12.04c-.03-2.9 2.37-4.29 2.48-4.36-1.35-1.98-3.46-2.25-4.21-2.28-1.79-.18-3.5 1.05-4.41 1.05-.91 0-2.31-1.03-3.8-1-1.96.03-3.77 1.14-4.78 2.9-2.04 3.54-.52 8.78 1.46 11.65.97 1.4 2.12 2.98 3.63 2.92 1.46-.06 2.01-.94 3.77-.94 1.76 0 2.26.94 3.8.91 1.57-.03 2.56-1.43 3.52-2.84 1.11-1.63 1.57-3.21 1.6-3.29-.04-.02-3.06-1.18-3.09-4.67ZM14.2 3.62c.8-.98 1.35-2.33 1.2-3.68-1.16.05-2.57.77-3.4 1.74-.74.86-1.39 2.24-1.22 3.56 1.3.1 2.62-.66 3.42-1.62Z" />
          </svg>
          {busy === "apple" ? "Abriendo…" : `${label} con Apple`}
        </button>
      </div>

      <div className="auth-or"><span>o con email</span></div>

      <form className="auth-email" onSubmit={withEmail}>
        <input type="email" placeholder="tu@email.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="contraseña (mín. 6)" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn primary" type="submit" disabled={busy !== null}>
          {busy === "email" ? "…" : mode === "signup" ? "Crear cuenta" : "Entrar"}
        </button>
        <button className="auth-switch" type="button" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
          {mode === "signup" ? "¿Ya tienes cuenta? Entrar" : "¿Nuevo? Crear cuenta"}
        </button>
      </form>

      {msg && <p className="auth-msg">{msg}</p>}
    </div>
  );
}
