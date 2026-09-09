-- Ingesta diferida: la fila del asset se crea al instante (metadatos + miniatura
-- local) y el ORIGINAL se guarda en Telegram por detrás. Así el vídeo aparece en
-- la biblioteca en segundos aunque Telegram esté frenando escrituras (FLOOD_WAIT).
alter table assets add column if not exists stored boolean not null default true;
alter table assets add column if not exists src_msg_id bigint; -- mensaje del inbox pendiente de reenviar al almacén

create index if not exists assets_unstored_idx
  on assets (uploaded_at) where not stored and deleted_at is null;
