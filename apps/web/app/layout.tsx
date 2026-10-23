import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { siteUrl } from "@/lib/site";
import BrandGlint from "@/components/BrandGlint";

const display = Hanken_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-display" });
const body = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

/** `metadataBase` con la URL pública (SITE_URL, o el host de la petición): así las
 *  canónicas, las imágenes de Open Graph y los enlaces absolutos salen bien en
 *  cualquier dominio — y al activar upscale.com basta con definir SITE_URL. */
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(await siteUrl()),
    title: { default: "Upscale", template: "%s · Upscale" },
    description: "Guarda tus fotos, vídeos y audio en su calidad original, sin recomprimir.",
    applicationName: "Upscale",
    category: "technology",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "Upscale", statusBarStyle: "black-translucent" },
    formatDetection: { telephone: false, email: false, address: false },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
    },
    openGraph: { siteName: "Upscale", locale: "es_ES", type: "website" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0d14" },
    { media: "(prefers-color-scheme: light)", color: "#eef1f7" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

const THEME_INIT = `try{var d=document.documentElement,t=localStorage.getItem('upscale-theme');if(t)d.setAttribute('data-theme',t);var m=localStorage.getItem('upscale-motion');if(m==='off'||m==='on')d.setAttribute('data-motion',m)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>
        {children}
        <BrandGlint />
      </body>
    </html>
  );
}
