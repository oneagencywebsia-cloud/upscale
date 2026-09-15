-- BUG real encontrado: regenerateDerivatives() (la reparación que usa
-- backfillDerivatives para vídeos ingeridos por cabecera a los que ffprobe no
-- pudo sacarle metadatos a la primera) completaba resolución/códec pero NUNCA
-- duration_s/fps/video_bitrate, aunque el ffprobe de la propia reparación SÍ
-- los consigue. Tras 3 intentos sin poder arreglar duration_s (imposible: la
-- reparación nunca lo escribía), giveUpBackfill() fijaba duration_s = 0 como
-- marca de "renunciado" — que la interfaz muestra como "—" para siempre y que
-- además saca a el vídeo de la cola de reparación (duration_s ya no es NULL).
--
-- Arreglado el código (pipeline.ts ahora sí guarda duration_s/fps/bitrate en
-- la reparación). Esta migración reabre los vídeos ya atrapados en ese
-- estado para que vuelvan a la cola y esta vez sí se completen bien. Un
-- vídeo real con duration_s = 0 es imposible (no existe un vídeo de 0
-- segundos) — cualquier fila así es, con certeza, esta marca de renuncia.

update assets
   set duration_s = null,
       width = nullif(width, 0),
       height = nullif(height, 0)
 where kind = 'video' and duration_s = 0 and deleted_at is null;
