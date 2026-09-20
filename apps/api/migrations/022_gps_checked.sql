-- Marca los assets cuyo GPS ya se ha intentado leer (aunque no tuvieran): el
-- backfill de ubicaciones seleccionaba siempre "lat is null" y volvía a
-- coger los MISMOS archivos sin GPS en cada lote, así que nunca pasaba de los
-- 40 más recientes.
alter table assets add column if not exists gps_checked_at timestamptz;
