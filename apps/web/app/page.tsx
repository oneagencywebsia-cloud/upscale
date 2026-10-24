import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";
import Landing from "@/components/landing/Landing";
import RefCapture from "@/components/RefCapture";
import { FAQ, STEPS } from "@/components/landing/content";
import { PLANS } from "@/lib/plans";
import { siteUrl } from "@/lib/site";
import { ldJson, organizationLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

const TITLE = "Upscale — guarda tus fotos y vídeos en calidad original";
const DESC =
  "Sube tus fotos, vídeos y música a la nube sin perder calidad. Gratis hasta 5 GB, sin tarjeta. Descárgalos idénticos cuando quieras.";

// Páginas públicas: se deja hacer zoom con los dedos (accesibilidad). La app
// (/app) lo mantiene bloqueado porque el visor gestiona sus propios gestos.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0d14" },
    { media: "(prefers-color-scheme: light)", color: "#eef1f7" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const base = await siteUrl();
  return {
    metadataBase: new URL(base),
    title: { absolute: TITLE },
    description: DESC,
    alternates: { canonical: "/", languages: { es: "/", "x-default": "/" } },
    keywords: ["guardar fotos", "nube de fotos", "copia de seguridad de fotos", "guardar vídeos sin perder calidad", "almacenamiento de fotos original"],
    openGraph: { type: "website", url: "/", siteName: "Upscale", locale: "es_ES", title: TITLE, description: DESC },
    twitter: { card: "summary_large_image", title: TITLE, description: DESC },
  };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; ref?: string; adios?: string; error?: string }> }) {
  const user = await getUser();
  const { next: rawNext, ref, adios, error: authError } = await searchParams;
  const next = safeNext(rawNext);
  if (user && !rawNext) redirect("/app");

  const base = await siteUrl();
  const ld = [
    organizationLd(base),
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${base}/#website`,
      name: "Upscale",
      url: base,
      inLanguage: "es",
      publisher: { "@id": `${base}/#organization` },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Upscale",
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web, iOS, Android",
      description:
        "Guarda tus fotos, vídeos y música en su calidad original, sin perder nada, y míralos desde cualquier aparato.",
      url: base,
      inLanguage: "es",
      isAccessibleForFree: true,
      featureList: [
        "Guarda el original, sin perder calidad",
        "Fotos, vídeos y audio",
        "Descarga tal cual o fácil de abrir",
        "Descargas por partes con barra de progreso",
        "Invita y gana espacio",
      ],
      publisher: { "@id": `${base}/#organization` },
      offers: PLANS.filter((p) => p.priceMonthEur === 0).map((p) => ({
        "@type": "Offer",
        name: `Plan ${p.name}`,
        price: "0",
        priceCurrency: "EUR",
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: "Cómo guardar tus fotos y vídeos en Upscale",
      totalTime: "PT1M",
      step: STEPS.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.t, text: s.d })),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];

  return (
    <>
      <RefCapture />
      <script
        type="application/ld+json"
        // "<" escapado: nada del contenido puede cerrar la etiqueta <script>
        dangerouslySetInnerHTML={{ __html: ldJson(ld) }}
      />
      <Landing loggedIn={Boolean(user)} next={next} goodbye={adios === "1"} authError={authError === "auth"} invited={Boolean(ref && /^[A-Za-z0-9_-]{3,40}$/.test(ref))} />
    </>
  );
}
