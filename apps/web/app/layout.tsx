import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Hanken_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-display" });
const body = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Upscale",
  description: "Tu nube de fotos personal — guarda el original del iPhone entero, sin recomprimir.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Upscale", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0d14" },
    { media: "(prefers-color-scheme: light)", color: "#eef1f7" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const THEME_INIT = `try{var t=localStorage.getItem('upscale-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
