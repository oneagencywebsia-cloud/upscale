-- 0.13.1 — Muchas fotos HEIC quedaron con la resolución de la MINIATURA
-- incrustada (p. ej. 700x599, codec 'mjpeg') porque ffprobe, al no saber leer
-- HEIC, devolvía ese stream en vez de la imagen real. Otras entraron sin
-- dimensiones. Se limpian los valores sospechosos y se pone poster_jpg a NULL
-- para que el barrido de fondo (backfillDerivatives) las reprocese con
-- vips/heif-convert y esta vez sí guarde width/height/codec correctos.
update assets
   set width = null,
       height = null,
       codec = null
 where kind = 'photo'
   and deleted_at is null
   and (
        width is null
     or width < 1000
     or height < 1000
     or lower(coalesce(codec, '')) in ('mjpeg', 'png', 'bmp', 'gif', 'tiff')
   );

update assets
   set poster_jpg = null
 where kind = 'photo'
   and deleted_at is null
   and stored = true
   and width is null
   and poster_jpg is not null
   and octet_length(poster_jpg) > 4;
