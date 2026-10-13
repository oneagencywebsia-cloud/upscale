-- Orden "recién subidos" de la biblioteca (GET /v1/assets?sort=added): keyset por
-- (uploaded_at, id) igual de rápido en el archivo 10 que en el 500.000.
create index if not exists assets_user_uploaded_idx
  on assets (user_id, uploaded_at desc, id desc)
  where deleted_at is null;
