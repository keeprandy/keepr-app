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
          'logo_url', coalesce(kp.logo_url, o.photo_url),
          'avatar_url', coalesce(kp.avatar_url, o.photo_url),
          'photo_url', o.photo_url,
          'header_image_url', coalesce(kp.header_image_url, o.team_photo_url),
          'team_photo_url', o.team_photo_url
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

grant execute on function public.get_my_workspaces() to authenticated;
