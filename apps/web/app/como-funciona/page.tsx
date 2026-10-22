import type { Metadata, Viewport } from "next";
import Link from "next/link";
import PublicPage from "@/components/public/PublicPage";
import { pageMeta, publicViewport, articleLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

import { STEPS } from "@/components/landing/content";

export const dynamic = "force-dynamic";
export const viewport: Viewport = publicViewport;
const PATH = "/como-funciona";
export const metadata: Metadata = pageMeta(PATH);

export default async function Page() {
  const base = await siteUrl();
  const howTo = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Cómo guardar tus fotos y vídeos en Upscale",
    description: "Crea tu cuenta, sube tus archivos y míralos desde cualquier dispositivo, idénticos al original.",
    totalTime: "PT1M",
    inLanguage: "es",
    url: `${base}${PATH}`,
    step: STEPS.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.t, text: s.d, url: `${base}${PATH}#paso-${i + 1}` })),
  };
  return (
    <PublicPage
      path={PATH}
      title="Cómo funciona Upscale"
      lead="Upscale guarda el original de tus fotos, vídeos y música, sin recomprimir, y te los devuelve idénticos desde cualquier dispositivo. Esto es todo lo que tienes que hacer."
      jsonLd={[howTo]}
    >
      <h2>Los 3 pasos</h2>
      <ol className="pub-steps">
        {STEPS.map((s, i) => (
          <li key={s.t} id={`paso-${i + 1}`}>
            <b>{s.t}</b>
            <span>{s.d}</span>
          </li>
        ))}
      </ol>

      <h2>Cómo subir tus archivos</h2>
      <ul>
        <li><b>Desde el móvil:</b> abre Upscale en el navegador, pulsa el botón de subir y elige lo que quieras. Puedes instalarla como app desde el menú de compartir, con Añadir a pantalla de inicio. En Android, una vez instalada, también aparece al compartir fotos desde otras apps.</li>
        <li><b>Desde el ordenador:</b> arrastra las fotos, vídeos y música a la ventana. Se pueden subir muchos a la vez y, si falla la conexión, se reintenta solo.</li>
        <li><b>Con un Atajo del iPhone:</b> si quieres automatizar la subida, en Ajustes puedes crear una clave y usarla desde un Atajo.</li>
      </ul>

      <h2>Qué pasa con tu original</h2>
      <p>
        Cada archivo se guarda tal cual lo hizo tu cámara, byte a byte, sin recomprimir. Nada de versiones «optimizadas»: lo que descargas
        es idéntico a lo que subiste. Si subes dos veces el mismo archivo no se duplica, así que no gastas espacio de más.
      </p>

      <h2>Cómo descargar</h2>
      <p>
        Puedes bajar un archivo suelto o seleccionar muchos y descargarlos en un ZIP, repartido en partes cómodas para el móvil y con barra de progreso.
        Al descargar eliges entre <b>Original</b>, el archivo exacto, y <b>Compatible</b>, que convierte lo que no se abre en todas partes.
        Mira qué se convierte en <Link href="/formatos">Formatos compatibles</Link>.
      </p>

      <h2>Tu privacidad</h2>
      <p>
        Cada persona ve únicamente lo suyo. Puedes llevarte todo en un ZIP o borrar tu cuenta y tus archivos cuando quieras desde Ajustes.
        Los detalles están en la <Link href="/privacidad">política de privacidad</Link>.
      </p>
    </PublicPage>
  );
}
