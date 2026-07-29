-- Communication V1: extend the existing asset thread model with optional
-- system context and public visitor sender metadata.

alter table public.asset_threads
  alter column created_by drop not null,
  add column if not exists system_id uuid null references public.systems(id) on delete set null,
  add column if not exists keepr_pro_id uuid null references public.keepr_pros(id) on delete set null,
  add column if not exists source_type text null,
  add column if not exists resource_ref jsonb null;

alter table public.asset_thread_messages
  alter column from_user_id drop not null,
  add column if not exists sender_type text null,
  add column if not exists sender_name text null,
  add column if not exists sender_email text null,
  add column if not exists sender_phone text null;

alter table public.event_inbox
  add column if not exists asset_thread_id uuid null references public.asset_threads(id) on delete set null;

create index if not exists asset_threads_asset_system_updated_idx
  on public.asset_threads (asset_id, system_id, updated_at desc);

create index if not exists asset_threads_owner_updated_idx
  on public.asset_threads (owner_id, updated_at desc);

create index if not exists asset_threads_keepr_pro_idx
  on public.asset_threads (keepr_pro_id)
  where keepr_pro_id is not null;

create index if not exists asset_thread_messages_thread_created_idx
  on public.asset_thread_messages (thread_id, created_at);

create index if not exists event_inbox_asset_thread_idx
  on public.event_inbox (asset_thread_id)
  where asset_thread_id is not null;

comment on column public.asset_threads.system_id is
  'Optional KAC Node/system context for Communication V1 threads.';

comment on column public.asset_threads.keepr_pro_id is
  'Optional KeeprPro relationship context only; this does not grant message access by itself.';

comment on column public.asset_threads.source_type is
  'Thread origin such as member, public_asset_story, or public_system_story.';

comment on column public.asset_threads.resource_ref is
  'Canonical resource reference for deep-link continuity: parent asset KAC, asset_id, optional system_id, public route, authenticated route, and thread_id when known.';

comment on column public.asset_thread_messages.sender_type is
  'Public or member sender classification, e.g. member or public_visitor.';

comment on column public.asset_thread_messages.sender_email is
  'Private public visitor contact field. Do not return in rollup/public resolver queries.';

comment on column public.asset_thread_messages.sender_phone is
  'Private public visitor contact field. Do not return in rollup/public resolver queries.';

create or replace function public.keepr_can_access_asset_thread(p_thread public.asset_threads)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      p_thread.owner_id = auth.uid()
      or p_thread.created_by = auth.uid()
      or exists (
        select 1
        from public.asset_stewardships s
        where s.asset_id = p_thread.asset_id
          and s.user_id = auth.uid()
          and coalesce(s.active, true) = true
          and (s.starts_at is null or s.starts_at <= now())
          and (s.ends_at is null or s.ends_at > now())
      )
      or (
        p_thread.hub_id is not null
        and exists (
          select 1
          from public.hub_members hm
          where hm.hub_id = p_thread.hub_id
            and hm.user_id = auth.uid()
            and coalesce(hm.status, 'active') = 'active'
        )
      )
    );
$$;

create or replace function public.keepr_can_start_asset_thread(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      exists (
        select 1
        from public.assets a
        where a.id = p_asset_id
          and a.owner_id = auth.uid()
          and a.deleted_at is null
      )
      or exists (
        select 1
        from public.asset_stewardships s
        where s.asset_id = p_asset_id
          and s.user_id = auth.uid()
          and coalesce(s.active, true) = true
          and (s.starts_at is null or s.starts_at <= now())
          and (s.ends_at is null or s.ends_at > now())
      )
    );
$$;

grant execute on function public.keepr_can_access_asset_thread(public.asset_threads) to authenticated;
grant execute on function public.keepr_can_start_asset_thread(uuid) to authenticated;

alter table public.asset_threads enable row level security;
alter table public.asset_thread_messages enable row level security;

drop policy if exists "communication_v1_asset_threads_select" on public.asset_threads;
create policy "communication_v1_asset_threads_select"
  on public.asset_threads
  for select
  to authenticated
  using (public.keepr_can_access_asset_thread(asset_threads));

drop policy if exists "communication_v1_asset_threads_insert" on public.asset_threads;
create policy "communication_v1_asset_threads_insert"
  on public.asset_threads
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.keepr_can_start_asset_thread(asset_id)
  );

drop policy if exists "communication_v1_asset_threads_update" on public.asset_threads;
create policy "communication_v1_asset_threads_update"
  on public.asset_threads
  for update
  to authenticated
  using (public.keepr_can_access_asset_thread(asset_threads))
  with check (public.keepr_can_access_asset_thread(asset_threads));

drop policy if exists "communication_v1_asset_thread_messages_select" on public.asset_thread_messages;
create policy "communication_v1_asset_thread_messages_select"
  on public.asset_thread_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.asset_threads t
      where t.id = asset_thread_messages.thread_id
        and public.keepr_can_access_asset_thread(t)
    )
  );

drop policy if exists "communication_v1_asset_thread_messages_insert" on public.asset_thread_messages;
create policy "communication_v1_asset_thread_messages_insert"
  on public.asset_thread_messages
  for insert
  to authenticated
  with check (
    from_user_id = auth.uid()
    and coalesce(sender_type, 'member') = 'member'
    and exists (
      select 1
      from public.asset_threads t
      where t.id = asset_thread_messages.thread_id
        and public.keepr_can_access_asset_thread(t)
    )
  );

drop policy if exists "communication_v1_asset_thread_messages_update" on public.asset_thread_messages;
create policy "communication_v1_asset_thread_messages_update"
  on public.asset_thread_messages
  for update
  to authenticated
  using (
    from_user_id = auth.uid()
    and exists (
      select 1
      from public.asset_threads t
      where t.id = asset_thread_messages.thread_id
        and public.keepr_can_access_asset_thread(t)
    )
  )
  with check (
    from_user_id = auth.uid()
    and exists (
      select 1
      from public.asset_threads t
      where t.id = asset_thread_messages.thread_id
        and public.keepr_can_access_asset_thread(t)
    )
  );

drop policy if exists "communication_v1_asset_thread_messages_delete" on public.asset_thread_messages;
create policy "communication_v1_asset_thread_messages_delete"
  on public.asset_thread_messages
  for delete
  to authenticated
  using (
    from_user_id = auth.uid()
    and exists (
      select 1
      from public.asset_threads t
      where t.id = asset_thread_messages.thread_id
        and public.keepr_can_access_asset_thread(t)
    )
  );

create or replace function public.touch_asset_thread_from_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
begin
  v_thread_id := coalesce(new.thread_id, old.thread_id);

  if v_thread_id is not null then
    update public.asset_threads
      set updated_at = now()
      where id = v_thread_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists touch_asset_thread_after_message_change on public.asset_thread_messages;
create trigger touch_asset_thread_after_message_change
  after insert or update or delete on public.asset_thread_messages
  for each row
  execute function public.touch_asset_thread_from_message();
