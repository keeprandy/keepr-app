-- KeeprSpace Playbooks V1
-- Playbooks organize asset/system/relationship work. Existing reminders execute it.

create table if not exists public.playbooks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  asset_id uuid not null references public.assets(id) on delete cascade,
  system_id uuid null references public.systems(id) on delete set null,
  asset_relationship_id uuid null references public.asset_relationships(id) on delete set null,
  organization_id uuid null references public.orgs(id) on delete set null,
  owner_user_id uuid null references auth.users(id) on delete set null,
  status text not null default 'draft',
  created_by uuid null references auth.users(id) on delete set null,
  created_by_type text not null default 'owner',
  source_playbook_id uuid null references public.playbooks(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playbooks_status_check check (status in ('draft', 'active', 'complete')),
  constraint playbooks_created_by_type_check check (created_by_type in ('owner', 'organization'))
);

create table if not exists public.playbook_steps (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references public.playbooks(id) on delete cascade,
  position integer not null default 1,
  title text not null,
  step_type text not null default 'action',
  service_offering_id uuid null references public.org_service_offerings(id) on delete set null,
  responsible_party text null,
  due_date date null,
  depends_on_step_id uuid null references public.playbook_steps(id) on delete set null,
  action_id uuid null references public.reminders(id) on delete set null,
  status text not null default 'planned',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playbook_steps_status_check check (status in ('planned', 'activated', 'complete', 'skipped')),
  constraint playbook_steps_type_check check (step_type in ('action', 'service')),
  constraint playbook_steps_position_positive check (position > 0)
);

create index if not exists playbooks_asset_idx on public.playbooks(asset_id);
create index if not exists playbooks_system_idx on public.playbooks(system_id);
create index if not exists playbooks_org_idx on public.playbooks(organization_id);
create index if not exists playbook_steps_playbook_position_idx on public.playbook_steps(playbook_id, position);
create index if not exists playbook_steps_action_idx on public.playbook_steps(action_id);

alter table public.playbooks enable row level security;
alter table public.playbook_steps enable row level security;

create or replace function public.keeprspace_user_can_read_playbook(p_user_id uuid, p_playbook_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or exists (
      select 1
      from public.playbooks p
      join public.assets a on a.id = p.asset_id
      where p.id = p_playbook_id
        and (
          a.owner_id = p_user_id
          or p.owner_user_id = p_user_id
          or (
            p.organization_id is not null
            and exists (
              select 1
              from public.org_members m
              where m.org_id = p.organization_id
                and m.user_id = p_user_id
                and coalesce(m.status, 'active') = 'active'
            )
          )
        )
    );
$$;

create or replace function public.keeprspace_user_can_manage_playbook(p_user_id uuid, p_playbook_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or exists (
      select 1
      from public.playbooks p
      join public.assets a on a.id = p.asset_id
      where p.id = p_playbook_id
        and (
          a.owner_id = p_user_id
          or p.owner_user_id = p_user_id
          or (
            p.organization_id is not null
            and public.keeprspace_user_has_org_capability(p_user_id, p.organization_id, 'create_actions')
          )
        )
    );
$$;

drop policy if exists "Playbooks are readable by asset owner or active org members" on public.playbooks;
create policy "Playbooks are readable by asset owner or active org members"
  on public.playbooks for select
  to authenticated
  using (public.keeprspace_user_can_read_playbook(auth.uid(), id));

drop policy if exists "Playbooks are manageable by asset owner or org action creators" on public.playbooks;
create policy "Playbooks are manageable by asset owner or org action creators"
  on public.playbooks for all
  to authenticated
  using (public.keeprspace_user_can_manage_playbook(auth.uid(), id))
  with check (
    exists (
      select 1
      from public.assets a
      where a.id = asset_id
        and (
          a.owner_id = auth.uid()
          or owner_user_id = auth.uid()
          or (
            organization_id is not null
            and public.keeprspace_user_has_org_capability(auth.uid(), organization_id, 'create_actions')
          )
        )
    )
  );

drop policy if exists "Playbook steps follow playbook access" on public.playbook_steps;
create policy "Playbook steps follow playbook access"
  on public.playbook_steps for select
  to authenticated
  using (public.keeprspace_user_can_read_playbook(auth.uid(), playbook_id));

drop policy if exists "Playbook steps follow playbook management" on public.playbook_steps;
create policy "Playbook steps follow playbook management"
  on public.playbook_steps for all
  to authenticated
  using (public.keeprspace_user_can_manage_playbook(auth.uid(), playbook_id))
  with check (public.keeprspace_user_can_manage_playbook(auth.uid(), playbook_id));

create or replace function public.keeprspace_service_offering_snapshot(p_service_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when s.id is null then null else jsonb_build_object(
    'id', s.id,
    'slug', s.slug,
    'key', coalesce(s.slug, s.id::text),
    'name', s.name,
    'label', coalesce(nullif(s.owner_facing_label, ''), s.name),
    'service_type', s.service_type,
    'asset_system_type', coalesce(s.metadata #>> '{service_template,asset_system_type}', s.metadata ->> 'asset_system_type'),
    'brand_applicability', coalesce(s.metadata #>> '{service_template,brand_applicability}', s.metadata ->> 'brand_applicability'),
    'interval_trigger', coalesce(s.metadata #>> '{service_template,interval_trigger}', s.metadata ->> 'interval_trigger'),
    'owner_facing_description', coalesce(nullif(s.owner_facing_description, ''), s.description),
    'service_items', coalesce(s.metadata #> '{service_template,service_items}', s.metadata -> 'service_items', '[]'::jsonb),
    'relationship_purposes', to_jsonb(coalesce(s.relationship_purposes, '{}'::text[])),
    'supported_asset_types', to_jsonb(coalesce(s.supported_asset_types, '{}'::text[])),
    'status', s.status
  ) end
  from public.org_service_offerings s
  where s.id = p_service_id;
$$;

create or replace function public.list_keeprspace_playbooks(
  p_organization_id uuid default null,
  p_asset_id uuid default null,
  p_system_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'playbooks',
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'asset_id', p.asset_id,
        'system_id', p.system_id,
        'asset_relationship_id', p.asset_relationship_id,
        'organization_id', p.organization_id,
        'owner_user_id', p.owner_user_id,
        'status', p.status,
        'created_by', p.created_by,
        'created_by_type', p.created_by_type,
        'source_playbook_id', p.source_playbook_id,
        'metadata', p.metadata,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'steps', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'playbook_id', s.playbook_id,
              'position', s.position,
              'title', s.title,
              'step_type', s.step_type,
              'service_offering_id', s.service_offering_id,
              'responsible_party', s.responsible_party,
              'due_date', s.due_date,
              'depends_on_step_id', s.depends_on_step_id,
              'action_id', s.action_id,
              'status', s.status,
              'metadata', s.metadata
            )
            order by s.position asc, s.created_at asc
          )
          from public.playbook_steps s
          where s.playbook_id = p.id
        ), '[]'::jsonb)
      )
      order by p.updated_at desc
    ), '[]'::jsonb)
  )
  from public.playbooks p
  where (p_organization_id is null or p.organization_id = p_organization_id)
    and (p_asset_id is null or p.asset_id = p_asset_id)
    and (p_system_id is null or p.system_id = p_system_id)
    and public.keeprspace_user_can_read_playbook(auth.uid(), p.id);
$$;

create or replace function public.upsert_keeprspace_playbook(p_playbook jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_playbook_id uuid := nullif(p_playbook ->> 'id', '')::uuid;
  v_asset_id uuid := nullif(p_playbook ->> 'asset_id', '')::uuid;
  v_system_id uuid := nullif(p_playbook ->> 'system_id', '')::uuid;
  v_asset_relationship_id uuid := nullif(p_playbook ->> 'asset_relationship_id', '')::uuid;
  v_organization_id uuid := nullif(p_playbook ->> 'organization_id', '')::uuid;
  v_owner_user_id uuid := nullif(p_playbook ->> 'owner_user_id', '')::uuid;
  v_name text := nullif(p_playbook ->> 'name', '');
  v_status text := coalesce(nullif(p_playbook ->> 'status', ''), 'draft');
  v_created_by_type text := coalesce(nullif(p_playbook ->> 'created_by_type', ''), case when v_organization_id is null then 'owner' else 'organization' end);
  v_steps jsonb := coalesce(p_playbook -> 'steps', '[]'::jsonb);
  v_step jsonb;
  v_position integer := 0;
begin
  if v_name is null then
    raise exception 'playbook name is required';
  end if;

  if v_asset_id is null then
    raise exception 'asset_id is required';
  end if;

  if v_owner_user_id is null then
    select a.owner_id into v_owner_user_id
    from public.assets a
    where a.id = v_asset_id;
  end if;

  if v_playbook_id is null then
    insert into public.playbooks (
      name, asset_id, system_id, asset_relationship_id, organization_id, owner_user_id,
      status, created_by, created_by_type, source_playbook_id, metadata
    )
    values (
      v_name, v_asset_id, v_system_id, v_asset_relationship_id, v_organization_id, v_owner_user_id,
      v_status, auth.uid(), v_created_by_type, nullif(p_playbook ->> 'source_playbook_id', '')::uuid,
      coalesce(p_playbook -> 'metadata', '{}'::jsonb)
    )
    returning id into v_playbook_id;
  else
    if not public.keeprspace_user_can_manage_playbook(auth.uid(), v_playbook_id) then
      raise exception 'not authorized to manage this playbook';
    end if;

    update public.playbooks
    set name = v_name,
        asset_id = v_asset_id,
        system_id = v_system_id,
        asset_relationship_id = v_asset_relationship_id,
        organization_id = v_organization_id,
        owner_user_id = v_owner_user_id,
        status = v_status,
        created_by_type = v_created_by_type,
        source_playbook_id = nullif(p_playbook ->> 'source_playbook_id', '')::uuid,
        metadata = coalesce(p_playbook -> 'metadata', '{}'::jsonb),
        updated_at = now()
    where id = v_playbook_id;
  end if;

  if not public.keeprspace_user_can_manage_playbook(auth.uid(), v_playbook_id) then
    raise exception 'not authorized to manage this playbook';
  end if;

  if v_status = 'draft' then
    delete from public.playbook_steps
    where playbook_id = v_playbook_id
      and action_id is null;
  end if;

  for v_step in select * from jsonb_array_elements(v_steps)
  loop
    v_position := v_position + 1;
    insert into public.playbook_steps (
      id, playbook_id, position, title, step_type, service_offering_id,
      responsible_party, due_date, depends_on_step_id, action_id, status, metadata
    )
    values (
      coalesce(nullif(v_step ->> 'id', '')::uuid, gen_random_uuid()),
      v_playbook_id,
      coalesce(nullif(v_step ->> 'position', '')::integer, v_position),
      coalesce(nullif(v_step ->> 'title', ''), 'Untitled step'),
      coalesce(nullif(v_step ->> 'step_type', ''), 'action'),
      nullif(v_step ->> 'service_offering_id', '')::uuid,
      nullif(v_step ->> 'responsible_party', ''),
      nullif(v_step ->> 'due_date', '')::date,
      nullif(v_step ->> 'depends_on_step_id', '')::uuid,
      nullif(v_step ->> 'action_id', '')::uuid,
      coalesce(nullif(v_step ->> 'status', ''), 'planned'),
      coalesce(v_step -> 'metadata', '{}'::jsonb)
    )
    on conflict (id) do update
      set position = excluded.position,
          title = excluded.title,
          step_type = excluded.step_type,
          service_offering_id = excluded.service_offering_id,
          responsible_party = excluded.responsible_party,
          due_date = excluded.due_date,
          depends_on_step_id = excluded.depends_on_step_id,
          status = case
            when public.playbook_steps.action_id is not null then public.playbook_steps.status
            else excluded.status
          end,
          metadata = excluded.metadata,
          updated_at = now();
  end loop;

  return (
    select jsonb_build_object('playbook', p)
    from (
      select *
      from public.playbooks
      where id = v_playbook_id
    ) p
  );
end;
$$;

create or replace function public.activate_keeprspace_playbook(p_playbook_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_playbook public.playbooks;
  v_step public.playbook_steps;
  v_action_id uuid;
  v_service jsonb;
  v_extra jsonb;
  v_due_at timestamptz;
begin
  select * into v_playbook
  from public.playbooks
  where id = p_playbook_id;

  if v_playbook.id is null then
    raise exception 'playbook not found';
  end if;

  if not public.keeprspace_user_can_manage_playbook(auth.uid(), p_playbook_id) then
    raise exception 'not authorized to activate this playbook';
  end if;

  for v_step in
    select *
    from public.playbook_steps
    where playbook_id = p_playbook_id
      and status = 'planned'
      and action_id is null
    order by position asc, created_at asc
  loop
    v_service := case
      when v_step.service_offering_id is not null
        then public.keeprspace_service_offering_snapshot(v_step.service_offering_id)
      else null
    end;

    v_due_at := case
      when v_step.due_date is null then null
      else (v_step.due_date::text || 'T12:00:00Z')::timestamptz
    end;

    v_extra := jsonb_build_object(
      'source', 'keeprspace_playbook',
      'action_type', case when v_step.step_type = 'service' then 'service' else 'playbook_action' end,
      'playbook_id', v_playbook.id,
      'playbook_step_id', v_step.id,
      'playbook_name', v_playbook.name,
      'playbook_step_position', v_step.position,
      'playbook_step_type', v_step.step_type,
      'responsible_party_default', v_step.responsible_party,
      'visibility_org_id', v_playbook.organization_id,
      'asset_relationship_id', v_playbook.asset_relationship_id
    ) || coalesce(v_step.metadata, '{}'::jsonb);

    if v_service is not null then
      v_extra := v_extra || jsonb_build_object(
        'service_action', true,
        'service_template_id', v_step.service_offering_id,
        'service_template_key', coalesce(v_service ->> 'key', v_step.service_offering_id::text),
        'service_template_name', v_service ->> 'name',
        'service_template_label', v_service ->> 'label',
        'service_template_snapshot', v_service,
        'service_template_org_id', v_playbook.organization_id
      );
    end if;

    insert into public.reminders (
      owner_id, title, notes, due_at, status, asset_id, system_id, extra_metadata, created_at, updated_at
    )
    values (
      coalesce(v_playbook.owner_user_id, auth.uid()),
      v_step.title,
      coalesce(v_service ->> 'owner_facing_description', v_step.metadata ->> 'notes'),
      v_due_at,
      'open',
      v_playbook.asset_id,
      coalesce(v_playbook.system_id, null),
      v_extra,
      now(),
      now()
    )
    returning id into v_action_id;

    update public.playbook_steps
    set action_id = v_action_id,
        status = 'activated',
        updated_at = now()
    where id = v_step.id;
  end loop;

  update public.playbooks
  set status = 'active',
      updated_at = now()
  where id = p_playbook_id;

  return public.list_keeprspace_playbooks(v_playbook.organization_id, v_playbook.asset_id, v_playbook.system_id);
end;
$$;

grant select, insert, update, delete on public.playbooks to authenticated;
grant select, insert, update, delete on public.playbook_steps to authenticated;
grant execute on function public.keeprspace_user_can_read_playbook(uuid, uuid) to authenticated;
grant execute on function public.keeprspace_user_can_manage_playbook(uuid, uuid) to authenticated;
grant execute on function public.keeprspace_service_offering_snapshot(uuid) to authenticated;
grant execute on function public.list_keeprspace_playbooks(uuid, uuid, uuid) to authenticated;
grant execute on function public.upsert_keeprspace_playbook(jsonb) to authenticated;
grant execute on function public.activate_keeprspace_playbook(uuid) to authenticated;
