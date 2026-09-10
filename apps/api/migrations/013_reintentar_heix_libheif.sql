-- 0.17.1 — Reintento definitivo de las HEIC `heix`.
--
-- 0.17.0 añadió ffmpeg como vía, pero el ffmpeg 5.1 de Debian 12 tampoco lee
-- HEIF de forma fiable, así que las 15 HEIC de 10 bits seguían sin miniatura y
-- el backfill volvió a rendirse. 0.17.1 actualiza libheif a 1.19 (backports) —
-- que sí decodifica `heix` — y añade exiftool como última vía (el JPEG
-- incrustado, sin decodificar HEVC).
--
-- Se les quita otra vez el centinela de "me rindo" para que el backfill lo
-- reintente ya con libheif nueva.

update assets
   set poster_jpg = null
 where deleted_at is null
   and octet_length(coalesce(poster_jpg, ''::bytea)) <= 4
   and (width is null or width = 0);

delete from kv where k like 'ingest:bf:%';
