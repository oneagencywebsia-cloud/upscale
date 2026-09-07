-- Upscale — esquema inicial (multi-usuario, auth por Supabase)

create extension if not exists "pgcrypto";

-- Fotos y vídeos. user_id = auth.users.id de Supabase (uuid), sin FK dura
-- para no acoplar la API al esquema interno de Supabase Auth.
create table if not exists assets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  kind          text not null check (kind in ('photo','video')),
  filename      text not null,
  mime          text not null,
  bytes         bigint not null,
  sha256        text not null,
  width         int,
  height        int,
  duration_s    numeric,
  fps           numeric,
  video_bitrate bigint,
  codec         text,
  captured_at   timestamptz not null,
  uploaded_at   timestamptz not null default now(),
  camera_make   text,
  camera_model  text,
  lens          text,
  lat           double precision,
  lon           double precision,
  is_live       boolean not null default false,
  original_key  text not null,
  thumb_key     text not null,
  poster_key    text,
  deleted_at    timestamptz
);

create unique index if not exists assets_user_sha_uk
  on assets (user_id, sha256) where deleted_at is null;
create index if not exists assets_feed_idx
  on assets (user_id, captured_at desc, id desc) where deleted_at is null;
create index if not exists assets_kind_idx
  on assets (user_id, kind) where deleted_at is null;

-- Tokens para subir desde el Atajo de iOS (uno o varios por usuario).
create table if not exists upload_tokens (
  token      text primary key,
  user_id    uuid not null,
  label      text,
  created_at timestamptz not null default now(),
  last_used  timestamptz
);
create index if not exists upload_tokens_user_idx on upload_tokens (user_id);

-- Registro de lo que ve/descarga cada usuario.
create table if not exists access_log (
  id       bigint generated always as identity primary key,
  user_id  uuid not null,
  asset_id uuid,
  action   text not null check (action in ('view','download','list')),
  at       timestamptz not null default now(),
  ua       text
);
create index if not exists access_log_user_idx on access_log (user_id, at desc);
