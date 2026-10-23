import type { Metadata, Viewport } from "next";

/** Fecha de la última revisión de contenido de las páginas públicas (ISO). */
export const CONTENIDO_ACTUALIZADO = "2026-10-22";

/** Páginas públicas indexables. Una sola lista alimenta el mapa del sitio, los
 *  enlaces del pie, llms.txt y los datos estructurados. */
export interface PaginaPublica {
  path: string;
  title: string;
  description: string;
  /** texto corto para enlaces internos */
  label: string;
  priority: number;
  changeFrequency: "weekly" | "monthly" | "yearly";
  kind: "info" | "guia" | "legal";
}

export const PAGINAS: PaginaPublica[] = [
  {
    path: "/como-funciona",
    title: "Cómo funciona Upscale: guarda tus fotos y vídeos en 3 pasos",
    description: "Crea tu cuenta, sube tus fotos, vídeos y música y míralos desde cualquier dispositivo, idénticos al original. Así de fácil.",
    label: "Cómo funciona",
    priority: 0.9,
    changeFrequency: "monthly",
    kind: "info",
  },
  {
    path: "/planes",
    title: "Planes y precios de Upscale: empieza gratis con 5 GB",
    description: "Plan Gratis con 5 GB y sin tarjeta. Gana más espacio invitando a amigos. Planes de pago Plus, Pro y Max muy pronto.",
    label: "Planes",
    priority: 0.9,
    changeFrequency: "monthly",
    kind: "info",
  },
  {
    path: "/formatos",
    title: "Formatos compatibles: HEIC, HEVC, RAW, MOV, MP3 y más",
    description: "Qué fotos, vídeos y audios puedes guardar en Upscale y cómo descargarlos en un formato que se abra en cualquier aparato.",
    label: "Formatos",
    priority: 0.8,
    changeFrequency: "monthly",
    kind: "info",
  },
  {
    path: "/preguntas",
    title: "Preguntas frecuentes sobre Upscale",
    description: "Calidad, privacidad, espacio, formatos, descargas y cómo llevarte todo si te vas: respuestas directas a lo que más se pregunta.",
    label: "Preguntas frecuentes",
    priority: 0.8,
    changeFrequency: "monthly",
    kind: "info",
  },
  {
    path: "/guias",
    title: "Guías para guardar y descargar tus fotos y vídeos",
    description: "Guías prácticas: copia de seguridad de las fotos del iPhone, diferencias entre HEIC y JPG y cómo abrir tus archivos en cualquier aparato.",
    label: "Guías",
    priority: 0.7,
    changeFrequency: "monthly",
    kind: "info",
  },
  {
    path: "/guias/guardar-fotos-iphone-sin-perder-calidad",
    title: "Cómo guardar las fotos del iPhone sin perder calidad",
    description: "Guía paso a paso para hacer copia de seguridad de tus fotos y vídeos del iPhone en su calidad original y liberar espacio sin riesgo.",
    label: "Guardar fotos del iPhone sin perder calidad",
    priority: 0.7,
    changeFrequency: "monthly",
    kind: "guia",
  },
  {
    path: "/guias/heic-o-jpg",
    title: "HEIC o JPG: cuál elegir y cómo abrir HEIC en Windows",
    description: "Diferencias entre HEIC y JPG, por qué tu iPhone usa HEIC y cómo abrir o convertir esas fotos sin perder calidad.",
    label: "HEIC o JPG",
    priority: 0.7,
    changeFrequency: "monthly",
    kind: "guia",
  },
  { path: "/privacidad", title: "Política de privacidad", description: "Qué datos guarda Upscale y cómo puedes descargarlos o borrarlos.", label: "Privacidad", priority: 0.3, changeFrequency: "yearly", kind: "legal" },
  { path: "/terminos", title: "Términos de uso", description: "Las condiciones de uso de Upscale.", label: "Términos", priority: 0.3, changeFrequency: "yearly", kind: "legal" },
];

/** Las páginas públicas permiten hacer zoom (accesibilidad); /app lo bloquea porque el visor gestiona sus gestos. */
export const publicViewport: Viewport = {
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

/** JSON-LD seguro para incrustar en <script>: «<» escapado, nada puede cerrar la etiqueta. */
export function ldJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function organizationLd(base: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${base}/#organization`,
    name: "Upscale",
    url: base,
    logo: { "@type": "ImageObject", url: `${base}/icon-512.png`, width: 512, height: 512 },
  };
}

export function breadcrumbLd(base: string, items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: "Inicio", path: "/" }, ...items].map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${base}${it.path === "/" ? "" : it.path}`,
    })),
  };
}

const OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "Upscale — guarda tus fotos y vídeos en calidad original" };

/** Metadatos de una página pública: título, descripción, canónica relativa
 *  (`metadataBase` del layout la vuelve absoluta con SITE_URL), Open Graph y Twitter. */
export function pageMeta(path: string, extra: Partial<Metadata> = {}): Metadata {
  const p = PAGINAS.find((x) => x.path === path);
  if (!p) throw new Error(`pageMeta: ruta desconocida ${path}`);
  return {
    title: { absolute: `${p.title} · Upscale` },
    description: p.description,
    alternates: { canonical: path },
    // la imagen se declara aquí: un `openGraph` propio sustituye al del layout y,
    // con él, la tarjeta `opengraph-image` de la raíz (se compartía sin imagen)
    openGraph: { type: "article", url: path, siteName: "Upscale", locale: "es_ES", title: p.title, description: p.description, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: p.title, description: p.description, images: [OG_IMAGE.url] },
    ...extra,
  };
}

export function articleLd(base: string, path: string, headline: string, description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description,
    inLanguage: "es",
    datePublished: CONTENIDO_ACTUALIZADO,
    dateModified: CONTENIDO_ACTUALIZADO,
    author: { "@type": "Organization", name: "Upscale", url: base },
    publisher: { "@id": `${base}/#organization` },
    mainEntityOfPage: `${base}${path}`,
  };
}
