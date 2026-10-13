import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";
import { legalInfo } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Términos de uso",
  description: "Las reglas sencillas para usar Upscale: tus archivos, los planes, límites y qué esperar del servicio.",
  alternates: { canonical: "/terminos" },
};

export default function Terminos() {
  const { name, email, updated } = legalInfo();
  return (
    <LegalPage
      title="Términos de uso"
      updated={updated}
      summary={[
        "Tus archivos son tuyos. Solo los guardamos para ti.",
        "Sube solo lo que puedas subir legalmente.",
        "Guarda también una copia de lo irremplazable: no podemos garantizar que nunca falle.",
      ]}
    >
      <h2>1. Qué es Upscale</h2>
      <p>Upscale es un servicio para guardar y ver tus fotos, vídeos y audio en su calidad original. Lo ofrece {name}. Al crear una cuenta aceptas estos términos y la <a href="/privacidad">política de privacidad</a>.</p>

      <h2>2. Tu cuenta</h2>
      <p>Eres responsable de tu acceso. Debes ser mayor de 14 años. Una cuenta es para una persona.</p>

      <h2>3. Tus archivos</h2>
      <p>Los archivos que subes siguen siendo tuyos. Nos das el permiso mínimo necesario para guardarlos, procesarlos (por ejemplo, crear miniaturas) y mostrártelos a ti. No los usamos para otra cosa.</p>
      <p>No puedes subir contenido ilegal, que infrinja derechos de otras personas, que muestre abuso a menores, ni malware. Podemos eliminar ese contenido y cerrar la cuenta.</p>

      <h2>4. Planes y espacio</h2>
      <p>Cada plan tiene un espacio total y un tamaño máximo por archivo. El plan Gratis incluye 5 GB. Puedes ganar espacio extra con códigos e invitaciones. Los planes de pago aún no están disponibles: cuando lo estén, te lo diremos antes de cobrarte nada.</p>

      <h2>5. Uso razonable</h2>
      <p>Para que el servicio funcione para todos, limitamos las subidas simultáneas. No intentes saltarte los límites, sobrecargar el servicio ni acceder a cuentas ajenas. El programa de invitaciones es para personas reales: las cuentas falsas o duplicadas no suman espacio.</p>

      <h2>6. Disponibilidad y copias</h2>
      <p>Hacemos lo posible para que Upscale esté siempre disponible y tus archivos a salvo, pero el servicio se ofrece «tal cual», sin garantía de disponibilidad continua ni de que no haya pérdidas. <b>Conserva siempre una copia de lo que no puedas perder.</b> Puedes descargar todo en cualquier momento desde Ajustes.</p>

      <h2>7. Terminar</h2>
      <p>Puedes borrar tu cuenta cuando quieras desde <b>Ajustes → Borrar mi cuenta</b>; se eliminan tus archivos y datos. Podemos suspender cuentas que incumplan estos términos.</p>

      <h2>8. Responsabilidad</h2>
      <p>En la medida que permita la ley, no respondemos de daños indirectos ni de pérdidas de datos que no se deban a nuestra negligencia grave. Esto no limita derechos que la ley te reconozca como consumidor.</p>

      <h2>9. Cambios y ley aplicable</h2>
      <p>Podemos actualizar estos términos y lo avisaremos en la aplicación. Se rigen por la ley española.{" "}
        {email ? <>Contacto: <a href={`mailto:${email}`}>{email}</a>.</> : null}
      </p>
    </LegalPage>
  );
}
