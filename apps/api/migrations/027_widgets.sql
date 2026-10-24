-- Widgets: una «vista» configurable de lo que hay en la cuenta (una foto, varias,
-- un álbum, una nota, los recuerdos de hoy, el espacio usado) que se pinta como
-- IMAGEN en una dirección privada. Así vale para cualquier cosa que sepa mostrar
-- una imagen de internet: widgets de iPhone (Scriptable), de Android (KWGT…),
-- fondos de pantalla o el modo marco de fotos.
--
-- `token` es la «llave» de la dirección (192 bits al azar). Solo da acceso al
-- dibujo de ESE widget, nunca a la cuenta ni a los originales, y se puede
-- regenerar o borrar en cualquier momento.
create table if not exists widgets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  token      text not null unique,
  name       text not null default '',
  kind       text not null check (kind in ('foto','coleccion','album','nota','espacio','recuerdos')),
  config     jsonb not null default '{}'::jsonb,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used  timestamptz
);
create index if not exists widgets_user_idx on widgets (user_id, position, created_at);
