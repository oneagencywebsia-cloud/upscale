import "server-only";

/** Datos del responsable. Se leen del entorno para no publicar datos personales
 *  en el código: define LEGAL_NAME y CONTACT_EMAIL en el servidor de la web. */
export function legalInfo(): { name: string; email: string | null; updated: string } {
  return {
    name: process.env.LEGAL_NAME?.trim() || "el titular de Upscale",
    email: process.env.CONTACT_EMAIL?.trim() || null,
    updated: "13 de octubre de 2026",
  };
}
