import type { Metadata } from "next";
import { headers } from "next/headers";
import { listTokens, getIngestAccess } from "@/lib/api";
import TokenManager from "@/components/TokenManager";
import IngestBind from "@/components/IngestBind";
import PreviewsRetry from "@/components/PreviewsRetry";
import DeleteAccount from "@/components/DeleteAccount";
import DownloadAllButton from "@/components/DownloadAllButton";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ajustes" };

export default async function AjustesPage() {
  let tokens: Awaited<ReturnType<typeof listTokens>>["tokens"] = [];
  try {
    ({ tokens } = await listTokens());
  } catch {
    /* API caída */
  }

  const telegram = await getIngestAccess();
  const verTelegram = telegram.isYou || telegram.canBind;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3001";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const endpoint = `${proto}://${host}/api/upload`;

  return (
    <div className="app">
      <div className="libhead">
        <div>
          <h2>Ajustes</h2>
          <p>Tu cuenta y tus datos</p>
        </div>
      </div>

      <section className="panel">
        <h3>Subir tus cosas</h3>
        <p className="panel-lede">
          Pulsa el botón <b>↑</b> de arriba y elige lo que quieras (en el ordenador también puedes arrastrarlo a la página). Fotos, vídeos y música, todo a la vez.
        </p>
        <p className="panel-lede">
          Consejo: si subes un vídeo muy grande desde el iPhone, el propio iPhone puede bajarle la calidad antes de enviarlo. No lo hace Upscale.
        </p>
      </section>

      <section className="panel">
        <h3>Tus datos</h3>
        <p className="panel-lede">Descarga todo de una vez, tal cual lo subiste. Es tuyo siempre.</p>
        <p>
          <DownloadAllButton />
        </p>
        <p className="panel-lede">
          <Link href="/privacidad">Privacidad</Link> · <Link href="/terminos">Términos</Link>
        </p>
      </section>

      {verTelegram && (
        <section className="panel">
          <h3>Vídeo 4K / 60 fps / HEVC — por Telegram</h3>
          <p className="panel-lede">
            iOS <b>recodifica</b> el 4K/60 (a 1080p/30, ~1/8 del tamaño) por cualquier vía web o
            Atajo — no hay ajuste que lo evite. La <b>única</b> forma inalámbrica de subir el
            original intacto es <b>Telegram «Enviar como archivo»</b>, y Upscale lo recoge solo:
          </p>
          <ol className="steps">
            <li>
              En <b>Fotos</b>, selecciona los vídeos → <b>Compartir</b> → <b>Telegram</b> →{" "}
              <b>Mensajes guardados</b>.
            </li>
            <li>
              En la pantalla de envío de Telegram, pulsa <b>«···»</b> (o mantén pulsada la
              miniatura) → <b>«Enviar como archivo»</b>. <b>Importante:</b> como archivo, no como vídeo.
            </li>
            <li>
              En 20-30 s aparece en tu biblioteca de Upscale — <b>4K · 60 fps · HEVC · íntegro</b>{" "}
              (mismo SHA-256). Telegram borra el mensaje de Mensajes guardados al terminar.
            </li>
          </ol>
          <p className="panel-lede">
            Es la misma cuenta de Telegram con la que configuraste el almacén, así que no hay que
            añadir nada. Límite 2 GB por archivo (4 GB con Telegram Premium). También vale para
            fotos que quieras 100 % garantizadas (envíalas como archivo).
          </p>
          <p className="panel-lede">
            <b>Live Photos:</b> envía la <b>foto (.HEIC)</b> y su <b>vídeo (.MOV)</b> —los dos tienen
            el mismo nombre (<code>IMG_1234</code>)—. Upscale los une solos: en la foto verás el
            distintivo <b>LIVE</b> y se anima al <b>mantener pulsado</b>.
          </p>
          <IngestBind />
        </section>

      )}

      <details className="panel adv">
        <summary>Opciones avanzadas (para quien sabe de móviles)</summary>
      <section className="adv-sec">
        <h3>Atajo de iOS (opcional, para lotes de fotos / vídeo normal)</h3>
        <p className="panel-lede">
          Crea un token y úsalo en un Atajo como cabecera <code>X-Upload-Token</code>. Endpoint:{" "}
          <code>{endpoint}</code>. Estructura: <i>Repetir con cada</i> →{" "}
          <i>Obtener contenido de la URL</i> (POST, cabecera del token, cuerpo = Archivo =
          <i> Elemento de repetición</i>). Recuerda: por esta vía el vídeo 4K/60 llega recodificado
          {verTelegram ? " — para ese usa Telegram." : "."}
        </p>
        <TokenManager initialTokens={tokens} />
      </section>

      <section className="adv-sec">
        <h3>Vídeos que tardan en abrirse</h3>
        <p className="panel-lede">
          Si un vídeo tarda mucho en abrirse o se corta, pulsa aquí para que Upscale lo vuelva a preparar.
        </p>
        <PreviewsRetry />
      </section>
      </details>

      <section className="panel danger-zone" id="borrar">
        <h3>Borrar mi cuenta</h3>
        <p className="panel-lede">Elimina tu cuenta y todos tus archivos para siempre. Descarga antes lo que quieras conservar.</p>
        <DeleteAccount />
      </section>

    </div>
  );
}
