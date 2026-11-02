-- LOCAL/GITHUB ACTIONS POSTGRES ONLY. NEVER EXECUTE ON A SUPABASE PROJECT.
-- Run as postgres superuser on a throwaway database.
do $boot$
begin
  if not exists(select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists(select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists(select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$boot$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create table if not exists public.profiles (
  id uuid primary key references auth.users(id),
  role text not null check(role in ('owner','baker','helper')),
  is_active boolean not null
);

grant usage on schema public, auth to service_role;
grant select on public.profiles,auth.users to service_role;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
insert into public.profiles (id,role,is_active) values
  ('11111111-1111-4111-8111-111111111111','owner',true),
  ('22222222-2222-4222-8222-222222222222','baker',true),
  ('33333333-3333-4333-8333-333333333333','owner',false);
