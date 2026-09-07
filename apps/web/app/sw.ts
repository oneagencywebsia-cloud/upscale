/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import { Serwist, NetworkOnly, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

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
    ...defaultCache,
  ],
});

serwist.addEventListeners();
