-- Notas: texto enriquecido y personalizable, con capturas adjuntas (assets de la
-- biblioteca) y texto extraído por OCR. Ver docs/NOTAS.md.

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  title       text not null default '',
  -- documento del editor (ProseMirror/TipTap). El servidor lo VALIDA contra una lista
  -- de nodos y marcas permitidos antes de guardarlo: nunca se guarda HTML libre.
  body        jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  -- texto plano del documento: vista previa, búsqueda y exportación
  body_text   text not null default '',
  -- personalización (fondo, recuadro, fuente…), validada por el servidor
  style       jsonb not null default '{}'::jsonb,
  tags        text[] not null default '{}',
  pinned      boolean not null default false,
  archived_at timestamptz,
  deleted_at  timestamptz,                       -- papelera (se vacía a los 30 días)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- búsqueda de texto completo en español, siempre al día
  search      tsvector generated always as (
                to_tsvector('spanish'::regconfig, coalesce(title, '') || ' ' || coalesce(body_text, ''))
              ) stored
);
create index if not exists notes_user_updated_idx on notes (user_id, updated_at desc, id desc);
create index if not exists notes_search_idx on notes using gin (search);
create index if not exists notes_tags_idx on notes using gin (tags);

-- Capturas (assets de la biblioteca) adjuntas a una nota.
create table if not exists note_assets (
  note_id  uuid not null references notes (id) on delete cascade,
  asset_id uuid not null references assets (id) on delete cascade,
  position int  not null default 0,
  ocr_text text,                                 -- null = aún sin extraer
  ocr_at   timestamptz,
  added_at timestamptz not null default now(),
  primary key (note_id, asset_id)
);
create index if not exists note_assets_asset_idx on note_assets (asset_id);
