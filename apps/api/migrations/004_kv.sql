-- almacén clave/valor minúsculo (estado de la ingesta desde Telegram, etc.)
create table if not exists kv (
  k text primary key,
  v text not null,
  updated_at timestamptz not null default now()
);
