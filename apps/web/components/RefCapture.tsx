"use client";

import { useEffect } from "react";

const KEY = "upscale-ref";

/** Portada: si llega con ?ref=CODIGO (enlace de «invita y gana»), lo guarda para
 *  aplicarlo cuando la persona ya tenga cuenta (ver ReferralBind). */
export default function RefCapture() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(location.search).get("ref");
      if (ref && /^[A-Za-z0-9_-]{3,40}$/.test(ref)) localStorage.setItem(KEY, ref.toUpperCase());
    } catch {
      /* navegación privada: sin invitación, no pasa nada */
    }
  }, []);
  return null;
}
