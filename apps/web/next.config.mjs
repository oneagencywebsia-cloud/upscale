import path from "node:path";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

// En el contenedor "todo en uno" la API es interna; el navegador la alcanza por /_api/*
const INTERNAL_API = process.env.INTERNAL_API_URL || "http://127.0.0.1:8080";

const dev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy", value: csp },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  // raíz del monorepo, para que el trazado de la salida standalone incluya las deps del workspace
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  transpilePackages: ["@upscale/shared"],
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  async headers() {
    // los archivos de /public se servían sin caché (max-age=0): cada visita volvía a
    // pedir el logo y los iconos. Una semana + revalidar en segundo plano; el
    // service worker (sw.js) y el manifest no se tocan.
    const estatico = [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }];
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/brand/:file*", headers: estatico },
      { source: "/icon-:size.png", headers: estatico },
      { source: "/favicon-32.png", headers: estatico },
      { source: "/apple-icon.png", headers: estatico },
      { source: "/icon.svg", headers: estatico },
    ];
  },
  async rewrites() {
    return [{ source: "/_api/:path*", destination: `${INTERNAL_API}/:path*` }];
  },
};

export default withSerwist(nextConfig);
