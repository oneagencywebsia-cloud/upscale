"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { Map as LeafletMap } from "leaflet";
import type { MapPoint } from "@upscale/shared";
// Solo CSS aquí arriba (no ejecuta JS que toque `window`, así que es seguro en
// el render del servidor). El JS de Leaflet se importa dinámicamente dentro
// del useEffect de abajo — Leaflet toca `window`/`navigator` nada más
// cargarse, y esto es un componente cliente que Next también renderiza en el
// servidor para el HTML inicial.
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";

const TILES = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
};
// Atribución obligatoria según los términos de uso gratuito de CARTO (basemap) + OSM (datos).
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

function isLightTheme(): boolean {
  const t = document.documentElement.getAttribute("data-theme");
  if (t) return t === "light";
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

export default function MapView({ points }: { points: MapPoint[] }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const fitRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!points.length) return;
    let disposed = false;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet.markercluster");
      if (disposed || !elRef.current) return;

      const map = L.map(elRef.current, {
        zoomControl: false,
        attributionControl: true,
        zoomSnap: 0.5,
        wheelPxPerZoomLevel: 90,
        zoomAnimation: true,
        markerZoomAnimation: true,
        worldCopyJump: true,
      }).setView([25, 10], 2);
      mapRef.current = map;
      L.control.zoom({ position: "bottomright" }).addTo(map);
      map.attributionControl.setPrefix(false);

      L.tileLayer(isLightTheme() ? TILES.light : TILES.dark, {
        attribution: ATTRIBUTION,
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cluster = (L as any).markerClusterGroup({
        maxClusterRadius: 58,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        animate: true,
        // burbuja propia: degradado de la marca + contador, más grande cuanto
        // más archivos agrupa — en vez del círculo verde/amarillo por defecto.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        iconCreateFunction: (c: any) => {
          const n: number = c.getChildCount();
          const size = n < 10 ? 44 : n < 100 ? 52 : 62;
          return L.divIcon({
            className: "map-cluster",
            html: `<span class="map-cluster-bubble" style="width:${size}px;height:${size}px"><b>${n}</b></span>`,
            iconSize: [size, size],
          });
        },
      });
      const bounds: [number, number][] = [];

      for (const p of points) {
        const icon = L.divIcon({
          className: "map-thumb-marker",
          html: `<span class="map-thumb-ring"><img src="${p.thumbUrl}" alt="" loading="lazy" /></span>`,
          iconSize: [46, 54],
          iconAnchor: [23, 52],
          popupAnchor: [0, -50],
        });
        const marker = L.marker([p.lat, p.lon], { icon, keyboard: false, riseOnHover: true });
        const popupEl = document.createElement("div");
        popupEl.className = "map-popup";
        popupEl.innerHTML = `
          <img src="${p.thumbUrl}" alt="" />
          <a href="/api/media/${p.id}" target="_blank" rel="noopener">Ver a tamaño completo</a>
        `;
        marker.bindPopup(popupEl, { closeButton: false, maxWidth: 240, className: "map-popup-wrap" });
        cluster.addLayer(marker);
        bounds.push([p.lat, p.lon]);
      }

      map.addLayer(cluster);
      const fit = () => {
        if (!bounds.length) return;
        map.flyToBounds(bounds, { padding: [56, 56], maxZoom: 14, duration: 1.1 });
      };
      fitRef.current = fit;
      fit();
    })();

    return () => {
      disposed = true;
      fitRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [points]);

  if (!points.length) {
    return (
      <div className="empty">
        <h3>Sin ubicaciones todavía</h3>
        <p>
          Ninguno de tus archivos tiene GPS guardado. Prueba a pulsar «Actualizar ubicaciones en el
          mapa» en <Link href="/app/ajustes">Ajustes</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="map-wrap">
      <div ref={elRef} className="map-view" role="application" aria-label="Mapa de tu biblioteca" />
      <div className="map-chip" aria-hidden="true">
        <b>{points.length.toLocaleString("es-ES")}</b> con ubicación
      </div>
      <button type="button" className="map-fit" onClick={() => fitRef.current?.()} aria-label="Ver todos los lugares">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      </button>
    </div>
  );
}
