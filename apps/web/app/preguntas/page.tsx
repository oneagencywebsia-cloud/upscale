import type { Metadata, Viewport } from "next";
import Link from "next/link";
import PublicPage from "@/components/public/PublicPage";
import { pageMeta, publicViewport, articleLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

import { FAQ, FAQ_EXTRA } from "@/components/landing/content";

export const dynamic = "force-dynamic";
export const viewport: Viewport = publicViewport;
const PATH = "/preguntas";
export const metadata: Metadata = pageMeta(PATH);

const TODAS = [...FAQ, ...FAQ_EXTRA];

export default async function Page() {
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: "es",
    mainEntity: TODAS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    <PublicPage
      path={PATH}
      title="Preguntas frecuentes"
      lead="Respuestas directas sobre calidad, privacidad, espacio, formatos y descargas."
      jsonLd={[faq]}
    >
      <div className="faq pub-faq">
        {TODAS.map((f) => (
          <section key={f.q} className="pub-q">
            <h2>{f.q}</h2>
            <p>{f.a}</p>
          </section>
        ))}
      </div>
      <p>
        ¿Quieres ver cómo se hace? Empieza por <Link href="/como-funciona">Cómo funciona</Link> o consulta los <Link href="/planes">planes</Link>.
      </p>
    </PublicPage>
  );
}
