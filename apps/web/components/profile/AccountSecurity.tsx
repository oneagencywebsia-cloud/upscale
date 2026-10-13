"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

const PROVIDER_LABEL: Record<string, string> = { google: "Google", apple: "Apple", email: "Correo y contraseña" };

type Msg = { ok: boolean; text: string } | null;

/** Correo, contraseña, métodos de acceso y cierre de sesión. */
export default function AccountSecurity({ email, providers }: { email: string; providers: string[] }) {
  const router = useRouter();
  const [newEmail, setNewEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState<Msg>(null);
  const [emailBusy, setEmailBusy] = useState(false);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const [outBusy, setOutBusy] = useState<"here" | "all" | null>(null);
  const hasPassword = providers.includes("email");

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault();
    const target = newEmail.trim().toLowerCase();
    if (!target || target === email.toLowerCase() || emailBusy) return;
    setEmailBusy(true);
    setEmailMsg(null);
    const { error } = await supabaseBrowser().auth.updateUser({ email: target });
    setEmailBusy(false);
    if (error) {
      setEmailMsg({ ok: false, text: error.message });
      return;
    }
    setEmailMsg({ ok: true, text: `Te hemos enviado un enlace de confirmación a ${target}. El cambio se aplica al abrirlo.` });
    setNewEmail("");
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwBusy) return;
    if (pw.length < 8) return setPwMsg({ ok: false, text: "Usa al menos 8 caracteres." });
    if (pw !== pw2) return setPwMsg({ ok: false, text: "Las dos contraseñas no coinciden." });
    setPwBusy(true);
    setPwMsg(null);
    const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) {
      setPwMsg({ ok: false, text: error.message });
      return;
    }
    setPw("");
    setPw2("");
    setPwMsg({ ok: true, text: "Contraseña actualizada." });
  }

  async function signOut(scope: "local" | "global") {
    if (scope === "global" && !confirm("¿Cerrar la sesión en TODOS tus dispositivos, incluido este?")) return;
    setOutBusy(scope === "local" ? "here" : "all");
    await supabaseBrowser().auth.signOut({ scope });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="psec">
      <div className="pline">
        <span className="pline-k">Correo actual</span>
        <b className="pline-v">{email || "—"}</b>
      </div>
      <div className="pline">
        <span className="pline-k">Entras con</span>
        <span className="pchips">
          {(providers.length ? providers : ["email"]).map((p) => (
            <span key={p} className="pchip">
              {PROVIDER_LABEL[p] ?? p}
            </span>
          ))}
        </span>
      </div>

      <form className="pform-inline" onSubmit={changeEmail}>
        <label className="pfield">
          <span>Cambiar correo</span>
          <input
            type="email"
            value={newEmail}
            autoComplete="email"
            placeholder="nuevo@correo.com"
            onChange={(e) => setNewEmail(e.target.value)}
          />
        </label>
        <button className="btn sm" type="submit" disabled={!newEmail.trim() || emailBusy}>
          {emailBusy ? "Enviando…" : "Cambiar"}
        </button>
        {emailMsg && (
          <p className={`pmsg ${emailMsg.ok ? "ok" : "bad"}`} role="status">
            {emailMsg.text}
          </p>
        )}
      </form>

      <form className="pform-inline" onSubmit={changePassword}>
        <label className="pfield">
          <span>{hasPassword ? "Nueva contraseña" : "Crear contraseña"}</span>
          <input
            type="password"
            value={pw}
            autoComplete="new-password"
            minLength={8}
            placeholder="mínimo 8 caracteres"
            onChange={(e) => setPw(e.target.value)}
          />
        </label>
        <label className="pfield">
          <span>Repítela</span>
          <input type="password" value={pw2} autoComplete="new-password" onChange={(e) => setPw2(e.target.value)} />
        </label>
        <button className="btn sm" type="submit" disabled={!pw || pwBusy}>
          {pwBusy ? "Guardando…" : hasPassword ? "Cambiar contraseña" : "Crear contraseña"}
        </button>
        {!hasPassword && (
          <p className="pmsg">Entras con Google o Apple. Si creas una contraseña, podrás entrar también con tu correo.</p>
        )}
        {pwMsg && (
          <p className={`pmsg ${pwMsg.ok ? "ok" : "bad"}`} role="status">
            {pwMsg.text}
          </p>
        )}
      </form>

      <div className="pform-actions">
        <button className="btn sm" type="button" disabled={outBusy !== null} onClick={() => signOut("local")}>
          {outBusy === "here" ? "Saliendo…" : "Cerrar sesión aquí"}
        </button>
        <button className="btn ghost sm" type="button" disabled={outBusy !== null} onClick={() => signOut("global")}>
          {outBusy === "all" ? "Saliendo…" : "Cerrar sesión en todos los dispositivos"}
        </button>
      </div>
    </div>
  );
}
