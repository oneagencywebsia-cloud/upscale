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
        <h3>Token de subida (Atajo de iOS)</h3>
        <p className="panel-lede">
          <b>Recomendado para vídeo.</b> El botón «Subir» del navegador vale para fotos, pero
          iOS <b>recodifica los vídeos</b> antes de subirlos (60→30 fps, HEVC→H.264, menos
          bitrate). El Atajo manda el archivo <b>tal cual sale del iPhone</b>. Crea un token y
          úsalo como cabecera <code>X-Upload-Token</code>. Endpoint: <code>{endpoint}</code>.
        </p>
        <TokenManager initialTokens={tokens} />
      </section>

      <section className="panel">
        <h3>Cómo montar el Atajo</h3>
        <ol className="steps">
          <li><b>Buscar fotos</b> — «fecha de captura en los últimos 7 días», más antiguas primero, límite 150.</li>
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
