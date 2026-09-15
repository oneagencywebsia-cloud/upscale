-- 0.19.0 — Distinguir "archivo dañado de origen" de "pendiente de procesar".
--
-- Auditoría en producción: 72 vídeos con nombres tipo SOMB3130.MP4 (no del
-- iPhone — probablemente de una app de descarga de redes sociales) fallaban
-- SIEMPRE al backfill. Comprobado con ffmpeg/ffprobe directamente: el átomo
-- `moov` (el índice con duración, resolución, códec) NUNCA se escribió en
-- estos archivos — "moov atom not found" incluso abriendo con ffmpeg y
-- flags tolerantes. No es un fallo de Upscale: el archivo llegó así de roto
-- desde su origen, antes de tocar Telegram. Ningún reintento lo arregla.
--
-- Hasta ahora esto se marcaba con un sentinela de 0 bytes en poster_jpg, que
-- por una comparación de bytes (octet_length(coalesce(...))>4) hacía que ni
-- el barrido de reintentos ni el contador de tareas pendientes los viera —
-- invisibles del todo, ni se reintentaban ni se contaban. Con una columna
-- explícita, se pueden EXCLUIR a propósito (no reintentar lo imposible) Y
-- contar honestamente cuántos hay.

alter table assets add column if not exists unrecoverable boolean not null default false;

create index if not exists assets_unrecoverable_idx
  on assets (unrecoverable) where unrecoverable and deleted_at is null;

-- migra los que YA tenían el sentinela viejo (poster de 0 bytes, sin poster_key
-- real generado) a la columna nueva, y les regenera la miniatura para que se
-- vea claramente "dañado" en vez de un cuadro oscuro que parece "cargando".
update assets
   set unrecoverable = true
 where kind = 'video'
   and deleted_at is null
   and octet_length(coalesce(poster_jpg, ''::bytea)) <= 4
   and (width is null or width = 0);
