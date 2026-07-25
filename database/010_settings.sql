-- BUNBUN OS
-- Migration: application_settings

create table if not exists public.application_settings (
  id bigint generated always as identity primary key,

  business_name text not null
    default 'Bunbun Kitchen',

  business_address text,
  business_phone text,
  business_email text,

  bunbun_percentage numeric(5,2)
    not null default 70
    check (
      bunbun_percentage >= 0
      and bunbun_percentage <= 100
    ),

  currency_code text
    not null default 'IDR',

  created_by uuid
    references auth.users(id),

  updated_by uuid
    references auth.users(id),

  created_at timestamptz
    not null default now(),

  updated_at timestamptz
    not null default now(),

  is_deleted boolean
    not null default false
);

alter table public.application_settings
  enable row level security;


drop policy if exists "Owner can read settings"
on public.application_settings;

create policy "Owner can read settings"
on public.application_settings
for select
to authenticated
using (
  public.is_owner()
  and is_deleted = false
);


drop policy if exists "Owner can create settings"
on public.application_settings;

create policy "Owner can create settings"
on public.application_settings
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);


drop policy if exists "Owner can update settings"
on public.application_settings;

create policy "Owner can update settings"
on public.application_settings
for update
to authenticated
using (
  public.is_owner()
)
with check (
  public.is_owner()
);


drop trigger if exists set_application_settings_updated_at
on public.application_settings;

create trigger set_application_settings_updated_at
before update on public.application_settings
for each row
execute function public.set_updated_at();


insert into public.application_settings (
  business_name,
  bunbun_percentage,
  currency_code
)
select
  'Bunbun Kitchen',
  70,
  'IDR'
where not exists (
  select 1
  from public.application_settings
  where is_deleted = false
);