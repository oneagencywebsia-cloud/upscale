import type { Metadata, Viewport } from "next";
import Link from "next/link";
import PublicPage from "@/components/public/PublicPage";
import { pageMeta, publicViewport, articleLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const viewport: Viewport = publicViewport;
const PATH = "/formatos";
export const metadata: Metadata = pageMeta(PATH);

const FILAS = [
  ["Fotos", "HEIC, HEIF, JPG, PNG, GIF, WebP, AVIF, TIFF, RAW (DNG)", "HEIC, HEIF, AVIF, TIFF y DNG pasan a JPG a resolución completa, con fecha, cámara y ubicación. JPG, PNG y GIF se descargan tal cual."],
  ["Vídeos", "MOV, MP4, MKV, AVI y otros", "Los vídeos HEVC, ProRes, MKV o AVI se ofrecen como MP4 H.264 de hasta 1080p, que se abre en cualquier aparato. Los MP4 y MOV H.264 se descargan tal cual."],
  ["Audio", "MP3, M4A, AAC, WAV, FLAC, OGG, OPUS, AIFF, CAF, AMR, WMA", "CAF, AMR, WMA, AIFF, OGG y OPUS pasan a MP3 con sus etiquetas. MP3, M4A, WAV y FLAC se descargan tal cual."],
] as const;

export default async function Page() {
  return (
    <PublicPage
      path={PATH}
      title="Formatos compatibles"
      lead="Si tu móvil o tu cámara lo graba, Upscale lo guarda. Y al descargar puedes elegir entre el archivo exacto o una versión que se abre en cualquier aparato."
    >
      <div className="pub-table-wrap">
        <table className="pub-table stack">
          <caption className="sr-only">Formatos que admite Upscale y qué pasa al descargarlos en modo Compatible</caption>
          <thead>
            <tr><th scope="col">Tipo</th><th scope="col">Qué puedes guardar</th><th scope="col">Descarga «Compatible»</th></tr>
          </thead>
          <tbody>
            {FILAS.map(([t, g, c]) => (
              <tr key={t}><th scope="row">{t}</th><td data-label="Qué puedes guardar">{g}</td><td data-label="Descarga «Compatible»">{c}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Original o Fácil de abrir</h2>
      <p>
        <b>Original</b> te da el archivo exacto que subiste. <b>Fácil de abrir</b> (lo normal) convierte solo lo que muchos aparatos no abren,
        para que lo puedas ver o compartir sin instalar nada. Lo que ya es universal no se toca. El original sigue guardado: puedes bajarlo cuando quieras.
      </p>
      <p>
        Puedes cambiar de modo en el menú de la galería, en la hoja de descarga o en tu perfil. Si un archivo no se puede convertir, recibes el original
        (si bajas varios, queda anotado en un archivo LEEME). Para copias de seguridad completas, la descarga de toda la biblioteca empieza en Original.
      </p>

      <h2>¿Por qué existen tantos formatos?</h2>
      <p>
        Los iPhone guardan las fotos en HEIC y los vídeos en HEVC porque ocupan la mitad con la misma calidad, pero no todos los programas los abren.
        Más detalles en la guía <Link href="/guias/heic-o-jpg">HEIC o JPG</Link>.
      </p>
    </PublicPage>
  );
}
