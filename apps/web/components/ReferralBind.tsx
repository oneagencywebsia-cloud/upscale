"use client";

import { useEffect } from "react";

const KEY = "upscale-ref";

/** Dentro de la app: si la persona llegó con un enlace de invitación, lo enlaza
 *  UNA vez (el premio se paga cuando guarde su primer archivo). */
export default function ReferralBind() {
  useEffect(() => {
    let code: string | null = null;
    try {
      code = localStorage.getItem(KEY);
    } catch {
      return;
    }
    if (!code) return;
    fetch("/api/referral", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) })
      .then((r) => {
        // 200 = enlazada; 4xx = no vale (ya tenía invitación, cuenta con archivos…): en ambos casos se olvida
        if (r.status < 500) {
          try { localStorage.removeItem(KEY); } catch { /* nada */ }
        }
      })
      .catch(() => {
        /* sin red: se reintenta en la próxima carga */
      });
  }, []);
  return null;
}
