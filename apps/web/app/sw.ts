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
    // La app (/app/**) es de datos en vivo y por usuario: ni HTML ni RSC se
    // guardan en caché. Antes las navegaciones caían a una copia guardada si el
    // servidor tardaba más de 4 s en contestar — justo cuando está cargado — y
    // se veía una biblioteca vieja o de otra sesión. Sin red no hay nada útil
    // que enseñar de todos modos (las miniaturas tampoco se cachean).
    {
      matcher: ({ sameOrigin, url }) => sameOrigin && (url.pathname === "/app" || url.pathname.startsWith("/app/")),
      handler: new NetworkOnly(),
    },
    // Resto de navegaciones (portada…): red primero, sin plazo corto. Así un
    // despliegue nuevo se coge siempre estando online y no se sirve un HTML
    // viejo que apunta a bundles que ya no existen.
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({ cacheName: "pages" }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
