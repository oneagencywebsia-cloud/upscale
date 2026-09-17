-- Índice parcial para /v1/assets/map: filtra por usuario y descarta de raíz
-- los assets sin coordenadas o borrados, que en una biblioteca de fotos son
-- la mayoría de las filas (no todo lleva GPS). Mantiene la consulta del mapa
-- rápida sin necesitar un índice geoespacial completo (PostGIS) para el
-- volumen de una biblioteca personal.
create index if not exists assets_geo_idx on assets (user_id) where lat is not null and deleted_at is null;
