-- ============================================================
--  Cuentas de casa · setup de Supabase
--  Pegá todo esto en Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1) Tabla donde se guarda el estado de la app (clave/valor)
create table if not exists public.app_state (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz default now()
);

-- 2) Seguridad: prendemos RLS y dejamos acceso con la anon key.
--    (La app no tiene login: la comparten vos y tu hermana por la URL.)
alter table public.app_state enable row level security;

drop policy if exists "acceso abierto a app_state" on public.app_state;

create policy "acceso abierto a app_state"
  on public.app_state
  for all
  to anon, authenticated
  using (true)
  with check (true);
