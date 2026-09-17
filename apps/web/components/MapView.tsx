"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import type { MapPoint } from "@upscale/shared";
// Solo CSS aquí arriba (no ejecuta JS que toque `window`, así que es seguro en
// el render del servidor). El JS de Leaflet se importa dinámicamente dentro
// del useEffect de abajo — Leaflet toca `window`/`navigator` nada más
// cargarse, y esto es un componente cliente que Next también renderiza en el
// servidor para el HTML inicial.
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

const CARTO_TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
// Atribución obligatoria según los términos de uso gratuito de CARTO (basemap) + OSM (datos).
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

export default function MapView({ points }: { points: MapPoint[] }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!points.length) return;
    let disposed = false;

    (async () => {
      const L = (await import("leaflet")).default;
      // Añade `L.markerClusterGroup` al mismo módulo `leaflet` de arriba (dedupe
      // de webpack: ambos imports resuelven a la misma instancia del paquete).
      await import("leaflet.markercluster");
      if (disposed || !elRef.current) return;

      const map = L.map(elRef.current, { zoomControl: true, attributionControl: true }).setView([20, 0], 2);
      mapRef.current = map;

      L.tileLayer(CARTO_TILE_URL, {
        attribution: CARTO_ATTRIBUTION,
        subdomains: "abcd",
        maxZoom: 20,
      }).addTo(map);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cluster = (L as any).markerClusterGroup({ maxClusterRadius: 60, spiderfyOnMaxZoom: true });
      const bounds: [number, number][] = [];

      for (const p of points) {
        const icon = L.divIcon({
          className: "map-thumb-marker",
          html: `<span class="map-thumb-ring"><img src="${p.thumbUrl}" alt="" loading="lazy" /></span>`,
          iconSize: [42, 42],
          iconAnchor: [21, 21],
          popupAnchor: [0, -18],
        });
        const marker = L.marker([p.lat, p.lon], { icon, keyboard: false });
        const popupEl = document.createElement("div");
        popupEl.className = "map-popup";
        popupEl.innerHTML = `
          <img src="${p.thumbUrl}" alt="" />
          <a href="/app" rel="noopener">Abrir en la galería</a>
        `;
        marker.bindPopup(popupEl);
        cluster.addLayer(marker);
        bounds.push([p.lat, p.lon]);
      }

      map.addLayer(cluster);
      if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [points]);

  if (!points.length) {
    return (
      <div className="empty">
        <h3>Sin ubicaciones todavía</h3>
        <p>Los archivos con datos GPS aparecerán aquí en cuanto los tengas en tu biblioteca.</p>
      </div>
    );
  }

  return <div ref={elRef} className="map-view" role="application" aria-label="Mapa de tu biblioteca" />;
}
