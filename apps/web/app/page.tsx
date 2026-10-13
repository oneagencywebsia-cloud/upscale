import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";
import Landing from "@/components/landing/Landing";
import RefCapture from "@/components/RefCapture";
import { FAQ, STEPS } from "@/components/landing/content";
import { PLANS } from "@/lib/plans";
import { siteUrl } from "@/lib/site";

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
    alternates: { canonical: "/" },
    keywords: ["guardar fotos", "nube de fotos", "copia de seguridad de fotos", "guardar vídeos sin perder calidad", "almacenamiento de fotos original"],
    openGraph: { type: "website", url: "/", siteName: "Upscale", locale: "es_ES", title: TITLE, description: DESC },
    twitter: { card: "summary_large_image", title: TITLE, description: DESC },
  };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; ref?: string; adios?: string }> }) {
  const user = await getUser();
  const { next: rawNext, ref, adios } = await searchParams;
  const next = safeNext(rawNext);
  if (user && !rawNext) redirect("/app");

  const base = await siteUrl();
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Upscale",
      url: base,
      inLanguage: "es",
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Upscale",
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web, iOS, Android",
      description:
        "Guarda tus fotos, vídeos y audio en su calidad original, sin recomprimir, y accede desde cualquier dispositivo.",
      url: base,
      inLanguage: "es",
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }}
      />
      <Landing loggedIn={Boolean(user)} next={next} goodbye={adios === "1"} invited={Boolean(ref && /^[A-Za-z0-9_-]{3,40}$/.test(ref))} />
    </>
  );
}
