-- Las fotos HEIC entraron sin dimensiones ni códec (ffprobe de bookworm no lee
-- HEIC). Poniendo poster_jpg a NULL, el barrido de fondo las vuelve a procesar
-- con vips/heif-convert y esta vez sí rellena width/height/codec.
update assets set poster_jpg = null
  where kind = 'photo' and deleted_at is null and width is null
    and poster_jpg is not null and octet_length(poster_jpg) > 4;
