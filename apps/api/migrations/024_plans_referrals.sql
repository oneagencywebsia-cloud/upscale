-- Planes, cuotas, códigos y "invita y gana".
-- El catálogo de planes (tamaños y precios) vive en src/plans.ts; aquí solo se
-- guarda el estado de cada persona.

create table if not exists profiles (
  user_id              uuid primary key,
  plan                 text not null default 'free',
  plan_until           timestamptz,                 -- null = sin caducidad
  bonus_bytes          bigint not null default 0,   -- espacio extra (códigos, invitaciones)
  referral_code        text not null unique,        -- el que comparte esta persona
  referred_by          uuid,                        -- quién la invitó
  referral_rewarded_at timestamptz,                 -- cuándo se pagó la recompensa de esta invitación
  created_at           timestamptz not null default now()
);
create index if not exists profiles_referred_by_idx on profiles (referred_by) where referred_by is not null;

-- Códigos de canje: espacio extra (kind='bonus') o un plan de prueba (kind='plan').
create table if not exists redeem_codes (
  code        text primary key,                      -- siempre en MAYÚSCULAS
  kind        text not null check (kind in ('bonus', 'plan')),
  bonus_bytes bigint,
  plan        text,
  plan_days   int,
  max_uses    int,                                   -- null = ilimitado
  uses        int not null default 0,
  expires_at  timestamptz,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists code_redemptions (
  code        text not null,
  user_id     uuid not null,
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);

-- Lista de espera de los planes de pago (hasta que haya cobro).
create table if not exists waitlist (
  user_id    uuid not null,
  plan       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, plan)
);

-- Dos códigos de bienvenida para empezar. Se gestionan luego con
-- POST /v1/admin/codes (solo administrador).
insert into redeem_codes (code, kind, bonus_bytes, max_uses, note)
values ('BIENVENIDA', 'bonus', 2147483648, null, '+2 GB de bienvenida')
on conflict (code) do nothing;
insert into redeem_codes (code, kind, plan, plan_days, max_uses, note)
values ('PRUEBA30', 'plan', 'plus', 30, 500, '30 días de plan Plus')
on conflict (code) do nothing;
