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
          (60→30 fps, HEVC→H.264, menos bitrate) <b>antes</b> de que llegue a Upscale. Ninguna
          web puede impedirlo. Dos vías que sí guardan el original:
        </p>

        <p className="panel-lede" style={{ marginTop: 4 }}>
          <b>1 · Archivos (sin instalar nada).</b>
        </p>
        <ol className="steps">
          <li>En <b>Fotos</b>, abre el vídeo → <b>Compartir</b> → <b>Guardar en Archivos</b>.</li>
          <li>Aquí, pulsa <b>Subir</b> → en el menú elige <b>Explorar</b> → cógelo de <b>Archivos</b>.</li>
          <li>Se sube byte a byte (mismo SHA-256). La pantalla de subida te confirma los fps.</li>
        </ol>

        <p className="panel-lede" style={{ marginTop: 10 }}>
          <b>2 · Atajo (se monta una vez, luego va desde «Compartir»).</b> iOS ya no deja
          importar atajos de un archivo; hay que crearlo en el iPhone. Son 6 pasos:
        </p>
        <ol className="steps">
          <li>App <b>Atajos</b> → <b>+</b> → <b>Añadir acción</b>.</li>
          <li>
            Busca <b>«Repetir con cada»</b> y añádelo. Como entrada deja{" "}
            <i>«Entrada del atajo»</i>.
          </li>
          <li>
            Dentro del repetir, <b>Añadir acción</b> → <b>«Obtener contenido de la URL»</b>.
            URL: <code>{endpoint}</code>
          </li>
          <li>
            En esa acción pulsa <b>«Mostrar más»</b>: Método <b>POST</b> · Cabeceras <b>+</b>{" "}
            clave <code>X-Upload-Token</code> y de valor tu token (créalo abajo) · Solicitar
            cuerpo <b>Archivo</b> · Archivo = variable <i>«Elemento de repetición»</i>.
          </li>
          <li>
            Arriba, toca el nombre → <b>ⓘ Detalles</b> → activa{" "}
            <b>«Mostrar en la hoja de compartir»</b> (tipos: imágenes y vídeos).
          </li>
          <li>
            Ya está. En <b>Fotos</b>: selecciona vídeos → <b>Compartir</b> → tu atajo. Sube el
            original, en lote. En <b>Editar acciones</b> de la hoja de Compartir lo pones el primero.
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
        <h3>Variante en lote (todo el carrete)</h3>
        <p className="panel-lede">
          El mismo atajo, pero en vez de <i>«Entrada del atajo»</i> empieza con{" "}
          <b>«Buscar fotos»</b> (filtro: últimos 7 días, más antiguas primero, límite 150) y
          el resto igual. Añádele <b>Automatizaciones</b> (al llegar al WiFi de casa, al
          conectar el cargador, a las 14:00 y 22:00) y sube solo sin que hagas nada.
        </p>
      </section>
    </div>
  );
}
