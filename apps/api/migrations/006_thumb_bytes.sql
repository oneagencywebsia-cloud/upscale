-- Miniatura y póster guardados EN LA BASE DE DATOS (bytes). Son pequeños
-- (~10-150 KB) y así no dependen ni de Telegram ni de la caché de disco
-- (que es efímera y se borra en cada redeploy). El original grande sigue en
-- Telegram; esto es solo para lo que el usuario ve todo el rato.
alter table assets add column if not exists thumb_webp bytea;
alter table assets add column if not exists poster_jpg bytea;
