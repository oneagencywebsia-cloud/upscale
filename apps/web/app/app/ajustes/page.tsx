import { headers } from "next/headers";
import { listTokens } from "@/lib/api";
import TokenManager from "@/components/TokenManager";

export const dynamic = "force-dynamic";

export default async function AjustesPage() {
  let tokens: Awaited<ReturnType<typeof listTokens>>["tokens"] = [];
  try {
    ({ tokens } = await listTokens());
  } catch {
    /* API caída */
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3001";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const endpoint = `${proto}://${host}/api/upload`;

  return (
    <div className="app">
      <div className="libhead">
        <div>
          <h2>Ajustes</h2>
          <p>Cómo subir cada tipo de archivo sin perder calidad</p>
        </div>
      </div>

      <section className="panel">
        <h3>Fotos y vídeos normales</h3>
        <p className="panel-lede">
          Botón <b>Subir</b> de la barra (o «Compartir → Explorar → Archivos» en iPhone). Las
          <b> fotos</b> van byte a byte. Los <b>vídeos 1080p/30</b> también.
        </p>
      </section>

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
      </section>

      <section className="panel">
        <h3>Atajo de iOS (opcional, para lotes de fotos / vídeo normal)</h3>
        <p className="panel-lede">
          Crea un token y úsalo en un Atajo como cabecera <code>X-Upload-Token</code>. Endpoint:{" "}
          <code>{endpoint}</code>. Estructura: <i>Repetir con cada</i> →{" "}
          <i>Obtener contenido de la URL</i> (POST, cabecera del token, cuerpo = Archivo =
          <i> Elemento de repetición</i>). Recuerda: por esta vía el vídeo 4K/60 llega recodificado
          — para ese usa Telegram.
        </p>
        <TokenManager initialTokens={tokens} />
      </section>
    </div>
  );
}
