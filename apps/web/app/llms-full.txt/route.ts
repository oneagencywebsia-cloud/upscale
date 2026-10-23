import { FAQ, FAQ_EXTRA, STEPS } from "@/components/landing/content";
import { PLANS, REFERRAL, gbHuman } from "@/lib/plans";
import { siteUrl } from "@/lib/site";
import { PAGINAS, CONTENIDO_ACTUALIZADO } from "@/lib/seo";

export const dynamic = "force-dynamic";

/** Versión larga de llms.txt: todo el contenido útil de la web en un solo texto
 *  plano, para asistentes de IA que prefieren leer una vez en lugar de rastrear. */
export async function GET() {
  const base = await siteUrl();
  const free = PLANS[0];
  const body = `# Upscale — documentación completa

> Upscale guarda tus fotos, vídeos y audio en su calidad original (sin recomprimir) y te deja verlos y descargarlos idénticos desde cualquier dispositivo. Gratis hasta ${gbHuman(free.bytes)}, sin tarjeta. Idioma: español. Última revisión: ${CONTENIDO_ACTUALIZADO}.

## Qué es
Upscale es una nube personal de fotos, vídeos y música. El archivo original se guarda byte a byte, sin recompresión; las miniaturas y las copias ligeras para reproducir en la app son derivadas y no sustituyen al original. Cada persona ve únicamente sus archivos. Funciona en el navegador y se puede instalar como app (PWA) en móvil y ordenador.

## Cómo funciona
${STEPS.map((s, i) => `${i + 1}. ${s.t}: ${s.d}`).join("\n")}

## Formatos
- Fotos: HEIC, HEIF, JPG, PNG, GIF, WebP, AVIF, TIFF, RAW (DNG).
- Vídeos: MOV, MP4, MKV, AVI y otros.
- Audio: MP3, M4A, AAC, WAV, FLAC, OGG, OPUS, AIFF, CAF, AMR, WMA.
- Descarga «Original»: el archivo exacto. Descarga «Compatible» (por defecto): convierte HEIC/HEIF/AVIF/TIFF/DNG a JPG, vídeos HEVC/ProRes/MKV/AVI a MP4 H.264 de hasta 1080p y audios CAF/AMR/WMA/AIFF/OGG/OPUS a MP3; lo que ya se abre en todas partes se descarga tal cual.

## Planes
${PLANS.map((p) => `- ${p.name}: ${gbHuman(p.bytes)}, archivos de hasta ${gbHuman(p.maxFileBytes)}${p.priceMonthEur ? ` (${p.priceMonthEur.toLocaleString("es-ES")} €/mes, propuesta; aún no se puede contratar)` : " (gratis)"}`).join("\n")}
- Invita y gana: +${gbHuman(REFERRAL.inviterBonusBytes)} para quien invita y +${gbHuman(REFERRAL.invitedBonusBytes)} para el amigo cuando guarda su primera foto, hasta +${gbHuman(REFERRAL.maxRewarded * REFERRAL.inviterBonusBytes)}.

## Preguntas frecuentes
${[...FAQ, ...FAQ_EXTRA].map((f) => `### ${f.q}\n${f.a}`).join("\n\n")}

## Páginas
${PAGINAS.map((p) => `- ${base}${p.path} — ${p.title}`).join("\n")}
`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
