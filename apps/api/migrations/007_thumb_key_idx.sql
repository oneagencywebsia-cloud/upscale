-- /v1/blob busca la miniatura/póster por su key cuando no está en la caché de
-- disco (tras un redeploy). Con índice es una búsqueda directa en vez de un
-- recorrido de la tabla.
create index if not exists assets_thumb_key_idx on assets (thumb_key) where deleted_at is null;
create index if not exists assets_poster_key_idx on assets (poster_key) where deleted_at is null;
