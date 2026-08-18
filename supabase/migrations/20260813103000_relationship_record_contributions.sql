begin;

create table if not exists public.asset_relationship_record_contributions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  service_record_id uuid references public.service_records(id) on delete set null,
  asset_relationship_id uuid references public.asset_relationships(id) on delete set null,
  stewardship_id uuid references public.asset_provider_stewardships(id) on delete set null,
  organization_id uuid references public.orgs(id) on delete cascade,
  from_user_id uuid references public.profiles(id) on delete set null,
  from_org_id uuid references public.orgs(id) on delete set null,
  to_user_id uuid references public.profiles(id) on delete cascade,
  direction text not null,
  status text not null default 'pending',
  title text not null,
  record_type text,
  performed_at date,
  amount numeric,
  note text,
  source_metadata jsonb not null default '{}'::jsonb,
  accepted_service_record_id uuid references public.service_records(id) on delete set null,
  accepted_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_relationship_record_contributions_direction_check
    check (direction in ('owner_to_org', 'org_to_owner')),
  constraint asset_relationship_record_contributions_status_check
    check (status in ('shared', 'pending', 'accepted', 'dismissed', 'revoked')),
  constraint asset_relationship_record_contributions_relationship_check
    check (asset_relationship_id is not null or stewardship_id is not null or organization_id is not null)
);

create unique index if not exists asset_relationship_record_contributions_owner_share_uidx
  on public.asset_relationship_record_contributions (
    service_record_id,
    coalesce(asset_relationship_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(stewardship_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where direction = 'owner_to_org' and service_record_id is not null and status in ('shared', 'pending', 'accepted');

create index if not exists asset_relationship_record_contributions_asset_idx
  on public.asset_relationship_record_contributions (asset_id, created_at desc);

create index if not exists asset_relationship_record_contributions_org_idx
  on public.asset_relationship_record_contributions (organization_id, status, created_at desc);

create index if not exists asset_relationship_record_contributions_owner_idx
  on public.asset_relationship_record_contributions (to_user_id, status, created_at desc);

alter table public.asset_relationship_record_contributions enable row level security;

drop policy if exists "Relationship contribution participants can read" on public.asset_relationship_record_contributions;
create policy "Relationship contribution participants can read"
  on public.asset_relationship_record_contributions
  for select
  to authenticated
  using (
    to_user_id = auth.uid()
    or from_user_id = auth.uid()
    or public.activator_user_can_read_asset(auth.uid(), asset_id)
    or (
      organization_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), organization_id)
    )
  );

create or replace function public.keeprspace_resolve_asset_relationship_context(
  p_asset_id uuid,
  p_organization_id uuid default null,
  p_asset_relationship_id uuid default null,
  p_stewardship_id uuid default null
)
returns table (
  asset_id uuid,
  asset_owner_id uuid,
  organization_id uuid,
  keepr_pro_id uuid,
  asset_relationship_id uuid,
  stewardship_id uuid,
  relationship_type text,
  status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  with asset_row as (
    select a.id, a.owner_id
    from public.assets a
    where a.id = p_asset_id
      and coalesce(a.deleted_at is null, true)
    limit 1
  ),
  rel as (
    select
      ar.asset_id,
      ar.organization_id,
      ar.keepr_pro_id,
      ar.id as asset_relationship_id,
      nullif(ar.metadata ->> 'compatibility_stewardship_id', '')::uuid as stewardship_id,
      ar.relationship_type,
      ar.status
    from public.asset_relationships ar
    where ar.asset_id = p_asset_id
      and (p_asset_relationship_id is null or ar.id = p_asset_relationship_id)
      and (p_organization_id is null or ar.organization_id = p_organization_id)
      and ar.status in ('active', 'pending', 'invited', 'paused')
    order by
      case when p_asset_relationship_id is not null and ar.id = p_asset_relationship_id then 0 else 1 end,
      case when p_organization_id is not null and ar.organization_id = p_organization_id then 0 else 1 end,
      ar.created_at desc
    limit 1
  ),
  stew as (
    select
      aps.asset_id,
      aps.organization_id,
      aps.keepr_pro_id,
      null::uuid as asset_relationship_id,
      aps.id as stewardship_id,
      aps.relationship_type,
      aps.status
    from public.asset_provider_stewardships aps
    where aps.asset_id = p_asset_id
      and (p_stewardship_id is null or aps.id = p_stewardship_id)
      and (p_organization_id is null or aps.organization_id = p_organization_id)
      and coalesce(aps.status, 'active') = 'active'
    order by
      case when p_stewardship_id is not null and aps.id = p_stewardship_id then 0 else 1 end,
      aps.created_at desc
    limit 1
  ),
  picked as (
    select * from rel
    union all
    select * from stew
    limit 1
  )
  select
    a.id,
    a.owner_id,
    p.organization_id,
    p.keepr_pro_id,
    p.asset_relationship_id,
    p.stewardship_id,
    p.relationship_type,
    p.status
  from asset_row a
  join picked p on p.asset_id = a.id;
end;
$$;

create or replace function public.share_asset_record_to_relationship(
  p_service_record_id uuid,
  p_organization_id uuid default null,
  p_asset_relationship_id uuid default null,
  p_stewardship_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.service_records;
  v_context record;
  v_contribution public.asset_relationship_record_contributions;
begin
  select *
  into v_record
  from public.service_records
  where id = p_service_record_id;

  if v_record.id is null then
    raise exception 'Service record not found';
  end if;

  if p_organization_id is null and p_asset_relationship_id is null and p_stewardship_id is null and v_record.keepr_pro_id is not null then
    select
      a.id as asset_id,
      a.owner_id as asset_owner_id,
      kp.organization_id,
      kp.id as keepr_pro_id,
      ar.id as asset_relationship_id,
      aps.id as stewardship_id,
      coalesce(ar.relationship_type, aps.relationship_type) as relationship_type,
      coalesce(ar.status, aps.status) as status
    into v_context
    from public.assets a
    join public.keepr_pros kp
      on kp.id = v_record.keepr_pro_id
    left join public.asset_relationships ar
      on ar.asset_id = a.id
     and ar.organization_id = kp.organization_id
     and ar.status in ('active', 'pending', 'invited', 'paused')
     and ar.relationship_type <> 'owner'
    left join public.asset_provider_stewardships aps
      on aps.asset_id = a.id
     and aps.keepr_pro_id = kp.id
     and aps.organization_id = kp.organization_id
     and coalesce(aps.status, 'active') = 'active'
    where a.id = v_record.asset_id
    order by ar.created_at desc nulls last, aps.created_at desc nulls last
    limit 1;
  else
    select *
    into v_context
    from public.keeprspace_resolve_asset_relationship_context(
      v_record.asset_id,
      p_organization_id,
      p_asset_relationship_id,
      p_stewardship_id
    )
    limit 1;
  end if;

  if v_context.asset_id is null then
    raise exception 'Relationship was not found';
  end if;

  if v_context.asset_owner_id <> auth.uid() then
    raise exception 'Only the asset owner can share this record';
  end if;

  update public.service_records
  set
    keepr_pro_id = coalesce(keepr_pro_id, v_context.keepr_pro_id),
    extra_metadata = coalesce(extra_metadata, '{}'::jsonb) ||
      jsonb_build_object(
        'relationship_shared', true,
        'shared_relationship', jsonb_strip_nulls(jsonb_build_object(
          'organization_id', v_context.organization_id,
          'asset_relationship_id', v_context.asset_relationship_id,
          'stewardship_id', v_context.stewardship_id,
          'shared_by_user_id', auth.uid(),
          'shared_at', now()
        ))
      )
  where id = v_record.id
  returning * into v_record;

  select *
  into v_contribution
  from public.asset_relationship_record_contributions c
  where c.direction = 'owner_to_org'
    and c.service_record_id = v_record.id
    and c.status in ('shared', 'pending', 'accepted')
    and coalesce(c.asset_relationship_id, '00000000-0000-0000-0000-000000000000'::uuid) =
      coalesce(v_context.asset_relationship_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(c.stewardship_id, '00000000-0000-0000-0000-000000000000'::uuid) =
      coalesce(v_context.stewardship_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(c.organization_id, '00000000-0000-0000-0000-000000000000'::uuid) =
      coalesce(v_context.organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
  limit 1;

  if v_contribution.id is null then
    insert into public.asset_relationship_record_contributions (
      asset_id,
      service_record_id,
      asset_relationship_id,
      stewardship_id,
      organization_id,
      from_user_id,
      to_user_id,
      direction,
      status,
      title,
      record_type,
      performed_at,
      amount,
      note,
      source_metadata
    )
    values (
      v_record.asset_id,
      v_record.id,
      v_context.asset_relationship_id,
      v_context.stewardship_id,
      v_context.organization_id,
      auth.uid(),
      v_context.asset_owner_id,
      'owner_to_org',
      'shared',
      coalesce(nullif(v_record.title, ''), 'Shared record'),
      v_record.service_type,
      v_record.performed_at,
      v_record.cost,
      v_record.notes,
      jsonb_strip_nulls(jsonb_build_object(
        'keepr_pro_id', v_context.keepr_pro_id,
        'relationship_type', v_context.relationship_type
      ))
    )
    returning * into v_contribution;
  else
    update public.asset_relationship_record_contributions
    set
      status = 'shared',
      title = coalesce(nullif(v_record.title, ''), 'Shared record'),
      record_type = v_record.service_type,
      performed_at = v_record.performed_at,
      amount = v_record.cost,
      note = v_record.notes,
      updated_at = now()
    where id = v_contribution.id
    returning * into v_contribution;
  end if;

  insert into public.attachment_placements (attachment_id, target_type, target_id, role, label)
  select
    ap.attachment_id,
    'asset',
    v_record.asset_id,
    'relationship_shared',
    coalesce(v_context.stewardship_id::text, v_context.asset_relationship_id::text, v_context.organization_id::text)
  from public.attachment_placements ap
  where ap.target_type = 'service_record'
    and ap.target_id = v_record.id
  on conflict (attachment_id, target_type, target_id) do update
    set
      role = excluded.role,
      label = excluded.label;

  return jsonb_build_object(
    'ok', true,
    'contribution_id', v_contribution.id,
    'service_record_id', v_record.id,
    'asset_id', v_record.asset_id,
    'status', v_contribution.status
  );
end;
$$;

create or replace function public.create_relationship_record_contribution(
  p_asset_id uuid,
  p_organization_id uuid default null,
  p_asset_relationship_id uuid default null,
  p_stewardship_id uuid default null,
  p_title text default null,
  p_record_type text default 'service',
  p_performed_at date default null,
  p_amount numeric default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_contribution public.asset_relationship_record_contributions;
begin
  select *
  into v_context
  from public.keeprspace_resolve_asset_relationship_context(
    p_asset_id,
    p_organization_id,
    p_asset_relationship_id,
    p_stewardship_id
  )
  limit 1;

  if v_context.asset_id is null then
    raise exception 'Relationship was not found';
  end if;

  if not public.activator_user_can_act_for_org(auth.uid(), v_context.organization_id) then
    raise exception 'You cannot contribute records for this workspace';
  end if;

  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception 'Title is required';
  end if;

  insert into public.asset_relationship_record_contributions (
    asset_id,
    asset_relationship_id,
    stewardship_id,
    organization_id,
    from_user_id,
    from_org_id,
    to_user_id,
    direction,
    status,
    title,
    record_type,
    performed_at,
    amount,
    note,
    source_metadata
  )
  values (
    v_context.asset_id,
    v_context.asset_relationship_id,
    v_context.stewardship_id,
    v_context.organization_id,
    auth.uid(),
    v_context.organization_id,
    v_context.asset_owner_id,
    'org_to_owner',
    'pending',
    trim(p_title),
    coalesce(nullif(trim(p_record_type), ''), 'service'),
    p_performed_at,
    p_amount,
    p_note,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'keepr_pro_id', v_context.keepr_pro_id,
      'relationship_type', v_context.relationship_type
    ))
  )
  returning * into v_contribution;

  insert into public.inbox_items (to_user_id, type, status, payload)
  values (
    v_context.asset_owner_id,
    'relationship_record_contribution',
    'pending',
    jsonb_build_object(
      'contribution_id', v_contribution.id,
      'asset_id', v_contribution.asset_id,
      'organization_id', v_contribution.organization_id,
      'title', v_contribution.title,
      'record_type', v_contribution.record_type,
      'performed_at', v_contribution.performed_at,
      'amount', v_contribution.amount,
      'note', v_contribution.note
    )
  );

  insert into public.attachment_placements (attachment_id, target_type, target_id, role, label)
  select
    attachment_id::uuid,
    'asset_relationship_record_contribution',
    v_contribution.id,
    'proof',
    'source_proof'
  from jsonb_array_elements_text(coalesce(p_metadata -> 'attachment_ids', '[]'::jsonb)) as attachment_ids(attachment_id)
  on conflict (attachment_id, target_type, target_id) do update
    set
      role = excluded.role,
      label = excluded.label;

  return jsonb_build_object(
    'ok', true,
    'contribution_id', v_contribution.id,
    'asset_id', v_contribution.asset_id,
    'status', v_contribution.status
  );
end;
$$;

create or replace function public.list_my_relationship_record_contributions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'asset_id', c.asset_id,
    'asset_name', a.name,
    'asset_kac', a.kac_id,
    'organization_id', c.organization_id,
    'organization_name', coalesce(nullif(o.display_name, ''), nullif(o.name, ''), 'Organization'),
    'title', c.title,
    'record_type', c.record_type,
    'performed_at', c.performed_at,
    'amount', c.amount,
    'note', c.note,
    'status', c.status,
    'direction', c.direction,
    'created_at', c.created_at,
    'source_metadata', c.source_metadata
  ) order by c.created_at desc), '[]'::jsonb)
  from public.asset_relationship_record_contributions c
  join public.assets a on a.id = c.asset_id
  left join public.orgs o on o.id = c.organization_id
  where c.to_user_id = auth.uid()
    and c.direction = 'org_to_owner'
    and c.status = 'pending';
$$;

create or replace function public.list_relationship_shared_history(
  p_asset_id uuid,
  p_organization_id uuid default null,
  p_asset_relationship_id uuid default null,
  p_stewardship_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_context record;
  v_history jsonb := '[]'::jsonb;
begin
  select *
  into v_context
  from public.keeprspace_resolve_asset_relationship_context(
    p_asset_id,
    p_organization_id,
    p_asset_relationship_id,
    p_stewardship_id
  )
  limit 1;

  if v_context.asset_id is null then
    return '[]'::jsonb;
  end if;

  if not (
    v_context.asset_owner_id = auth.uid()
    or (
      v_context.organization_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), v_context.organization_id)
    )
  ) then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', sr.id,
        'title', sr.title,
        'service_type', sr.service_type,
        'category', sr.category,
        'performed_at', sr.performed_at,
        'verification_status', sr.verification_status,
        'keepr_pro_id', sr.keepr_pro_id,
        'cost', sr.cost,
        'contribution_id', c.id,
        'contribution_direction', c.direction,
        'contributed_by_user_id', c.from_user_id,
        'contributed_by_org_id', c.from_org_id,
        'contribution_status', c.status
      )
      order by sr.performed_at desc nulls last, sr.created_at desc
    ),
    '[]'::jsonb
  )
  into v_history
  from public.asset_relationship_record_contributions c
  join public.service_records sr
    on sr.id = coalesce(c.accepted_service_record_id, c.service_record_id)
   and sr.asset_id = c.asset_id
  where c.asset_id = v_context.asset_id
    and c.organization_id = v_context.organization_id
    and c.status in ('shared', 'accepted')
    and (
      c.asset_relationship_id is null
      or v_context.asset_relationship_id is null
      or c.asset_relationship_id = v_context.asset_relationship_id
    )
    and (
      c.stewardship_id is null
      or v_context.stewardship_id is null
      or c.stewardship_id = v_context.stewardship_id
    );

  return v_history;
end;
$$;

create or replace function public.accept_relationship_record_contribution(
  p_contribution_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contribution public.asset_relationship_record_contributions;
  v_record public.service_records;
begin
  select *
  into v_contribution
  from public.asset_relationship_record_contributions
  where id = p_contribution_id
  for update;

  if v_contribution.id is null then
    raise exception 'Contribution not found';
  end if;

  if v_contribution.to_user_id <> auth.uid() then
    raise exception 'Only the asset owner can accept this contribution';
  end if;

  if v_contribution.status <> 'pending' then
    return jsonb_build_object(
      'ok', true,
      'status', v_contribution.status,
      'service_record_id', v_contribution.accepted_service_record_id
    );
  end if;

  insert into public.service_records (
    asset_id,
    title,
    notes,
    service_type,
    performed_at,
    cost,
    keepr_pro_id,
    source_type,
    verification_status,
    extra_metadata
  )
  values (
    v_contribution.asset_id,
    v_contribution.title,
    v_contribution.note,
    coalesce(v_contribution.record_type, 'service'),
    v_contribution.performed_at,
    v_contribution.amount,
    nullif(v_contribution.source_metadata ->> 'keepr_pro_id', '')::uuid,
    'relationship_contribution',
    'contributed',
    jsonb_build_object(
      'relationship_contribution_id', v_contribution.id,
      'source_org_id', v_contribution.from_org_id,
      'asset_relationship_id', v_contribution.asset_relationship_id,
      'stewardship_id', v_contribution.stewardship_id
    ) || coalesce(v_contribution.source_metadata, '{}'::jsonb)
  )
  returning * into v_record;

  insert into public.attachment_placements (attachment_id, target_type, target_id, role, label)
  select
    ap.attachment_id,
    'service_record',
    v_record.id,
    'proof',
    'relationship_contribution:' || v_contribution.id::text
  from public.attachment_placements ap
  where ap.target_type = 'asset_relationship_record_contribution'
    and ap.target_id = v_contribution.id
  on conflict (attachment_id, target_type, target_id) do update
    set
      role = excluded.role,
      label = excluded.label;

  update public.asset_relationship_record_contributions
  set
    status = 'accepted',
    accepted_service_record_id = v_record.id,
    accepted_at = now(),
    updated_at = now()
  where id = v_contribution.id
  returning * into v_contribution;

  return jsonb_build_object(
    'ok', true,
    'status', v_contribution.status,
    'service_record_id', v_record.id,
    'asset_id', v_record.asset_id
  );
end;
$$;

create or replace function public.dismiss_relationship_record_contribution(
  p_contribution_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contribution public.asset_relationship_record_contributions;
begin
  update public.asset_relationship_record_contributions
  set
    status = 'dismissed',
    dismissed_at = now(),
    updated_at = now()
  where id = p_contribution_id
    and to_user_id = auth.uid()
    and status = 'pending'
  returning * into v_contribution;

  if v_contribution.id is null then
    raise exception 'Contribution not found or already handled';
  end if;

  update public.inbox_items
  set status = 'declined', responded_at = now()
  where to_user_id = auth.uid()
    and type = 'relationship_record_contribution'
    and payload ->> 'contribution_id' = p_contribution_id::text
    and status = 'pending';

  return jsonb_build_object('ok', true, 'status', v_contribution.status);
end;
$$;

create or replace function public.get_relationship_service_record(
  p_service_record_id uuid,
  p_asset_id uuid default null,
  p_organization_id uuid default null,
  p_asset_relationship_id uuid default null,
  p_stewardship_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_record public.service_records;
  v_context record;
  v_files jsonb := '[]'::jsonb;
begin
  select *
  into v_record
  from public.service_records
  where id = p_service_record_id
    and (p_asset_id is null or asset_id = p_asset_id);

  if v_record.id is null then
    return null;
  end if;

  select *
  into v_context
  from public.keeprspace_resolve_asset_relationship_context(
    v_record.asset_id,
    p_organization_id,
    p_asset_relationship_id,
    p_stewardship_id
  )
  limit 1;

  if not (
    exists (
      select 1 from public.assets a
      where a.id = v_record.asset_id
        and a.owner_id = auth.uid()
    )
    or (
      v_context.asset_id is not null
      and v_context.organization_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), v_context.organization_id)
      and (
        exists (
          select 1
          from public.asset_relationship_record_contributions c
          where (c.service_record_id = v_record.id or c.accepted_service_record_id = v_record.id)
            and c.organization_id = v_context.organization_id
            and c.status in ('shared', 'pending', 'accepted')
        )
      )
    )
  ) then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'placement_id', ap.id,
    'attachment_id', att.id,
    'kind', att.kind,
    'title', att.title,
    'file_name', att.file_name,
    'mime_type', att.mime_type,
    'bucket', att.bucket,
    'storage_path', att.storage_path,
    'url', att.url,
    'role', ap.role,
    'label', ap.label,
    'created_at', ap.created_at
  ) order by ap.created_at desc), '[]'::jsonb)
  into v_files
  from public.attachment_placements ap
  join public.attachments att on att.id = ap.attachment_id and att.deleted_at is null
  where ap.target_type = 'service_record'
    and ap.target_id = v_record.id;

  return jsonb_build_object(
    'record', to_jsonb(v_record),
    'attachments', v_files
  );
end;
$$;

grant execute on function public.keeprspace_resolve_asset_relationship_context(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.share_asset_record_to_relationship(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.create_relationship_record_contribution(uuid, uuid, uuid, uuid, text, text, date, numeric, text, jsonb) to authenticated;
grant execute on function public.list_relationship_shared_history(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.list_my_relationship_record_contributions() to authenticated;
grant execute on function public.accept_relationship_record_contribution(uuid) to authenticated;
grant execute on function public.dismiss_relationship_record_contribution(uuid) to authenticated;
grant execute on function public.get_relationship_service_record(uuid, uuid, uuid, uuid, uuid) to authenticated;

commit;
