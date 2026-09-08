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

  // URL pública de la API (misma web, prefijo /_api)
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3001";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const endpoint = `${proto}://${host}/_api/v1/assets`;

  return (
    <div className="app">
      <div className="libhead">
        <div>
          <h2>Ajustes</h2>
          <p>Subida automática desde el iPhone · tu cuenta</p>
        </div>
      </div>

      <section className="panel">
        <h3>«Compartir → Upscale» desde Fotos</h3>
        <p className="panel-lede">
          Para que <b>Upscale</b> aparezca en la hoja de Compartir del iPhone tienes que
          <b> instalar la app</b> primero: abre Upscale en Safari → botón <b>Compartir</b> →
          <b> Añadir a pantalla de inicio</b>. A partir de ahí, al compartir una foto o vídeo
          verás <b>Upscale</b> entre las apps y se sube directo.
        </p>
        <ol className="steps">
          <li>
            <b>El orden lo decide iOS</b> (según lo que uses). No se puede forzar que salga
            primero, pero sube solo: en la hoja de Compartir desliza la fila de apps → <b>Más</b>
            {" "}→ <b>Editar</b> y arrastra Upscale arriba (o marca la estrella).
          </li>
          <li>
            El vídeo compartido a la app <b>puede recodificarlo iOS</b> igual que la Fototeca.
            Si lo hace, la pantalla de subida te avisa. Para el original garantizado desde
            Compartir, usa el <b>Atajo</b> (más abajo) con <i>«Mostrar en hoja de compartir»</i>
            activado: los Atajos sí reciben el archivo intacto y ese sí lo puedes fijar arriba
            en <b>Editar acciones</b>.
          </li>
        </ol>
      </section>

      <section className="panel">
        <h3>Vídeo en calidad original</h3>
        <p className="panel-lede">
          Al elegir un vídeo desde <b>Fototeca</b> en el navegador, iOS lo <b>recodifica</b>
          (60→30 fps, HEVC→H.264, menos bitrate) antes de subirlo. Dos formas de evitarlo:
        </p>
        <ol className="steps">
          <li>
            <b>Rápido:</b> en <b>Fotos</b>, abre el vídeo → <b>Compartir</b> →{" "}
            <b>Guardar en Archivos</b>. Luego pulsa <b>Subir</b> → <b>Explorar</b> y cógelo de
            <b> Archivos</b>. Así se sube byte a byte.
          </li>
          <li>
            <b>Automático:</b> monta el <b>Atajo de iOS</b> (abajo) y sube el original sin pensar,
            en lote y con automatizaciones.
          </li>
        </ol>
      </section>

      <section className="panel">
        <h3>Token de subida (Atajo de iOS)</h3>
        <p className="panel-lede">
          Crea un token y úsalo en un Atajo como cabecera <code>X-Upload-Token</code>. El Atajo
          manda el archivo <b>tal cual sale del iPhone</b>. Endpoint: <code>{endpoint}</code>.
        </p>
        <TokenManager initialTokens={tokens} />
      </section>

      <section className="panel">
        <h3>Cómo montar el Atajo</h3>
        <p className="panel-lede">
          <b>Modo lote</b> (recorre el carrete) o <b>modo compartir</b> (lo activas desde la
          hoja de Compartir sobre 1 o varios vídeos). Para el segundo, en los ajustes del
          Atajo activa <b>«Mostrar en hoja de compartir»</b> y tipo de entrada <i>Imágenes y
          vídeos</i>; luego <b>Editar acciones</b> en la hoja de Compartir para ponerlo arriba.
        </p>
        <ol className="steps">
          <li>
            <b>Lote:</b> <b>Buscar fotos</b> — «fecha de captura en los últimos 7 días», más
            antiguas primero, límite 150. <b>Compartir:</b> usa <i>Entrada del Atajo</i>.
          </li>
          <li><b>Repetir con cada uno</b> → <b>Obtener detalles de las fotos</b> → <i>Nombre</i>.</li>
          <li>
            <b>Obtener contenido de la URL</b>: POST a <code>{endpoint}</code>, cabeceras{" "}
            <code>X-Upload-Token</code> (tu token) y <code>X-Filename</code> (el Nombre), cuerpo ={" "}
            <i>Archivo</i> → <i>Elemento de repetición</i>.
          </li>
          <li>Automatizaciones: al llegar al WiFi de casa, al conectar el cargador, y a las 14:00 y 22:00.</li>
        </ol>
      </section>
    </div>
  );
}
