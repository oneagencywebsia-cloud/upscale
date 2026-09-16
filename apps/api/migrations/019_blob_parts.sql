-- Vídeos que superan el tope de Telegram por documento (2 GB / 4 GB Premium):
-- se trocean en partes <2GB al subirlos y se guardan como varios mensajes de
-- Telegram bajo la MISMA key lógica. `assets.original_key`/`assets.bytes`
-- siguen representando el archivo completo tal cual siempre — esta tabla es
-- pura infraestructura de almacenamiento, invisible para el resto de la app.
--
-- blob_refs (1 key = 1 mensaje) NO se toca: sigue siendo el camino de SIEMPRE
-- para archivos que caben en un solo documento. Un `key` está troceado si y
-- solo si tiene filas aquí.

create table if not exists blob_parts (
  key           text not null,
  part_index    int not null,
  tg_message_id bigint not null,
  bytes         bigint not null,
  primary key (key, part_index)
);
create index if not exists blob_parts_key_idx on blob_parts (key);
