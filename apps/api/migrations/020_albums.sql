-- Álbumes: agrupaciones simples de assets, creadas y gestionadas a mano por
-- el usuario (no hay carpetas anidadas, ni permisos, ni compartir — un álbum
-- es solo "una lista con nombre").
--
-- N-a-N (album_assets) y no una columna album_id en `assets`: un mismo asset
-- puede vivir en varios álbumes a la vez (una foto de un viaje puede estar en
-- "Vacaciones 2026" Y en "Favoritas del año"), así que la relación no puede
-- ser 1-a-N.
--
-- Sin columna de portada denormalizada en `albums`: la portada se calcula al
-- vuelo (el asset más reciente del álbum, ver GET /v1/albums) porque siempre
-- va a estar fresca sin necesidad de un trigger/UPDATE extra cada vez que se
-- añade, quita o borra un asset — con pocos álbumes por usuario ese cálculo
-- es barato y evita todo un mecanismo de sincronización que podría desincronizarse.
--
-- `on delete cascade` en ambas FKs de album_assets: borrar un álbum limpia
-- solo sus filas de album_assets (nunca toca `assets`); borrar (de verdad, un
-- delete físico) un asset lo saca de cualquier álbum en el que estuviera. El
-- borrado normal de un asset es un soft-delete (`deleted_at`), así que en la
-- práctica esa cascada real casi nunca dispara — es la red de seguridad para
-- cuando sí se borra físicamente.
create table if not exists albums (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  name       text not null,
  created_at timestamptz not null default now()
);
create index if not exists albums_user_idx on albums (user_id, created_at desc);

create table if not exists album_assets (
  album_id uuid not null references albums(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (album_id, asset_id)
);
create index if not exists album_assets_album_idx on album_assets (album_id, added_at desc);
