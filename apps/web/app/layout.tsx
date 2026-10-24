import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { siteUrl } from "@/lib/site";
import BrandGlint from "@/components/BrandGlint";
import { PANTALLAS, startupImage } from "@/lib/splash";

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
    description: "Guarda tus fotos, vídeos y música en su calidad original, sin perder nada.",
    applicationName: "Upscale",
    category: "technology",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "Upscale",
      statusBarStyle: "black-translucent",
      // pantalla de arranque a medida de cada iPhone/iPad, en claro y en oscuro
      startupImage: PANTALLAS.flatMap((p) => [startupImage(p, "dark"), startupImage(p, "light")]),
    },
    other: { "mobile-web-app-capable": "yes" },
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
    { media: "(prefers-color-scheme: dark)", color: "#14214d" },
    { media: "(prefers-color-scheme: light)", color: "#f2f5ff" },
  ],
  width: "device-width",
  initialScale: 1,
  // El zoom con los dedos se permite (accesibilidad, WCAG 1.4.4). El visor de fotos
  // gestiona sus propios gestos con `touch-action: none`, así que no se ve afectado,
  // y `touch-action: manipulation` en la app evita el zoom accidental con doble toque.
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  // Android (Chrome): al salir el teclado la página se encoge en vez de taparse (editor de notas, buscadores)
  interactiveWidget: "resizes-content",
};

const THEME_INIT = `try{var d=document.documentElement,t=localStorage.getItem('upscale-theme');if(t)d.setAttribute('data-theme',t);var z=localStorage.getItem('upscale-letra');if(z==='1'||z==='2')d.setAttribute('data-letra',z);var m=localStorage.getItem('upscale-motion');if(m==='off'||m==='on')d.setAttribute('data-motion',m)}catch(e){}`;

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
