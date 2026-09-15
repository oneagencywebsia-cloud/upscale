-- Un vídeo sin copia ligera aún reproduce el original entero, que a alto
-- bitrate (4K/60 HDR ronda 6+ MB/s) puede superar lo que da de sí la conexión
-- sostenida a Telegram (~2,3-10 MB/s según carga) — el propio código de
-- /v1/assets/:id/stream ya documentaba este límite. Con la cola de copias
-- ligeras procesando de UNO en uno por orden "más reciente subido primero",
-- un vídeo antiguo que alguien está viendo AHORA podía quedarse detrás de
-- todo lo demás en la cola indefinidamente, viéndose con cortes constantes
-- mientras tanto.
--
-- preview_bump_at: se marca cada vez que /stream sirve el original de un
-- vídeo sin copia lista. La cola de generarPreviews() prioriza cualquier fila
-- con esto marcado por encima del orden normal — así, VER un vídeo con
-- cortes lo manda automáticamente a la cabeza de la reparación, sin que el
-- usuario tenga que hacer nada.

alter table assets add column if not exists preview_bump_at timestamptz;
create index if not exists assets_preview_bump_idx on assets (preview_bump_at) where preview_bump_at is not null;
