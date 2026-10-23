import type { Metadata, Viewport } from "next";
import Link from "next/link";
import PublicPage from "@/components/public/PublicPage";
import { pageMeta, publicViewport, articleLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

import { PLANS, REFERRAL, gbHuman, priceHuman } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const viewport: Viewport = publicViewport;
const PATH = "/planes";
export const metadata: Metadata = pageMeta(PATH);

export default async function Page() {
  const base = await siteUrl();
  const free = PLANS[0];
  const app = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Upscale",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web, iOS, Android",
    url: `${base}${PATH}`,
    inLanguage: "es",
    // solo se publica lo que existe hoy: los planes de pago aún no se pueden contratar
    offers: [{ "@type": "Offer", name: `Plan ${free.name}`, price: "0", priceCurrency: "EUR", availability: "https://schema.org/InStock", url: `${base}/#empezar` }],
  };
  return (
    <PublicPage
      path={PATH}
      title="Planes y precios"
      lead={`Empieza gratis con ${gbHuman(free.bytes)}, sin tarjeta. Si necesitas más, gana espacio invitando a amigos. Los planes de pago llegan muy pronto.`}
      jsonLd={[app]}
    >
      <div className="pub-table-wrap">
        <table className="pub-table stack">
          <caption className="sr-only">Comparativa de planes de Upscale</caption>
          <thead>
            <tr><th scope="col">Plan</th><th scope="col">Espacio</th><th scope="col">Tamaño máximo por archivo</th><th scope="col">Precio</th></tr>
          </thead>
          <tbody>
            {PLANS.map((p) => (
              <tr key={p.id}>
                <th scope="row">{p.name}</th>
                <td data-label="Espacio">{gbHuman(p.bytes)}</td>
                <td data-label="Tamaño máximo por archivo">{gbHuman(p.maxFileBytes)}</td>
                <td data-label="Precio">{p.priceMonthEur === 0 ? "Gratis" : <>{priceHuman(p.priceMonthEur)}/mes <small>(muy pronto)</small></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pub-note">Los precios de Plus, Pro y Max son una propuesta inicial y aún no se pueden contratar. Pueden cambiar antes del lanzamiento.</p>

      <h2>Qué incluye el plan Gratis</h2>
      <ul>
        {free.perks.map((x) => <li key={x}>{x}</li>)}
        <li>Descargas en formato Original o Compatible</li>
        <li>Descarga de toda tu biblioteca en un ZIP cuando quieras</li>
      </ul>

      <h2>Gana espacio gratis</h2>
      <p>
        Por cada amigo que guarde su primera foto, <b>tú ganas {gbHuman(REFERRAL.inviterBonusBytes)}</b> y <b>él gana {gbHuman(REFERRAL.invitedBonusBytes)}</b>.
        Hasta <b>{gbHuman(REFERRAL.maxRewarded * REFERRAL.inviterBonusBytes)}</b> extra. También puedes canjear códigos de regalo desde Espacio y plan.
      </p>

      <h2>Quiero más espacio</h2>
      <p>
        Cuando lleguen los planes de pago podrás pasarte a uno sin perder nada de lo que ya tienes guardado.
        Si quieres que te avisemos, entra en la app, abre Espacio y plan y pulsa <b>Avísame</b>. ¿Dudas? Mira las <Link href="/preguntas">preguntas frecuentes</Link>.
      </p>
    </PublicPage>
  );
}
