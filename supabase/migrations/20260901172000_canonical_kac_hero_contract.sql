-- Canonical KAC Hero contract.
--
-- Hero is a KAC/asset identity pointer, not a projection-local relationship
-- preference. Showcase/media can compose by viewer; assets.hero_placement_id is
-- the single selected Hero used by every projection.

create table if not exists public.asset_hero_audit_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_context jsonb not null default '{}'::jsonb,
  previous_hero_placement_id uuid references public.attachment_placements(id) on delete set null,
  new_hero_placement_id uuid references public.attachment_placements(id) on delete set null,
  action text not null,
  result text not null default 'success',
  created_at timestamptz not null default now(),
  constraint asset_hero_audit_events_action_check check (action in ('set', 'clear')),
  constraint asset_hero_audit_events_result_check check (result in ('success', 'denied', 'failed'))
);

create index if not exists asset_hero_audit_events_asset_created_idx
  on public.asset_hero_audit_events (asset_id, created_at desc);

alter table public.asset_hero_audit_events enable row level security;

drop policy if exists asset_hero_audit_events_asset_readers on public.asset_hero_audit_events;
create policy asset_hero_audit_events_asset_readers
  on public.asset_hero_audit_events
  for select
  using (
    public.is_keepr_internal_admin(auth.uid())
    or public.keepr_user_can_read_asset_shared_media(auth.uid(), asset_id)
  );

grant select on public.asset_hero_audit_events to authenticated;

create or replace function public.kac_hero_template_ids(p_asset_id uuid)
returns table(template_id uuid)
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select distinct b.template_id
  from public.asset_template_bindings b
  where b.asset_id = p_asset_id
    and b.binding_status in ('suggested', 'inherited', 'verified')

  union

  select distinct (a.extra_metadata ->> 'catalog_template_id')::uuid
  from public.assets a
  where a.id = p_asset_id
    and (a.extra_metadata ->> 'catalog_template_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

  union

  select distinct t.id
  from public.assets a
  join public.asset_model_templates t
    on lower(t.template_key) = lower(a.extra_metadata ->> 'catalog_template_key')
  where a.id = p_asset_id
    and nullif(a.extra_metadata ->> 'catalog_template_key', '') is not null;
$$;

grant execute on function public.kac_hero_template_ids(uuid) to authenticated;

create or replace function public.kac_hero_placement_is_valid(
  p_asset_id uuid,
  p_placement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.attachment_placements ap
    join public.attachments att
      on att.id = ap.attachment_id
     and att.deleted_at is null
    where ap.id = p_placement_id
      and (
        (ap.target_type = 'asset' and ap.target_id = p_asset_id)
        or (
          ap.target_type = 'model_template'
          and ap.target_id in (select template_id from public.kac_hero_template_ids(p_asset_id))
        )
      )
      and (
        att.kind = 'photo'
        or coalesce(att.mime_type, '') ilike 'image/%'
        or coalesce(att.file_name, att.storage_path, '') ~* '\.(jpe?g|png|webp|gif|heic|heif)$'
      )
  );
$$;

grant execute on function public.kac_hero_placement_is_valid(uuid, uuid) to authenticated;

create or replace function public.kac_has_active_owner(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.assets a
    where a.id = p_asset_id
      and a.owner_id is not null
  )
  or exists (
    select 1
    from public.asset_relationships ar
    where ar.asset_id = p_asset_id
      and ar.relationship_type = 'owner'
      and ar.status = 'active'
      and ar.access_scope = 'owner_full'
      and ar.claim_state = 'accepted'
      and ar.user_id is not null
      and (ar.effective_from is null or ar.effective_from <= now())
      and (ar.effective_to is null or ar.effective_to > now())
  );
$$;

grant execute on function public.kac_has_active_owner(uuid) to authenticated;

create or replace function public.kac_user_can_manage_hero(
  p_user_id uuid,
  p_asset_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p_user_id is not null and (
    public.is_keepr_internal_admin(p_user_id)
    or (
      public.kac_has_active_owner(p_asset_id)
      and exists (
        select 1
        from public.assets a
        where a.id = p_asset_id
          and a.owner_id = p_user_id
      )
    )
    or (
      public.kac_has_active_owner(p_asset_id)
      and exists (
        select 1
        from public.asset_relationships ar
        where ar.asset_id = p_asset_id
          and ar.relationship_type = 'owner'
          and ar.status = 'active'
          and ar.access_scope = 'owner_full'
          and ar.claim_state = 'accepted'
          and ar.user_id = p_user_id
          and (ar.effective_from is null or ar.effective_from <= now())
          and (ar.effective_to is null or ar.effective_to > now())
      )
    )
    or (
      not public.kac_has_active_owner(p_asset_id)
      and exists (
        select 1
        from public.asset_template_bindings b
        join public.asset_model_templates t on t.id = b.template_id
        where b.asset_id = p_asset_id
          and b.binding_status in ('suggested', 'inherited', 'verified')
          and public.activator_user_can_act_for_org(p_user_id, t.organization_id)
      )
    )
    or (
      not public.kac_has_active_owner(p_asset_id)
      and exists (
        select 1
        from public.asset_relationships ar
        where ar.asset_id = p_asset_id
          and ar.relationship_type in ('assigned_dealer', 'selling_dealer', 'delivery_dealer')
          and ar.status = 'active'
          and ar.organization_id is not null
          and (ar.effective_from is null or ar.effective_from <= now())
          and (ar.effective_to is null or ar.effective_to > now())
          and public.activator_user_can_act_for_org(p_user_id, ar.organization_id)
      )
    )
  );
$$;

grant execute on function public.kac_user_can_manage_hero(uuid, uuid) to authenticated;

drop function if exists public.set_asset_hero_placement(uuid, uuid);

create or replace function public.set_asset_hero_placement(
  p_asset_id uuid,
  p_placement_id uuid,
  p_actor_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_asset public.assets%rowtype;
  v_attachment_id uuid;
  v_previous_hero_placement_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_asset
  from public.assets
  where id = p_asset_id
    and deleted_at is null;

  if v_asset.id is null then
    raise exception 'Asset not found';
  end if;

  if not public.kac_hero_placement_is_valid(p_asset_id, p_placement_id) then
    raise exception 'Hero placement must belong to this KAC or its bound model template and point to an image attachment';
  end if;

  if not public.kac_user_can_manage_hero(v_user_id, p_asset_id) then
    insert into public.asset_hero_audit_events (
      asset_id,
      actor_user_id,
      actor_context,
      previous_hero_placement_id,
      new_hero_placement_id,
      action,
      result
    )
    values (
      p_asset_id,
      v_user_id,
      coalesce(p_actor_context, '{}'::jsonb),
      v_asset.hero_placement_id,
      p_placement_id,
      'set',
      'denied'
    );
    raise exception 'Not authorized to set this KAC hero';
  end if;

  select ap.attachment_id
    into v_attachment_id
  from public.attachment_placements ap
  where ap.id = p_placement_id;

  v_previous_hero_placement_id := v_asset.hero_placement_id;

  update public.assets
     set hero_placement_id = p_placement_id,
         hero_image_url = null,
         hero_thumb_url = null,
         hero_thumb_updated_at = now()
   where id = p_asset_id;

  insert into public.asset_hero_audit_events (
    asset_id,
    actor_user_id,
    actor_context,
    previous_hero_placement_id,
    new_hero_placement_id,
    action,
    result
  )
  values (
    p_asset_id,
    v_user_id,
    coalesce(p_actor_context, '{}'::jsonb),
    v_previous_hero_placement_id,
    p_placement_id,
    'set',
    'success'
  );

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'hero_placement_id', p_placement_id,
    'attachment_id', v_attachment_id
  );
end;
$$;

grant execute on function public.set_asset_hero_placement(uuid, uuid, jsonb) to authenticated;

create or replace function public.clear_asset_hero_placement(
  p_asset_id uuid,
  p_actor_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_asset public.assets%rowtype;
  v_previous_hero_placement_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_asset
  from public.assets
  where id = p_asset_id
    and deleted_at is null;

  if v_asset.id is null then
    raise exception 'Asset not found';
  end if;

  if not public.kac_user_can_manage_hero(v_user_id, p_asset_id) then
    insert into public.asset_hero_audit_events (
      asset_id,
      actor_user_id,
      actor_context,
      previous_hero_placement_id,
      new_hero_placement_id,
      action,
      result
    )
    values (
      p_asset_id,
      v_user_id,
      coalesce(p_actor_context, '{}'::jsonb),
      v_asset.hero_placement_id,
      null,
      'clear',
      'denied'
    );
    raise exception 'Not authorized to clear this KAC hero';
  end if;

  v_previous_hero_placement_id := v_asset.hero_placement_id;

  update public.assets
     set hero_placement_id = null,
         hero_thumb_updated_at = now()
   where id = p_asset_id;

  insert into public.asset_hero_audit_events (
    asset_id,
    actor_user_id,
    actor_context,
    previous_hero_placement_id,
    new_hero_placement_id,
    action,
    result
  )
  values (
    p_asset_id,
    v_user_id,
    coalesce(p_actor_context, '{}'::jsonb),
    v_previous_hero_placement_id,
    null,
    'clear',
    'success'
  );

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'hero_placement_id', null,
    'previous_hero_placement_id', v_previous_hero_placement_id
  );
end;
$$;

grant execute on function public.clear_asset_hero_placement(uuid, jsonb) to authenticated;

comment on table public.asset_hero_audit_events is
  'Immutable audit history for the canonical KAC Hero pointer on assets.hero_placement_id.';

comment on function public.set_asset_hero_placement(uuid, uuid, jsonb) is
  'Sets the single canonical KAC Hero pointer after validating exact-asset or bound-model placement and lifecycle authority. It does not mutate media placement metadata.';

comment on function public.clear_asset_hero_placement(uuid, jsonb) is
  'Clears the explicit canonical KAC Hero pointer so display-only fallback can resolve deterministically.';

create or replace function public.resolve_asset_shared_hero_media(
  p_asset_id uuid,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_asset public.assets%rowtype;
  v_media record;
begin
  if v_user_id is null then
    return null;
  end if;

  select *
    into v_asset
  from public.assets
  where id = p_asset_id
    and deleted_at is null;

  if v_asset.id is null then
    return null;
  end if;

  if p_organization_id is not null and not (
    exists (
      select 1
      from public.asset_relationships ar
      where ar.asset_id = p_asset_id
        and ar.organization_id = p_organization_id
        and ar.status = 'active'
        and ar.access_scope <> 'none'
        and (ar.effective_from is null or ar.effective_from <= now())
        and (ar.effective_to is null or ar.effective_to > now())
        and public.activator_user_can_act_for_org(v_user_id, ar.organization_id)
    )
    or exists (
      select 1
      from public.asset_provider_stewardships aps
      where aps.asset_id = p_asset_id
        and aps.organization_id = p_organization_id
        and aps.status = 'active'
        and aps.access_scope = 'service_stewardship'
        and (aps.starts_at is null or aps.starts_at <= now())
        and (aps.ends_at is null or aps.ends_at > now())
        and public.activator_user_can_act_for_org(v_user_id, aps.organization_id)
    )
  ) then
    return null;
  end if;

  if p_organization_id is null
     and not public.keepr_user_can_read_asset_shared_media(v_user_id, p_asset_id) then
    return null;
  end if;

  with candidates as (
    select
      ap.id as placement_id,
      ap.attachment_id,
      ap.role,
      ap.is_showcase,
      ap.sort_order,
      ap.created_at,
      att.bucket,
      att.storage_path,
      att.url,
      att.mime_type,
      att.kind,
      case
        when ap.id = v_asset.hero_placement_id then 300
        when ap.target_type = 'asset'
          and ap.target_id = p_asset_id
          and coalesce(ap.role, '') in ('primary', 'hero') then 120
        when ap.target_type = 'asset'
          and ap.target_id = p_asset_id
          and (ap.is_showcase = true or coalesce(ap.role, '') = 'showcase') then 100
        when ap.target_type = 'model_template'
          and ap.target_id in (select template_id from public.kac_hero_template_ids(p_asset_id))
          and coalesce(ap.role, '') in ('primary', 'hero') then 80
        when ap.target_type = 'model_template'
          and ap.target_id in (select template_id from public.kac_hero_template_ids(p_asset_id))
          and (ap.is_showcase = true or coalesce(ap.role, '') = 'showcase') then 60
        else 0
      end as rank
    from public.attachment_placements ap
    join public.attachments att
      on att.id = ap.attachment_id
     and att.deleted_at is null
    where (
        (ap.target_type = 'asset' and ap.target_id = p_asset_id)
        or (
          ap.target_type = 'model_template'
          and ap.target_id in (select template_id from public.kac_hero_template_ids(p_asset_id))
        )
      )
      and (
        att.kind = 'photo'
        or coalesce(att.mime_type, '') ilike 'image/%'
        or coalesce(att.file_name, att.storage_path, '') ~* '\.(jpe?g|png|webp|gif|heic|heif)$'
      )
      and (
        ap.id = v_asset.hero_placement_id
        or ap.is_showcase = true
        or coalesce(ap.role, '') in ('primary', 'hero', 'showcase')
      )
  )
  select *
    into v_media
  from candidates
  where rank > 0
  order by rank desc,
           sort_order asc nulls last,
           created_at desc
  limit 1;

  if v_media.placement_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'placement_id', v_media.placement_id,
    'attachment_id', v_media.attachment_id,
    'bucket', v_media.bucket,
    'storage_path', v_media.storage_path,
    'url', v_media.url,
    'role', v_media.role,
    'is_showcase', v_media.is_showcase
  );
end;
$$;

grant execute on function public.resolve_asset_shared_hero_media(uuid, uuid) to authenticated;
