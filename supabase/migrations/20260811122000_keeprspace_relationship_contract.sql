-- KeeprSpace relationship contract hardening.
-- One boat. One relationship graph. Multiple operating views.

alter table public.asset_relationships
  drop constraint if exists asset_relationships_type_check;

alter table public.asset_relationships
  add constraint asset_relationships_type_check
  check (
    relationship_type in (
      'owner',
      'steward',
      'oem',
      'selling_dealer',
      'delivery_dealer',
      'servicing_dealer',
      'service_provider',
      'stewardship_provider',
      'storage_provider'
    )
  );

alter table public.asset_relationships
  drop constraint if exists asset_relationships_status_check;

alter table public.asset_relationships
  add constraint asset_relationships_status_check
  check (
    status in (
      'invited',
      'pending',
      'active',
      'paused',
      'ended',
      'revoked',
      'expired',
      'unclaimed',
      'claimed'
    )
  );

alter table public.asset_relationships
  drop constraint if exists asset_relationships_access_scope_check;

alter table public.asset_relationships
  add constraint asset_relationships_access_scope_check
  check (
    access_scope in (
      'none',
      'public_context',
      'service_workspace',
      'service_stewardship',
      'stewardship_workspace',
      'storage_workspace',
      'dealer_sales_workspace',
      'dealer_delivery_workspace',
      'transfer_workspace',
      'oem_context',
      'owner_full'
    )
  );

alter table public.asset_provider_stewardships
  drop constraint if exists asset_provider_stewardships_scope_check;

alter table public.asset_provider_stewardships
  add constraint asset_provider_stewardships_scope_check
  check (access_scope in ('service_stewardship', 'stewardship_workspace', 'storage_workspace'));

alter table public.asset_provider_stewardships
  drop constraint if exists asset_provider_stewardships_relationship_check;

alter table public.asset_provider_stewardships
  add constraint asset_provider_stewardships_relationship_check
  check (relationship_type in ('servicing_dealer', 'service_provider', 'stewardship_provider', 'storage_provider'));

alter table public.asset_provider_stewardships
  drop constraint if exists asset_provider_stewardships_status_check;

alter table public.asset_provider_stewardships
  add constraint asset_provider_stewardships_status_check
  check (status in ('invited', 'active', 'pending', 'paused', 'ended', 'revoked', 'expired'));

create index if not exists asset_relationships_user_status_idx
  on public.asset_relationships (user_id, status)
  where user_id is not null;

create index if not exists asset_relationships_metadata_stewardship_idx
  on public.asset_relationships ((metadata ->> 'compatibility_stewardship_id'))
  where metadata ? 'compatibility_stewardship_id';

create or replace function public.keeprspace_default_access_scope(p_relationship_type text)
returns text
language sql
immutable
as $$
  select case
    when p_relationship_type = 'owner' then 'owner_full'
    when p_relationship_type in ('servicing_dealer', 'service_provider') then 'service_workspace'
    when p_relationship_type = 'stewardship_provider' then 'stewardship_workspace'
    when p_relationship_type = 'storage_provider' then 'storage_workspace'
    when p_relationship_type = 'selling_dealer' then 'dealer_sales_workspace'
    when p_relationship_type = 'delivery_dealer' then 'dealer_delivery_workspace'
    when p_relationship_type = 'oem' then 'oem_context'
    else 'public_context'
  end;
$$;

create or replace function public.keeprspace_relationship_purpose(p_relationship_type text)
returns text
language sql
immutable
as $$
  select case
    when p_relationship_type = 'owner' then 'ownership'
    when p_relationship_type in ('servicing_dealer', 'service_provider') then 'service'
    when p_relationship_type = 'stewardship_provider' then 'stewardship'
    when p_relationship_type = 'storage_provider' then 'storage'
    when p_relationship_type = 'selling_dealer' then 'sales'
    when p_relationship_type = 'delivery_dealer' then 'delivery'
    when p_relationship_type = 'oem' then 'manufacturer'
    else replace(coalesce(p_relationship_type, 'relationship'), '_', ' ')
  end;
$$;

create or replace function public.keeprspace_user_can_view_asset_relationship(
  p_user_id uuid,
  p_relationship_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.asset_relationships ar
    join public.assets a
      on a.id = ar.asset_id
    where ar.id = p_relationship_id
      and coalesce(a.deleted_at is null, true)
      and (
        a.owner_id = p_user_id
        or ar.user_id = p_user_id
        or public.activator_user_can_read_asset(p_user_id, ar.asset_id)
        or (
          ar.organization_id is not null
          and public.activator_user_can_act_for_org(p_user_id, ar.organization_id)
        )
      )
  );
$$;

create or replace function public.keeprspace_user_can_manage_asset_relationship(
  p_user_id uuid,
  p_relationship_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.asset_relationships ar
    join public.assets a
      on a.id = ar.asset_id
    where ar.id = p_relationship_id
      and coalesce(a.deleted_at is null, true)
      and (
        a.owner_id = p_user_id
        or public.activator_user_can_manage_asset(p_user_id, ar.asset_id)
        or (
          ar.organization_id is not null
          and public.activator_user_can_act_for_org(p_user_id, ar.organization_id)
        )
      )
  );
$$;

drop policy if exists "Asset readers read relationships" on public.asset_relationships;
create policy "Asset readers and relationship participants read relationships"
  on public.asset_relationships
  for select
  to authenticated
  using (
    public.activator_user_can_read_asset(auth.uid(), asset_id)
    or user_id = auth.uid()
    or (
      organization_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), organization_id)
    )
  );

insert into public.asset_relationships (
  asset_id,
  user_id,
  relationship_type,
  status,
  access_scope,
  claim_state,
  effective_from,
  initiated_by_user_id,
  metadata
)
select
  a.id,
  a.owner_id,
  'owner',
  'active',
  'owner_full',
  'accepted',
  coalesce(a.created_at, now()),
  a.owner_id,
  jsonb_build_object('source', 'assets.owner_id_backfill')
from public.assets a
where a.owner_id is not null
  and coalesce(a.deleted_at is null, true)
on conflict do nothing;

insert into public.asset_relationships (
  asset_id,
  organization_id,
  keepr_pro_id,
  relationship_type,
  status,
  access_scope,
  claim_state,
  effective_from,
  effective_to,
  initiated_by_user_id,
  initiated_by_org_id,
  metadata
)
select
  aps.asset_id,
  aps.organization_id,
  aps.keepr_pro_id,
  aps.relationship_type,
  case
    when aps.status in ('active', 'pending', 'invited', 'paused', 'ended', 'revoked', 'expired') then aps.status
    else 'active'
  end,
  case
    when aps.access_scope = 'service_stewardship' then 'service_workspace'
    else public.keeprspace_default_access_scope(aps.relationship_type)
  end,
  case when aps.status = 'pending' then 'invited' else 'claimed_org' end,
  coalesce(aps.starts_at, aps.created_at, now()),
  aps.ends_at,
  aps.created_by,
  aps.organization_id,
  jsonb_build_object(
    'source', 'asset_provider_stewardships_backfill',
    'relationship_purpose', public.keeprspace_relationship_purpose(aps.relationship_type),
    'compatibility_stewardship_id', aps.id,
    'compatibility_access_scope', aps.access_scope
  )
from public.asset_provider_stewardships aps
on conflict do nothing;

create or replace function public.ensure_asset_relationship(
  p_asset_id uuid,
  p_relationship_type text,
  p_organization_id uuid default null,
  p_keepr_pro_id uuid default null,
  p_user_id uuid default null,
  p_status text default 'active',
  p_access_scope text default null,
  p_initiated_by_org_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets;
  v_relationship public.asset_relationships;
  v_stewardship public.asset_provider_stewardships;
  v_keepr_pro_id uuid := p_keepr_pro_id;
  v_access_scope text := coalesce(nullif(p_access_scope, ''), public.keeprspace_default_access_scope(p_relationship_type));
  v_status text := coalesce(nullif(p_status, ''), 'active');
  v_claim_state text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_organization_id is null and p_user_id is null and v_keepr_pro_id is null then
    raise exception 'Relationship requires an organization, KeeprPro, or user';
  end if;

  select *
  into v_asset
  from public.assets
  where id = p_asset_id
    and coalesce(deleted_at is null, true)
  limit 1;

  if v_asset.id is null then
    raise exception 'Asset not found';
  end if;

  if not (
    v_asset.owner_id = auth.uid()
    or public.activator_user_can_manage_asset(auth.uid(), v_asset.id)
    or (
      p_user_id = auth.uid()
      and p_relationship_type = 'owner'
    )
    or (
      p_organization_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), p_organization_id)
    )
    or (
      p_initiated_by_org_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), p_initiated_by_org_id)
    )
  ) then
    raise exception 'Not authorized to create this relationship';
  end if;

  if p_organization_id is not null and v_keepr_pro_id is null then
    select kp.id
    into v_keepr_pro_id
    from public.keepr_pros kp
    where kp.organization_id = p_organization_id
    order by kp.created_at asc nulls last
    limit 1;
  end if;

  if p_relationship_type in ('servicing_dealer', 'service_provider') and p_organization_id is not null and v_keepr_pro_id is not null and v_asset.owner_id is not null then
    insert into public.asset_provider_stewardships (
      asset_id,
      keepr_pro_id,
      organization_id,
      owner_id,
      relationship_type,
      access_scope,
      status,
      created_by,
      created_at,
      updated_at
    )
    values (
      v_asset.id,
      v_keepr_pro_id,
      p_organization_id,
      v_asset.owner_id,
      p_relationship_type,
      'service_stewardship',
      case when v_status in ('active', 'pending', 'invited', 'paused', 'ended', 'revoked', 'expired') then v_status else 'active' end,
      auth.uid(),
      now(),
      now()
    )
    on conflict do nothing;

    select *
    into v_stewardship
    from public.asset_provider_stewardships
    where asset_id = v_asset.id
      and keepr_pro_id = v_keepr_pro_id
      and organization_id = p_organization_id
      and relationship_type = p_relationship_type
      and status in ('active', 'pending', 'invited', 'paused')
    order by created_at desc
    limit 1;
  end if;

  if p_user_id is not null then
    select *
    into v_relationship
    from public.asset_relationships
    where asset_id = v_asset.id
      and user_id = p_user_id
      and relationship_type = p_relationship_type
      and status in ('active', 'pending', 'invited', 'paused')
    order by
      case status when 'active' then 0 when 'invited' then 1 when 'pending' then 2 else 3 end,
      created_at desc
    limit 1;
  else
    select *
    into v_relationship
    from public.asset_relationships
    where asset_id = v_asset.id
      and (
        (p_organization_id is not null and organization_id = p_organization_id)
        or (p_organization_id is null and v_keepr_pro_id is not null and keepr_pro_id = v_keepr_pro_id)
      )
      and relationship_type = p_relationship_type
      and status in ('active', 'pending', 'invited', 'paused')
    order by
      case status when 'active' then 0 when 'invited' then 1 when 'pending' then 2 else 3 end,
      created_at desc
    limit 1;
  end if;

  if v_relationship.id is null then
    v_claim_state := case
      when p_user_id is not null and p_user_id <> auth.uid() then 'invited'
      when p_organization_id is not null then 'claimed_org'
      when p_user_id is not null then 'accepted'
      else 'not_applicable'
    end;

    insert into public.asset_relationships (
      asset_id,
      organization_id,
      keepr_pro_id,
      user_id,
      relationship_type,
      status,
      access_scope,
      claim_state,
      initiated_by_user_id,
      initiated_by_org_id,
      metadata
    )
    values (
      v_asset.id,
      p_organization_id,
      v_keepr_pro_id,
      p_user_id,
      p_relationship_type,
      v_status,
      v_access_scope,
      v_claim_state,
      auth.uid(),
      p_initiated_by_org_id,
      coalesce(p_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'source', coalesce(nullif(p_metadata ->> 'source', ''), 'ensure_asset_relationship'),
          'relationship_purpose', public.keeprspace_relationship_purpose(p_relationship_type)
        )
        || case
          when v_stewardship.id is not null then jsonb_build_object('compatibility_stewardship_id', v_stewardship.id)
          else '{}'::jsonb
        end
    )
    returning * into v_relationship;
  elsif coalesce(p_metadata, '{}'::jsonb) <> '{}'::jsonb or v_stewardship.id is not null then
    update public.asset_relationships
    set
      metadata = coalesce(metadata, '{}'::jsonb)
        || coalesce(p_metadata, '{}'::jsonb)
        || case
          when v_stewardship.id is not null then jsonb_build_object('compatibility_stewardship_id', v_stewardship.id)
          else '{}'::jsonb
        end,
      updated_at = now()
    where id = v_relationship.id
    returning * into v_relationship;
  end if;

  return jsonb_build_object(
    'asset_relationship_id', v_relationship.id,
    'asset_id', v_relationship.asset_id,
    'organization_id', v_relationship.organization_id,
    'keepr_pro_id', v_relationship.keepr_pro_id,
    'user_id', v_relationship.user_id,
    'relationship_type', v_relationship.relationship_type,
    'relationship_purpose', public.keeprspace_relationship_purpose(v_relationship.relationship_type),
    'status', v_relationship.status,
    'access_scope', v_relationship.access_scope,
    'initiated_by_user_id', v_relationship.initiated_by_user_id,
    'initiated_by_org_id', v_relationship.initiated_by_org_id,
    'initiated_at', v_relationship.created_at,
    'compatibility_stewardship_id', nullif(v_relationship.metadata ->> 'compatibility_stewardship_id', '')::uuid
  );
end;
$$;

grant execute on function public.ensure_asset_relationship(uuid, text, uuid, uuid, uuid, text, text, uuid, jsonb) to authenticated;

create or replace function public.resolve_asset_relationship_workspace(
  p_asset_id uuid,
  p_organization_id uuid default null,
  p_relationship_id uuid default null,
  p_action_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_asset record;
  v_owner record;
  v_provider record;
  v_action record;
  v_thread record;
  v_thread_messages jsonb := '[]'::jsonb;
  v_files jsonb := '[]'::jsonb;
  v_systems jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_open_action_count integer := 0;
begin
  if auth.uid() is null then
    return null;
  end if;

  select
    a.id,
    a.name,
    a.type,
    a.kac_id,
    a.owner_id,
    a.year,
    a.make,
    a.model,
    a.length_feet,
    a.engine_type,
    a.engine_hours,
    a.hero_placement_id,
    a.extra_metadata
  into v_asset
  from public.assets a
  where a.id = p_asset_id
    and coalesce(a.deleted_at is null, true)
  limit 1;

  if v_asset.id is null then
    return null;
  end if;

  select
    owner_ar.id as relationship_id,
    p.id as user_id,
    coalesce(nullif(p.display_name, ''), nullif(p.full_name, ''), p.email, 'Owner') as display_name,
    p.email,
    coalesce(owner_ar.status, 'active') as status,
    coalesce(owner_ar.access_scope, 'owner_full') as access_scope
  into v_owner
  from public.profiles p
  left join public.asset_relationships owner_ar
    on owner_ar.asset_id = v_asset.id
   and owner_ar.user_id = p.id
   and owner_ar.relationship_type = 'owner'
   and owner_ar.status in ('active', 'pending', 'invited', 'paused')
  where p.id = v_asset.owner_id
  limit 1;

  if p_relationship_id is not null then
    select
      ar.*,
      coalesce(nullif(o.display_name, ''), nullif(o.name, ''), nullif(kp.display_name, ''), kp.name, 'Organization') as organization_name,
      o.slug as organization_slug,
      coalesce(nullif(kp.display_name, ''), nullif(kp.name, ''), nullif(o.display_name, ''), o.name) as keepr_pro_name,
      kp.slug as keepr_pro_slug,
      nullif(ar.metadata ->> 'compatibility_stewardship_id', '')::uuid as stewardship_id
    into v_provider
    from public.asset_relationships ar
    left join public.orgs o
      on o.id = ar.organization_id
    left join public.keepr_pros kp
      on kp.id = ar.keepr_pro_id
    where ar.id = p_relationship_id
      and ar.asset_id = v_asset.id
    limit 1;
  else
    select
      ar.*,
      coalesce(nullif(o.display_name, ''), nullif(o.name, ''), nullif(kp.display_name, ''), kp.name, 'Organization') as organization_name,
      o.slug as organization_slug,
      coalesce(nullif(kp.display_name, ''), nullif(kp.name, ''), nullif(o.display_name, ''), o.name) as keepr_pro_name,
      kp.slug as keepr_pro_slug,
      nullif(ar.metadata ->> 'compatibility_stewardship_id', '')::uuid as stewardship_id
    into v_provider
    from public.asset_relationships ar
    left join public.orgs o
      on o.id = ar.organization_id
    left join public.keepr_pros kp
      on kp.id = ar.keepr_pro_id
    where ar.asset_id = v_asset.id
      and ar.status in ('active', 'pending', 'invited', 'paused')
      and ar.relationship_type <> 'owner'
      and (p_organization_id is null or ar.organization_id = p_organization_id)
    order by
      case
        when p_organization_id is not null and ar.organization_id = p_organization_id then 0
        when ar.relationship_type in ('servicing_dealer', 'service_provider') then 1
        when ar.relationship_type in ('delivery_dealer', 'selling_dealer') then 2
        else 3
      end,
      ar.created_at desc
    limit 1;
  end if;

  if not (
    v_asset.owner_id = auth.uid()
    or public.activator_user_can_read_asset(auth.uid(), v_asset.id)
    or (v_provider.user_id is not null and v_provider.user_id = auth.uid())
    or (
      v_provider.organization_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), v_provider.organization_id)
    )
  ) then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'system_type', s.system_type,
        'status', s.status,
        'lifecycle_status', s.lifecycle_status,
        'last_service_date', s.last_service_date,
        'next_service_date', s.next_service_date
      )
      order by s.name
    ),
    '[]'::jsonb
  )
  into v_systems
  from public.systems s
  where s.asset_id = v_asset.id;

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
        'cost', sr.cost
      )
      order by sr.performed_at desc nulls last, sr.created_at desc
    ),
    '[]'::jsonb
  )
  into v_history
  from public.service_records sr
  where sr.asset_id = v_asset.id
    and (
      v_asset.owner_id = auth.uid()
      or v_provider.keepr_pro_id is null
      or sr.keepr_pro_id = v_provider.keepr_pro_id
    );

  select count(*)
  into v_open_action_count
  from public.reminders r
  where r.asset_id = v_asset.id
    and coalesce(r.status, 'open') not in ('completed', 'deleted', 'archived')
    and (
      v_asset.owner_id = auth.uid()
      or v_provider.keepr_pro_id is null
      or r.preferred_provider_id = v_provider.keepr_pro_id
      or r.extra_metadata #>> '{provider_target,id}' = v_provider.keepr_pro_id::text
      or r.extra_metadata #>> '{provider_target,organization_id}' = v_provider.organization_id::text
    );

  select r.*, s.name as system_name
  into v_action
  from public.reminders r
  left join public.systems s
    on s.id = r.system_id
  where r.asset_id = v_asset.id
    and coalesce(r.status, 'open') not in ('deleted', 'archived')
    and (p_action_id is null or r.id = p_action_id)
    and (
      v_asset.owner_id = auth.uid()
      or v_provider.keepr_pro_id is null
      or r.preferred_provider_id = v_provider.keepr_pro_id
      or r.extra_metadata #>> '{provider_target,id}' = v_provider.keepr_pro_id::text
      or r.extra_metadata #>> '{provider_target,organization_id}' = v_provider.organization_id::text
    )
  order by
    case when r.id = p_action_id then 0 else 1 end,
    case when coalesce(r.status, 'open') = 'completed' then 1 else 0 end,
    r.due_at asc nulls last,
    r.created_at desc
  limit 1;

  select t.*
  into v_thread
  from public.asset_threads t
  where t.asset_id = v_asset.id
    and (
      v_provider.keepr_pro_id is null
      or t.keepr_pro_id = v_provider.keepr_pro_id
      or t.resource_ref #>> '{relationship,asset_relationship_id}' = v_provider.id::text
      or t.resource_ref #>> '{relationship,compatibility_stewardship_id}' = v_provider.stewardship_id::text
      or t.resource_ref #>> '{message_link,intended_recipient,source_type}' = 'keepr_pro'
    )
  order by t.updated_at desc
  limit 1;

  if v_thread.id is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'body', m.body,
          'created_at', m.created_at,
          'sender_type', m.sender_type,
          'sender_name', m.sender_name,
          'from_user_id', m.from_user_id
        )
        order by m.created_at asc
      ),
      '[]'::jsonb
    )
    into v_thread_messages
    from public.asset_thread_messages m
    where m.thread_id = v_thread.id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'placement_id', picked.placement_id,
        'attachment_id', picked.attachment_id,
        'kind', picked.kind,
        'title', picked.title,
        'file_name', picked.file_name,
        'mime_type', picked.mime_type,
        'bucket', picked.bucket,
        'storage_path', picked.storage_path,
        'url', picked.url,
        'role', picked.role,
        'label', picked.label,
        'created_at', picked.created_at
      )
      order by picked.created_at desc
    ),
    '[]'::jsonb
  )
  into v_files
  from (
    select distinct on (att.id)
      ap.id as placement_id,
      att.id as attachment_id,
      att.kind,
      att.title,
      att.file_name,
      att.mime_type,
      att.bucket,
      att.storage_path,
      att.url,
      ap.role,
      ap.label,
      ap.created_at
    from public.attachment_placements ap
    join public.attachments att
      on att.id = ap.attachment_id
     and att.deleted_at is null
    where (
      (ap.target_type = 'asset' and ap.target_id = v_asset.id and ap.role in ('relationship_shared', 'message_shared'))
      or (v_provider.stewardship_id is not null and ap.target_type = 'asset_provider_stewardship' and ap.target_id = v_provider.stewardship_id)
      or (v_action.id is not null and ap.target_type = 'reminder' and ap.target_id = v_action.id)
      or (v_thread.id is not null and ap.target_type = 'asset_thread' and ap.target_id = v_thread.id)
      or (
        v_thread.id is not null
        and ap.target_type = 'asset_thread_message'
        and exists (
          select 1
          from public.asset_thread_messages m
          where m.id = ap.target_id
            and m.thread_id = v_thread.id
        )
      )
    )
    order by att.id, ap.created_at desc
  ) picked;

  return jsonb_build_object(
    'asset',
    jsonb_build_object(
      'id', v_asset.id,
      'name', v_asset.name,
      'type', v_asset.type,
      'kac_id', v_asset.kac_id,
      'year', v_asset.year,
      'make', v_asset.make,
      'model', v_asset.model,
      'length_feet', v_asset.length_feet,
      'engine_type', v_asset.engine_type,
      'engine_hours', v_asset.engine_hours,
      'hero_placement_id', v_asset.hero_placement_id
    ),
    'owner',
    jsonb_build_object(
      'relationship_id', v_owner.relationship_id,
      'user_id', v_owner.user_id,
      'display_name', v_owner.display_name,
      'email', v_owner.email,
      'status', v_owner.status,
      'access_scope', v_owner.access_scope
    ),
    'relationship',
    case
      when v_provider.id is null then null
      else jsonb_build_object(
        'id', v_provider.id,
        'relationship_type', v_provider.relationship_type,
        'relationship_purpose', public.keeprspace_relationship_purpose(v_provider.relationship_type),
        'status', v_provider.status,
        'access_scope', v_provider.access_scope,
        'claim_state', v_provider.claim_state,
        'organization_id', v_provider.organization_id,
        'organization_name', v_provider.organization_name,
        'organization_slug', v_provider.organization_slug,
        'keepr_pro_id', v_provider.keepr_pro_id,
        'keepr_pro_name', v_provider.keepr_pro_name,
        'keepr_pro_slug', v_provider.keepr_pro_slug,
        'compatibility_stewardship_id', v_provider.stewardship_id,
        'initiated_by_user_id', v_provider.initiated_by_user_id,
        'initiated_by_org_id', v_provider.initiated_by_org_id,
        'initiated_at', v_provider.created_at,
        'effective_from', v_provider.effective_from,
        'effective_to', v_provider.effective_to
      )
    end,
    'operating_state',
    jsonb_build_object(
      'current_stage', coalesce(v_action.extra_metadata #>> '{service_state,status}', case when v_action.id is null then 'No active service request' else coalesce(v_action.status, 'open') end),
      'waiting_on', coalesce(v_action.extra_metadata #>> '{service_state,waiting_on}', 'No one'),
      'next_step', coalesce(v_action.extra_metadata #>> '{service_state,next_step}', case when v_action.id is null then 'No active work is waiting.' else v_action.title end),
      'target_date', v_action.due_at,
      'last_activity_at', coalesce(v_action.updated_at, v_action.created_at)
    ),
    'current_action',
    case
      when v_action.id is null then null
      else jsonb_build_object(
        'id', v_action.id,
        'title', v_action.title,
        'status', coalesce(v_action.status, 'open'),
        'due_at', v_action.due_at,
        'notes', v_action.notes,
        'system_id', v_action.system_id,
        'system_name', v_action.system_name,
        'provider_response', coalesce(v_action.extra_metadata -> 'provider_response', '{}'::jsonb),
        'responsible_party', v_action.extra_metadata -> 'responsible_party',
        'created_at', v_action.created_at,
        'updated_at', v_action.updated_at
      )
    end,
    'systems', v_systems,
    'shared_history', v_history,
    'messages',
    case
      when v_thread.id is null then null
      else jsonb_build_object(
        'thread_id', v_thread.id,
        'subject', v_thread.subject,
        'status', v_thread.status,
        'updated_at', v_thread.updated_at,
        'messages', v_thread_messages
      )
    end,
    'files', v_files,
    'counts',
    jsonb_build_object(
      'systems', jsonb_array_length(v_systems),
      'history', jsonb_array_length(v_history),
      'files', jsonb_array_length(v_files),
      'open_actions', v_open_action_count
    ),
    'permitted_operations',
    jsonb_build_object(
      'view', true,
      'reply_to_thread', v_thread.id is not null,
      'add_file', v_provider.id is not null,
      'update_action_status', v_action.id is not null,
      'connect_provider', v_asset.owner_id = auth.uid(),
      'invite_owner', v_provider.organization_id is not null and public.activator_user_can_act_for_org(auth.uid(), v_provider.organization_id)
    )
  );
end;
$$;

grant execute on function public.resolve_asset_relationship_workspace(uuid, uuid, uuid, uuid) to authenticated;

comment on function public.ensure_asset_relationship(uuid, text, uuid, uuid, uuid, text, text, uuid, jsonb) is
  'Idempotently creates or returns one canonical asset relationship. Dealer-initiated and owner-initiated paths converge here.';

comment on function public.resolve_asset_relationship_workspace(uuid, uuid, uuid, uuid) is
  'Canonical relationship workspace projection. History stays on the boat; access and current context are resolved through asset_relationships.';
