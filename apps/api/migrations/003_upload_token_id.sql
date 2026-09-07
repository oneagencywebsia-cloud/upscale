-- id propio para los tokens de subida: así la web nunca necesita el token completo
-- (se borran por id, no por el secreto).
alter table upload_tokens add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists upload_tokens_id_uk on upload_tokens (id);
