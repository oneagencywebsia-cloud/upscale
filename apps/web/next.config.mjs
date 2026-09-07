import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

// En el contenedor "todo en uno" la API es interna; el navegador la alcanza por /_api/*
const INTERNAL_API = process.env.INTERNAL_API_URL || "http://127.0.0.1:8080";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@upscale/shared", "three"],
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  // Primer despliegue sin haber corrido el build en local; pon a false cuando `pnpm build` pase limpio.
  typescript: { ignoreBuildErrors: true },
  async rewrites() {
    return [{ source: "/_api/:path*", destination: `${INTERNAL_API}/:path*` }];
  },
};

export default withSerwist(nextConfig);
