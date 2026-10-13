import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";
import { legalInfo } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Privacidad",
  description: "Qué datos guarda Upscale, para qué, quién interviene y cómo puedes descargarlos o borrarlos.",
  alternates: { canonical: "/privacidad" },
};

export default function Privacidad() {
  const { name, email, updated } = legalInfo();
  return (
    <LegalPage
      title="Política de privacidad"
      updated={updated}
      summary={[
        "Guardamos tu email y los archivos que subes. Nada más.",
        "No vendemos tus datos ni mostramos publicidad.",
        "Puedes descargar todo y borrar tu cuenta cuando quieras desde Ajustes.",
      ]}
    >
      <h2>1. Quién es el responsable</h2>
      <p>
        El responsable del tratamiento es {name}.{" "}
        {email ? <>Puedes escribirnos a <a href={`mailto:${email}`}>{email}</a>.</> : <>Puedes ejercer tus derechos tú mismo desde <b>Ajustes</b> (descargar y borrar).</>}
      </p>

      <h2>2. Qué datos tratamos</h2>
      <ul>
        <li><b>Tu cuenta:</b> email (o el identificador de Google/Apple si entras con ellos) y la contraseña si eliges esa opción (la guarda el proveedor de acceso, protegida con hash, nunca en claro).</li>
        <li><b>Tus archivos:</b> las fotos, vídeos y audios que subes, tal cual. Incluyen los datos que lleve cada archivo (fecha, cámara, ubicación GPS si la tiene).</li>
        <li><b>Uso:</b> un registro de lo que abres o descargas y desde qué navegador, para tu seguridad y para detectar abusos.</li>
        <li><b>Plan e invitaciones:</b> tu plan, el espacio extra, los códigos que canjeas y quién te invitó.</li>
      </ul>

      <h2>3. Para qué los usamos</h2>
      <p>Solo para darte el servicio: guardar tus archivos, mostrártelos, aplicar tu cupo de espacio, mantener la seguridad y gestionar invitaciones y códigos. La base legal es la ejecución del servicio que nos pides y nuestro interés legítimo en proteger la plataforma.</p>

      <h2>4. Quién más interviene</h2>
      <p>Para funcionar usamos terceros que tratan datos por nuestra cuenta:</p>
      <ul>
        <li><b>Inicio de sesión:</b> Supabase (y Google o Apple si eliges entrar con ellos).</li>
        <li><b>Almacenamiento de archivos:</b> una infraestructura de terceros, que incluye la plataforma de mensajería Telegram como almacén, y el servidor donde se aloja Upscale.</li>
      </ul>
      <p>Estos proveedores pueden estar fuera del Espacio Económico Europeo. No compartimos tus archivos con nadie más ni los usamos para publicidad ni para entrenar modelos.</p>

      <h2>5. Seguridad</h2>
      <p>Las conexiones van cifradas (HTTPS) y cada cuenta solo accede a lo suyo. Ningún sistema es infalible: guarda también una copia de lo que sea insustituible.</p>

      <h2>6. Cuánto tiempo los guardamos</h2>
      <p>Mientras tengas la cuenta. Si borras un archivo, lo quitamos del almacenamiento; si borras la cuenta, eliminamos todos tus archivos y datos (los registros técnicos mínimos pueden tardar un poco más en desaparecer de las copias de seguridad).</p>

      <h2>7. Tus derechos</h2>
      <p>Puedes acceder a tus datos, rectificarlos, descargarlos, oponerte, limitar su uso y borrarlos. <b>Descargar todo</b> (ZIP con los originales) y <b>Borrar mi cuenta</b> están en <b>Ajustes</b>. Si no te respondemos bien, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).</p>

      <h2>8. Cookies</h2>
      <p>Solo usamos cookies y almacenamiento técnicos: mantener tu sesión y recordar preferencias (tema, tamaño de fotos). No usamos cookies de publicidad ni de analítica de terceros.</p>

      <h2>9. Menores</h2>
      <p>Upscale es para mayores de 14 años. Si eres menor de esa edad, necesitas el permiso de tu madre, padre o tutor.</p>

      <h2>10. Cambios</h2>
      <p>Si cambiamos esta política de forma importante, lo avisaremos en la aplicación. La fecha de arriba indica la última versión.</p>
    </LegalPage>
  );
}
