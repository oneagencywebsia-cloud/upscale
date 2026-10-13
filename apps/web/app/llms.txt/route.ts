import { FAQ, STEPS } from "@/components/landing/content";
import { PLANS, REFERRAL, gbHuman } from "@/lib/plans";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Resumen en texto plano para asistentes de IA (convención llms.txt):
 *  qué es, para quién, cómo se usa y respuestas cortas a lo que más se pregunta. */
export async function GET() {
  const base = await siteUrl();
  const free = PLANS[0];
  const body = `# Upscale

> Upscale guarda tus fotos, vídeos y audio en su calidad original (sin recomprimir) y te deja verlos y descargarlos idénticos desde cualquier dispositivo. Gratis hasta ${gbHuman(free.bytes)}, sin tarjeta.

## Cómo funciona
${STEPS.map((s, i) => `${i + 1}. ${s.t}: ${s.d}`).join("\n")}

## Planes
${PLANS.map((p) => `- ${p.name}: ${gbHuman(p.bytes)}, archivos de hasta ${gbHuman(p.maxFileBytes)}${p.priceMonthEur ? ` (${p.priceMonthEur.toLocaleString("es-ES")} €/mes, próximamente)` : " (gratis)"}`).join("\n")}
- Invita y gana: +${gbHuman(REFERRAL.inviterBonusBytes)} para quien invita y +${gbHuman(REFERRAL.invitedBonusBytes)} para el amigo, hasta +${gbHuman(REFERRAL.maxRewarded * REFERRAL.inviterBonusBytes)}.

## Preguntas frecuentes
${FAQ.map((f) => `### ${f.q}\n${f.a}`).join("\n\n")}

## Enlaces
- [Portada y registro](${base}/)
- [Privacidad](${base}/privacidad)
- [Términos de uso](${base}/terminos)
`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
