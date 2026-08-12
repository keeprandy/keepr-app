-- Generic Keepr workspace resolver.
-- Workspace type/capabilities shape navigation. Asset authorization remains
-- governed by owner/stewardship/asset_relationship rules.

alter table public.orgs
  add column if not exists workspace_type text,
  add column if not exists workspace_capabilities jsonb not null default '[]'::jsonb;

alter table public.org_members
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists orgs_workspace_type_idx
  on public.orgs (workspace_type)
  where workspace_type is not null;

create or replace function public.keepr_workspace_type_for_org(
  p_workspace_type text,
  p_organization_type text,
  p_org_type text
)
returns text
language sql
immutable
as $$
  select case lower(coalesce(nullif(p_workspace_type, ''), nullif(p_organization_type, ''), nullif(p_org_type, ''), ''))
    when 'keeproem' then 'keeproem'
    when 'oem' then 'keeproem'
    when 'manufacturer' then 'keeproem'
    when 'builder' then 'keeproem'
    when 'keeprdealer' then 'keeprdealer'
    when 'dealer' then 'keeprdealer'
    when 'keeprpro' then 'keeprpro'
    when 'provider' then 'keeprpro'
    when 'service_provider' then 'keeprpro'
    when 'personal' then 'keepr'
    else 'org'
  end;
$$;

create or replace function public.keepr_default_capabilities_for_workspace(
  p_workspace_type text
)
returns jsonb
language sql
immutable
as $$
  select case p_workspace_type
    when 'keeproem' then
      '["manufacturer","model_catalog","dealer_network","activation","as_built_context","asset_continuity"]'::jsonb
    when 'keeprdealer' then
      '["dealer","sales","delivery","service_provider","owner_activation","inventory_projection","oem_relationships"]'::jsonb
    when 'keeprpro' then
      '["service_provider","service_workspace","service_records","provider_messaging"]'::jsonb
    when 'keepr' then
      '["own_assets","manage_owner_care","authorize_relationships","transfer_prepare","owner_projection"]'::jsonb
    else
      '[]'::jsonb
  end;
$$;

create or replace function public.keepr_effective_workspace_capabilities(
  p_workspace_type text,
  p_configured jsonb
)
returns jsonb
language sql
immutable
as $$
  select (
    select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(p_configured, '[]'::jsonb)) = 'array'
          and jsonb_array_length(coalesce(p_configured, '[]'::jsonb)) > 0
        then coalesce(p_configured, '[]'::jsonb)
        else public.keepr_default_capabilities_for_workspace(p_workspace_type)
      end
    ) as capabilities(value)
  );
$$;

create or replace function public.get_my_workspaces()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_personal jsonb;
  v_org_workspaces jsonb;
  v_active_workspace_id text;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'active_workspace_id', null,
      'workspaces', '[]'::jsonb,
      'legacy_profile_role', null
    );
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.id = auth.uid()
  limit 1;

  v_personal := jsonb_build_object(
    'workspace_id', 'keepr:' || auth.uid()::text,
    'workspace_type', 'keepr',
    'label', 'Keepr',
    'display_name', coalesce(nullif(v_profile.display_name, ''), nullif(v_profile.full_name, ''), v_profile.email, 'My Keepr'),
    'description', 'Owner workspace',
    'capabilities', public.keepr_default_capabilities_for_workspace('keepr'),
    'authority', jsonb_build_object(
      'subject_type', 'profile',
      'profile_id', auth.uid(),
      'legacy_profile_role', coalesce(v_profile.role, 'consumer')
    ),
    'display', jsonb_build_object(
      'title', coalesce(nullif(v_profile.display_name, ''), nullif(v_profile.full_name, ''), 'My Keepr'),
      'subtitle', 'Owner workspace',
      'icon', 'person-outline'
    ),
    'metadata', jsonb_build_object(
      'source', 'profile',
      'is_personal_workspace', true
    )
  );

  select coalesce(jsonb_agg(workspace order by sort_order, workspace ->> 'display_name'), '[]'::jsonb)
  into v_org_workspaces
  from (
    select
      case type_scope.workspace_type
        when 'keeproem' then 10
        when 'keeprdealer' then 20
        when 'keeprpro' then 30
        else 90
      end as sort_order,
      jsonb_build_object(
        'workspace_id', 'org:' || o.id::text,
        'workspace_type', type_scope.workspace_type,
        'label', case type_scope.workspace_type
          when 'keeproem' then 'KeeprOEM'
          when 'keeprdealer' then 'KeeprDealer'
          when 'keeprpro' then 'KeeprPro'
          else 'Org'
        end,
        'organization_id', o.id,
        'organization_slug', o.slug,
        'display_name', coalesce(nullif(o.display_name, ''), nullif(o.name, ''), nullif(kp.display_name, ''), kp.name, 'Organization'),
        'description', case type_scope.workspace_type
          when 'keeproem' then 'Manufacturer workspace'
          when 'keeprdealer' then 'Dealer workspace'
          when 'keeprpro' then 'Service provider workspace'
          else 'Organization workspace'
        end,
        'capabilities', cap_scope.capabilities,
        'authority', jsonb_build_object(
          'subject_type', 'organization',
          'organization_id', o.id,
          'member_role', coalesce(m.role, m.member_role, 'member'),
          'member_status', coalesce(m.status, 'active'),
          'can_manage_workspace', coalesce(m.role, m.member_role, 'member') in ('owner', 'admin'),
          'demo_membership', coalesce((m.metadata ->> 'demo_membership')::boolean, false)
        ),
        'display', jsonb_build_object(
          'title', coalesce(nullif(o.display_name, ''), nullif(o.name, ''), nullif(kp.display_name, ''), kp.name, 'Organization'),
          'subtitle', case type_scope.workspace_type
            when 'keeproem' then 'KeeprOEM workspace'
            when 'keeprdealer' then 'KeeprDealer workspace'
            when 'keeprpro' then 'KeeprPro workspace'
            else 'Organization workspace'
          end,
          'icon', case type_scope.workspace_type
            when 'keeproem' then 'business-outline'
            when 'keeprdealer' then 'storefront-outline'
            when 'keeprpro' then 'briefcase-outline'
            else 'people-outline'
          end,
          'logo_url', kp.logo_url,
          'avatar_url', kp.avatar_url,
          'header_image_url', kp.header_image_url
        ),
        'metadata', jsonb_build_object(
          'source', 'org_members',
          'organization_type', o.organization_type,
          'org_type', o.org_type,
          'workspace_type_source', coalesce(nullif(o.workspace_type, ''), nullif(o.organization_type, ''), nullif(o.org_type, '')),
          'keepr_pro_id', kp.id,
          'keepr_pro_slug', kp.slug,
          'profile_status', kp.profile_status,
          'claimed_state', kp.claimed_state,
          'member_metadata', coalesce(m.metadata, '{}'::jsonb)
        )
      ) as workspace
    from public.org_members m
    join public.orgs o
      on o.id = m.org_id
    left join public.keepr_pros kp
      on kp.organization_id = o.id
    cross join lateral (
      select public.keepr_workspace_type_for_org(o.workspace_type, o.organization_type, o.org_type) as workspace_type
    ) type_scope
    cross join lateral (
      select public.keepr_effective_workspace_capabilities(
        type_scope.workspace_type,
        o.workspace_capabilities
      ) as capabilities
    ) cap_scope
    where m.user_id = auth.uid()
      and coalesce(m.status, 'active') = 'active'
      and coalesce(o.status, 'active') = 'active'
      and type_scope.workspace_type in ('keeproem', 'keeprdealer', 'keeprpro', 'org')
  ) resolved;

  select workspace ->> 'workspace_id'
  into v_active_workspace_id
  from jsonb_array_elements(coalesce(v_org_workspaces, '[]'::jsonb)) workspace
  where coalesce((workspace #>> '{authority,demo_membership}')::boolean, false) = true
  order by case workspace ->> 'workspace_type'
    when 'keeproem' then 10
    when 'keeprdealer' then 20
    when 'keeprpro' then 30
    else 90
  end
  limit 1;

  return jsonb_build_object(
    'active_workspace_id', coalesce(v_active_workspace_id, v_personal ->> 'workspace_id'),
    'workspaces', jsonb_build_array(v_personal) || coalesce(v_org_workspaces, '[]'::jsonb),
    'legacy_profile_role', coalesce(v_profile.role, 'consumer'),
    'resolved_at', now()
  );
end;
$$;

update public.orgs
set
  workspace_type = 'keeproem',
  workspace_capabilities = public.keepr_default_capabilities_for_workspace('keeproem')
where lower(slug) = 'tiara-yachts';

update public.orgs
set
  workspace_type = 'keeprdealer',
  workspace_capabilities = public.keepr_default_capabilities_for_workspace('keeprdealer')
where lower(slug) = 'skipperbuds';

update public.orgs
set
  workspace_type = coalesce(workspace_type, 'keeprpro'),
  workspace_capabilities = case
    when jsonb_typeof(workspace_capabilities) = 'array' and jsonb_array_length(workspace_capabilities) > 0
      then workspace_capabilities
    else public.keepr_default_capabilities_for_workspace('keeprpro')
  end
where lower(slug) = 'wilsonmarine';

grant execute on function public.keepr_workspace_type_for_org(text, text, text) to authenticated;
grant execute on function public.keepr_default_capabilities_for_workspace(text) to authenticated;
grant execute on function public.keepr_effective_workspace_capabilities(text, jsonb) to authenticated;
grant execute on function public.get_my_workspaces() to authenticated;

comment on function public.get_my_workspaces() is
  'Returns personal Keepr workspace plus authorized org workspaces with workspace_type/capabilities. Does not grant asset access.';

comment on column public.orgs.workspace_type is
  'Generic Keepr workspace type for navigation/tooling, e.g. keeproem, keeprdealer, keeprpro. Not an asset-access grant.';

comment on column public.orgs.workspace_capabilities is
  'Workspace/tooling capabilities for the org. Asset authorization remains relationship-driven.';
