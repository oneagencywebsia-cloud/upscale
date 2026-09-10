-- 0.16.0 — Copia ligera para REPRODUCIR.
--
-- Medido: la subida del VPS está capada a ~2,3 MB/s. Un 4K/60 del iPhone pide
-- ~6,2 MB/s para ir en tiempo real, así que se reproduce a 0,37x y se para cada
-- pocos segundos. No hay optimización que arregle eso: hay que enviar menos.
--
-- Se genera una versión 1080p (~0,6 MB/s) que SOLO se usa para verla dentro de
-- la app. El ORIGINAL no se toca jamás: sigue byte a byte en Telegram y es lo
-- que se descarga. Es el mismo modelo de Apple Photos / Google Photos / Immich.

alter table assets add column if not exists preview_key text;
alter table assets add column if not exists preview_bytes bigint;
-- 0 = pendiente, 1..n = intentos fallidos, -1 = no hace falta (ya es ligero)
alter table assets add column if not exists preview_state smallint not null default 0;

-- los vídeos que ya caben por el tubo no necesitan copia ligera
update assets
   set preview_state = -1
 where kind = 'video'
   and duration_s is not null and duration_s > 0
   and (bytes::float8 / duration_s) < 1500000;

-- las fotos nunca la necesitan
update assets set preview_state = -1 where kind = 'photo';

create index if not exists assets_preview_pend_idx
  on assets (uploaded_at desc)
  where kind = 'video' and preview_key is null and preview_state >= 0 and deleted_at is null;
