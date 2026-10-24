import type { Metadata, Viewport } from "next";
import Link from "next/link";
import PublicPage from "@/components/public/PublicPage";
import { pageMeta, publicViewport, articleLd, PAGINAS } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const viewport: Viewport = publicViewport;
const PATH = "/guias/guardar-fotos-iphone-sin-perder-calidad";
export const metadata: Metadata = pageMeta(PATH);

export default async function Page() {
  const base = await siteUrl();
  const me = PAGINAS.find((p) => p.path === PATH)!;
  return (
    <PublicPage
      path={PATH}
      title="Cómo guardar las fotos del iPhone sin perder calidad"
      lead="Tu iPhone se llena y no quieres borrar nada. Esta guía explica cómo hacer una copia de seguridad de tus fotos y vídeos en su calidad original y liberar espacio sin riesgo."
      crumbs={[{ name: "Guías", path: "/guias" }]}
      jsonLd={[articleLd(base, PATH, me.title, me.description)]}
    >
      <h2>Por qué se pierde calidad sin que te des cuenta</h2>
      <p>
        Hay varias formas de «guardar» fotos y no todas conservan el original. Algunas apps y servicios reducen la calidad para ahorrar espacio, y el propio iPhone,
        con la opción <i>Optimizar almacenamiento del iPhone</i>, deja en el teléfono versiones más ligeras cuando se llena. Por eso conviene tener
        una copia aparte, con los archivos originales completos.
      </p>

      <h2>Paso a paso con Upscale</h2>
      <ol className="pub-steps">
        <li><b>Crea tu cuenta.</b><span>Entra en Upscale con Google o con tu correo. Son unos segundos y no hace falta tarjeta.</span></li>
        <li><b>Sube tus fotos y vídeos.</b><span>Desde el navegador del iPhone pulsa el botón de subir y elige lo que quieras, o instala Upscale como app desde el menú de compartir.</span></li>
        <li><b>Comprueba que están.</b><span>Abre la biblioteca y revisa que las fotos y vídeos se ven bien. Puedes mirar la ficha de cada archivo para ver su tamaño y datos.</span></li>
        <li><b>Libera espacio en el iPhone.</b><span>Cuando estés seguro de que todo está a salvo, borra del teléfono lo que ya tienes en Upscale.</span></li>
      </ol>

      <h2>Cómo sabes que es el original</h2>
      <p>
        Upscale guarda cada archivo sin perder calidad y, al descargarlo en modo <b>Original</b>, es idéntico al que subiste.
        Si subes el mismo archivo dos veces, no se duplica. Para verlo en cualquier aparato puedes descargar en modo <b>Fácil de abrir</b>:
        una foto HEIC pasa a JPG, por ejemplo, pero el original sigue guardado. Más en <Link href="/formatos">Formatos compatibles</Link>.
      </p>

      <h2>Consejos para no perder nada</h2>
      <ul>
        <li>No borres nada del iPhone hasta haber comprobado que se ve bien en la biblioteca.</li>
        <li>Si pasas fotos a un ordenador por cable, en los ajustes de Fotos elige <i>Mantener originales</i> en lugar de <i>Automático</i>.</li>
        <li>Haz la copia con regularidad: una vez al mes es suficiente para la mayoría de la gente.</li>
        <li>Descarga también todo de vez en cuando, desde Ajustes, si quieres una segunda copia en tu ordenador.</li>
      </ul>
      <p>Empieza con 5 GB gratis en <Link href="/planes">el plan Gratis</Link>.</p>
    </PublicPage>
  );
}
