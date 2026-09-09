/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import { Serwist, NetworkOnly, NetworkFirst, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Nunca cachear respuestas autenticadas ni el proxy de la API.
    {
      matcher: ({ url }) => url.pathname.startsWith("/api") || url.pathname.startsWith("/_api"),
      handler: new NetworkOnly(),
    },
    // Navegaciones (documentos HTML/RSC): red primero. Así un despliegue nuevo
    // se coge siempre estando online y no se sirve un HTML viejo que apunta a
    // bundles que ya no existen (era lo que reventaba la app tras cada deploy).
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({ cacheName: "pages", networkTimeoutSeconds: 4 }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
