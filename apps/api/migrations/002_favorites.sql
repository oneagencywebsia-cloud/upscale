-- Favoritos
alter table assets add column if not exists is_favorite boolean not null default false;
create index if not exists assets_fav_idx on assets (user_id, captured_at desc) where is_favorite and deleted_at is null;
