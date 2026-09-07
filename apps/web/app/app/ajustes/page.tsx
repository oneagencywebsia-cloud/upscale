import { listTokens, apiBase } from "@/lib/api";
import TokenManager from "@/components/TokenManager";

export const dynamic = "force-dynamic";

export default async function AjustesPage() {
  let tokens: Awaited<ReturnType<typeof listTokens>>["tokens"] = [];
  try {
    ({ tokens } = await listTokens());
  } catch {
    /* API caída: TokenManager mostrará el estado */
  }

  return (
    <div className="app">
      <div className="libhead">
        <h2>Ajustes</h2>
        <p>Subida desde el iPhone · tu cuenta</p>
      </div>

      <section className="panel">
        <h3>Token de subida (Atajo de iOS)</h3>
        <p className="panel-lede">
          Crea un token y úsalo en el Atajo «Subir a Upscale» como cabecera{" "}
          <code>X-Upload-Token</code>. El endpoint es{" "}
          <code>{apiBase()}/v1/assets</code>.
        </p>
        <TokenManager initialTokens={tokens} />
      </section>

      <section className="panel">
        <h3>Cómo montar el Atajo</h3>
        <ol className="steps">
          <li><b>Buscar fotos</b> — «fecha de captura en los últimos 7 días», más antiguas primero, límite 150.</li>
          <li><b>Repetir con cada uno</b> → <b>Obtener detalles de las fotos</b> → <i>Nombre</i>.</li>
          <li>
            <b>Obtener contenido de la URL</b>: POST a <code>{apiBase()}/v1/assets</code>, cabeceras{" "}
            <code>X-Upload-Token</code> y <code>X-Filename</code>, cuerpo = <i>Archivo</i> (Elemento de repetición).
          </li>
          <li>Automatizaciones: al llegar al WiFi de casa, al cargar, y a las 14:00 y 22:00.</li>
        </ol>
      </section>
    </div>
  );
}
