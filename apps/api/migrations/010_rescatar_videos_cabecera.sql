-- 0.14.2 — Los vídeos ingeridos con 0.13.2 entraron SIN dimensiones, duración ni
-- códec, y sin póster: se descargaba solo la cabecera del archivo y en los
-- MP4/MOV del iPhone el índice `moov` va AL FINAL, así que ffprobe/ffmpeg no
-- podían leer nada. Además el barrido agotó sus 3 intentos y les puso el
-- centinela de "me rindo" (poster_jpg vacío), que los excluye para siempre.
--
-- Aquí se les quita el centinela para que backfillDerivatives los reprocese con
-- el original completo (ahora a ~20 MB/s, son segundos).

update assets
   set poster_jpg = null
 where kind = 'video'
   and deleted_at is null
   and (width is null or duration_s is null)
   and poster_jpg is not null
   and octet_length(poster_jpg) <= 4;

-- y se borran sus contadores de intentos para que empiecen de cero
delete from kv
 where k like 'ingest:bf:%'
   and split_part(k, ':', 3) in (
     select id::text from assets
      where kind = 'video' and deleted_at is null
        and (width is null or duration_s is null)
   );
