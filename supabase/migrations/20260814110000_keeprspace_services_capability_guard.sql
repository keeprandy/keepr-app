-- Monday release guard: Services require manage_services, not broad org management.
-- This introduces a small org-scoped capability helper and grants Wilson only the
-- explicit capabilities needed for the Service -> Action happy path.

create or replace function public.keeprspace_role_implied_capabilities(p_role text)
returns text[]
language sql
stable
set search_path = public
as $$
  select case lower(coalesce(nullif(p_role, ''), 'member'))
    when 'organization_owner' then array[
      'manage_organization',
      'manage_members',
      'manage_services',
      'create_actions',
      'assign_actions',
      'view_all_relationships',
      'send_estimates',
      'approve_estimates',
      'schedule_work',
      'complete_service'
    ]
    when 'owner' then array[
      'manage_organization',
      'manage_members',
      'manage_services',
      'create_actions',
      'assign_actions',
      'view_all_relationships',
      'send_estimates',
      'approve_estimates',
      'schedule_work',
      'complete_service'
    ]
    when 'admin' then array[
      'manage_organization',
      'manage_members',
      'manage_services',
      'create_actions',
      'assign_actions',
      'view_all_relationships',
      'send_estimates',
      'schedule_work',
      'complete_service'
    ]
    when 'manager' then array[
      'manage_services',
      'create_actions',
      'assign_actions',
      'view_all_relationships',
      'send_estimates',
      'schedule_work',
      'complete_service'
    ]
    when 'service_manager' then array[
      'manage_services',
      'create_actions',
      'assign_actions',
      'view_all_relationships',
      'send_estimates',
      'schedule_work',
      'complete_service'
    ]
    when 'service_advisor' then array[
      'create_actions',
      'assign_actions',
      'view_all_relationships',
      'send_estimates',
      'schedule_work'
    ]
    when 'technician' then array[
      'view_assigned_relationships',
      'complete_service'
    ]
    when 'sales' then array[
      'create_actions',
      'view_all_relationships',
      'send_estimates'
    ]
    when 'read_only' then array[
      'view_assigned_relationships'
    ]
    else array[]::text[]
  end;
$$;

create or replace function public.keeprspace_user_has_org_capability(
  p_user_id uuid,
  p_org_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with active_membership as (
    select
      m.role,
      m.member_role,
      coalesce(m.metadata, '{}'::jsonb) as metadata
    from public.org_members m
    where m.user_id = p_user_id
      and m.org_id = p_org_id
      and coalesce(m.status, 'active') = 'active'
    limit 1
  ),
  explicit_capabilities as (
    select lower(value) as capability
    from active_membership am,
      jsonb_array_elements_text(
        case
          when jsonb_typeof(am.metadata -> 'capabilities') = 'array'
            then am.metadata -> 'capabilities'
          when jsonb_typeof(am.metadata -> 'keepr_capabilities') = 'array'
            then am.metadata -> 'keepr_capabilities'
          else '[]'::jsonb
        end
      ) value
  ),
  implied_capabilities as (
    select lower(unnest(public.keeprspace_role_implied_capabilities(coalesce(am.role, am.member_role)))) as capability
    from active_membership am
  )
  select auth.role() = 'service_role'
    or public.keeprspace_user_can_seed_org(p_user_id)
    or exists (
      select 1
      from public.orgs o
      where o.id = p_org_id
        and o.owner_user_id = p_user_id
    )
    or exists (
      select 1
      from explicit_capabilities c
      where c.capability = lower(p_capability)
    )
    or exists (
      select 1
      from implied_capabilities c
      where c.capability = lower(p_capability)
    );
$$;

drop policy if exists "Org admins manage service offerings" on public.org_service_offerings;
create policy "Org service managers manage service offerings"
  on public.org_service_offerings for all
  to authenticated
  using (public.keeprspace_user_has_org_capability(auth.uid(), organization_id, 'manage_services'))
  with check (public.keeprspace_user_has_org_capability(auth.uid(), organization_id, 'manage_services'));

create or replace function public.upsert_keeprspace_org_service_offering(
  p_organization_id uuid,
  p_service jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_id uuid;
  v_name text;
  v_slug text;
begin
  if not public.keeprspace_user_has_org_capability(auth.uid(), p_organization_id, 'manage_services') then
    raise exception 'not authorized to manage services for this organization';
  end if;

  v_service_id := nullif(p_service ->> 'id', '')::uuid;
  v_name := nullif(p_service ->> 'name', '');
  v_slug := coalesce(nullif(public.keeprspace_slugify(p_service ->> 'slug'), ''), public.keeprspace_slugify(v_name));

  if v_service_id is null then
    insert into public.org_service_offerings (
      organization_id, keepr_pro_id, name, slug, service_type, description,
      owner_facing_label, owner_facing_description, status, visibility,
      relationship_purposes, supported_asset_types, authority_state,
      source_type, source_name, source_url, metadata, created_by
    )
    values (
      p_organization_id,
      nullif(p_service ->> 'keepr_pro_id', '')::uuid,
      v_name,
      v_slug,
      nullif(p_service ->> 'service_type', ''),
      nullif(p_service ->> 'description', ''),
      coalesce(nullif(p_service ->> 'owner_facing_label', ''), v_name),
      nullif(p_service ->> 'owner_facing_description', ''),
      coalesce(nullif(p_service ->> 'status', ''), 'active'),
      coalesce(nullif(p_service ->> 'visibility', ''), 'owner_portal'),
      coalesce(public.keeprspace_jsonb_text_array(p_service -> 'relationship_purposes'), '{}'::text[]),
      coalesce(public.keeprspace_jsonb_text_array(p_service -> 'supported_asset_types'), '{}'::text[]),
      coalesce(nullif(p_service ->> 'authority_state', ''), 'org_managed'),
      nullif(p_service ->> 'source_type', ''),
      nullif(p_service ->> 'source_name', ''),
      nullif(p_service ->> 'source_url', ''),
      coalesce(p_service -> 'metadata', '{}'::jsonb),
      auth.uid()
    )
    on conflict (organization_id, (lower(slug))) do update
      set name = excluded.name,
          service_type = excluded.service_type,
          description = excluded.description,
          owner_facing_label = excluded.owner_facing_label,
          owner_facing_description = excluded.owner_facing_description,
          status = excluded.status,
          visibility = excluded.visibility,
          relationship_purposes = excluded.relationship_purposes,
          supported_asset_types = excluded.supported_asset_types,
          authority_state = excluded.authority_state,
          source_type = excluded.source_type,
          source_name = excluded.source_name,
          source_url = excluded.source_url,
          metadata = public.org_service_offerings.metadata || excluded.metadata,
          updated_at = now();
  else
    update public.org_service_offerings
    set
      name = coalesce(v_name, name),
      slug = coalesce(v_slug, slug),
      service_type = coalesce(nullif(p_service ->> 'service_type', ''), service_type),
      description = coalesce(nullif(p_service ->> 'description', ''), description),
      owner_facing_label = coalesce(nullif(p_service ->> 'owner_facing_label', ''), owner_facing_label),
      owner_facing_description = coalesce(nullif(p_service ->> 'owner_facing_description', ''), owner_facing_description),
      status = coalesce(nullif(p_service ->> 'status', ''), status),
      visibility = coalesce(nullif(p_service ->> 'visibility', ''), visibility),
      relationship_purposes = coalesce(public.keeprspace_jsonb_text_array(p_service -> 'relationship_purposes'), relationship_purposes),
      supported_asset_types = coalesce(public.keeprspace_jsonb_text_array(p_service -> 'supported_asset_types'), supported_asset_types),
      authority_state = coalesce(nullif(p_service ->> 'authority_state', ''), authority_state),
      source_type = coalesce(nullif(p_service ->> 'source_type', ''), source_type),
      source_name = coalesce(nullif(p_service ->> 'source_name', ''), source_name),
      source_url = coalesce(nullif(p_service ->> 'source_url', ''), source_url),
      metadata = metadata || coalesce(p_service -> 'metadata', '{}'::jsonb),
      updated_at = now()
    where id = v_service_id
      and organization_id = p_organization_id;
  end if;

  return public.get_keeprspace_org_config(p_organization_id);
end;
$$;

grant execute on function public.keeprspace_role_implied_capabilities(text) to authenticated;
grant execute on function public.keeprspace_user_has_org_capability(uuid, uuid, text) to authenticated;
grant execute on function public.upsert_keeprspace_org_service_offering(uuid, jsonb) to authenticated;

update public.org_members
set metadata = jsonb_set(
    coalesce(metadata, '{}'::jsonb),
    '{capabilities}',
    (
      select jsonb_agg(distinct capability order by capability)
      from (
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(coalesce(metadata, '{}'::jsonb) -> 'capabilities') = 'array'
              then coalesce(metadata, '{}'::jsonb) -> 'capabilities'
            else '[]'::jsonb
          end
        ) as capability
        union all
        select 'manage_services'
        union all
        select 'create_actions'
      ) caps
    ),
    true
  )
where org_id = '6ad2fe13-c1b5-40c7-bb2f-6d1c454e0a8d'::uuid
  and user_id = 'f79bc957-0769-42cd-b934-2213d33f1d89'::uuid
  and coalesce(status, 'active') = 'active';
