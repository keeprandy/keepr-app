create table if not exists public.system_groups (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 0,
  icon text,
  category text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_groups_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists system_groups_asset_name_uidx
  on public.system_groups (asset_id, lower(btrim(name)));

create index if not exists system_groups_asset_sort_idx
  on public.system_groups (asset_id, sort_order, name);

alter table public.systems
  add column if not exists system_group_id uuid references public.system_groups(id) on delete set null;

create index if not exists systems_system_group_idx
  on public.systems (system_group_id)
  where system_group_id is not null;

alter table public.system_groups enable row level security;

drop policy if exists "Asset readers read system groups" on public.system_groups;
create policy "Asset readers read system groups"
  on public.system_groups
  for select
  to authenticated
  using (public.activator_user_can_read_asset(auth.uid(), asset_id));

drop policy if exists "Asset managers manage system groups" on public.system_groups;
create policy "Asset managers manage system groups"
  on public.system_groups
  for all
  to authenticated
  using (public.activator_user_can_manage_asset(auth.uid(), asset_id))
  with check (public.activator_user_can_manage_asset(auth.uid(), asset_id));

grant select, insert, update, delete on public.system_groups to authenticated;

comment on table public.system_groups is
  'Lightweight asset-local headings for organizing canonical systems on complex assets. The rich ownership object remains public.systems.';

comment on column public.systems.system_group_id is
  'Optional grouping relationship. Null preserves the legacy flat systems experience.';
