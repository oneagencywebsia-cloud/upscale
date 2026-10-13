-- Audio (música, notas de voz, podcasts) como tercer tipo de archivo.
alter table assets drop constraint if exists assets_kind_check;
alter table assets add constraint assets_kind_check check (kind in ('photo', 'video', 'audio'));
