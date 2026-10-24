import type { Metadata, Viewport } from "next";
import Link from "next/link";
import PublicPage from "@/components/public/PublicPage";
import { pageMeta, publicViewport, articleLd, PAGINAS } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const viewport: Viewport = publicViewport;
const PATH = "/guias/heic-o-jpg";
export const metadata: Metadata = pageMeta(PATH);

export default async function Page() {
  const base = await siteUrl();
  const me = PAGINAS.find((p) => p.path === PATH)!;
  return (
    <PublicPage
      path={PATH}
      title="HEIC o JPG: cuál conviene y cómo abrir HEIC en Windows y Android"
      lead="Tu iPhone hace las fotos en HEIC y a veces no se abren en otros aparatos. Aquí se explica qué es, en qué se diferencia del JPG y cómo verlas sin perder calidad."
      crumbs={[{ name: "Guías", path: "/guias" }]}
      jsonLd={[articleLd(base, PATH, me.title, me.description)]}
    >
      <h2>Qué es HEIC</h2>
      <p>
        HEIC es el formato de imagen que usan los iPhone desde hace años. Guarda la misma calidad que un JPG en aproximadamente la mitad de espacio
        y admite más color y rango dinámico (HDR). Por eso Apple lo eligió como formato por defecto.
      </p>

      <h2>HEIC frente a JPG</h2>
      <div className="pub-table-wrap">
        <table className="pub-table stack">
          <caption className="sr-only">Comparativa entre HEIC y JPG</caption>
          <thead><tr><th scope="col"><span className="sr-only">Característica</span></th><th scope="col">HEIC</th><th scope="col">JPG</th></tr></thead>
          <tbody>
            <tr><th scope="row">Tamaño</th><td data-label="HEIC">Más pequeño, a igual calidad</td><td data-label="JPG">Más grande</td></tr>
            <tr><th scope="row">Color</th><td data-label="HEIC">Más profundidad (HDR)</td><td data-label="JPG">8 bits por canal</td></tr>
            <tr><th scope="row">Compatibilidad</th><td data-label="HEIC">Buena en Apple y Android reciente; en Windows suele requerir extensiones</td><td data-label="JPG">Se abre en cualquier parte</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Cómo abrir HEIC en Windows y Android</h2>
      <ul>
        <li><b>Windows:</b> suele hacer falta instalar las extensiones de imagen HEIF y de vídeo HEVC de la tienda de Microsoft, y algunas versiones no las incluyen gratis.</li>
        <li><b>Android:</b> las versiones recientes abren HEIC, pero algunas apps de edición o de mensajería no lo aceptan.</li>
        <li><b>La vía más sencilla:</b> descargar la foto ya convertida a JPG.</li>
      </ul>

      <h2>La solución de Upscale</h2>
      <p>
        Upscale guarda tu HEIC original sin tocarlo. Cuando descargas en modo <b>Fácil de abrir</b>, recibes un JPG a resolución completa, con la fecha, la cámara
        y la ubicación de la foto. Si prefieres el archivo exacto, eliges <b>Original</b>. Los vídeos HEVC y los audios poco comunes tienen su equivalente:
        mira todos los casos en <Link href="/formatos">Formatos compatibles</Link>.
      </p>
      <p>
        ¿Cómo hacer la copia en primer lugar? Sigue la guía de <Link href="/guias/guardar-fotos-iphone-sin-perder-calidad">guardar fotos del iPhone sin perder calidad</Link>.
      </p>
    </PublicPage>
  );
}
