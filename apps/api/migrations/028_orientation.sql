-- Orientación de lo que se VE (vertical / horizontal / cuadrada). Se saca de la miniatura,
-- que ya está girada según el EXIF: width/height del original pueden venir sin girar
-- (las fotos del iPhone suelen guardarse apaisadas con una marca de rotación).
alter table assets add column if not exists orientation text
  check (orientation in ('vertical', 'horizontal', 'cuadrada'));
create index if not exists assets_user_orientation_idx on assets (user_id, orientation, captured_at desc, id)
  where deleted_at is null and orientation is not null;
