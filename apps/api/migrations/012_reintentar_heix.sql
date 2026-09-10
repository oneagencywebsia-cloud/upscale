-- 0.17.0 — Reintentar las derivadas que fallaron del todo.
--
-- Verificado en producción: 17 fotos HEIC + 1 vídeo salían con thumb Y póster
-- de 902 B (placeholder) y sin dimensiones. Todas las HEIC tienen marca `heix`
-- = HEIC de 10 bits (HDR) del iPhone, que la libheif de este contenedor no
-- decodifica — y vips, ImageMagick y heif-convert usan esa misma libheif, así
-- que las tres vías fallaban. 0.17.0 añade ffmpeg como 5ª vía (decodificador
-- HEVC propio, no usa libheif).
--
-- El barrido ya se había rendido con ellas (poster_jpg = centinela de 0 bytes),
-- así que aquí se les quita para que backfillDerivatives lo reintente con la
-- vía nueva.

update assets
   set poster_jpg = null
 where deleted_at is null
   and octet_length(coalesce(poster_jpg, ''::bytea)) <= 4
   and (width is null or width = 0);

delete from kv where k like 'ingest:bf:%';

-- Copias de reproducción: la migración 011 dejó en cola vídeos ingeridos por
-- cabecera (duración 0) aunque fueran ligeros. Se marca "no hace falta" los que
-- son pequeños; los pesados (>45 MB) sí necesitan copia y se quedan en cola.
update assets
   set preview_state = -1
 where kind = 'video' and deleted_at is null
   and preview_key is null and preview_state >= 0
   and (duration_s is null or duration_s = 0)
   and bytes <= 45 * 1024 * 1024;
