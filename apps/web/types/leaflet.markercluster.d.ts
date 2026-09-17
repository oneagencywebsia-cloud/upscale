// `leaflet.markercluster` no publica tipos propios ni tiene paquete @types.
// Solo se usa como un side-effect import que añade L.markerClusterGroup() al
// espacio de nombres de Leaflet — este ambient module basta para que tsc no
// se queje, sin necesitar tipar toda la API de la librería.
declare module "leaflet.markercluster";
