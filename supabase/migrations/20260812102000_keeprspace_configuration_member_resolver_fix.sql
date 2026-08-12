-- KeeprSpace Configuration member resolver compatibility.
-- The canonical org_members table is a join table keyed by org_id/user_id.

create or replace function public.get_keeprspace_org_config(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org public.orgs;
  v_keepr_pro public.keepr_pros;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if not (
    public.keeprspace_user_is_org_member(auth.uid(), p_organization_id)
    or public.keeprspace_user_can_seed_org(auth.uid())
  ) then
    raise exception 'not authorized to read this organization configuration';
  end if;

  select *
  into v_org
  from public.orgs
  where id = p_organization_id;

  if v_org.id is null then
    raise exception 'organization not found';
  end if;

  select *
  into v_keepr_pro
  from public.keepr_pros
  where organization_id = p_organization_id
  order by created_at asc nulls last
  limit 1;

  return jsonb_build_object(
    'organization', to_jsonb(v_org),
    'keepr_pro', case when v_keepr_pro.id is null then null else to_jsonb(v_keepr_pro) end,
    'can_manage', public.keeprspace_user_can_manage_org(auth.uid(), p_organization_id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.org_id::text || ':' || m.user_id::text,
        'user_id', m.user_id,
        'org_id', m.org_id,
        'role', coalesce(m.role, m.member_role, 'member'),
        'status', coalesce(m.status, 'active'),
        'joined_at', m.joined_at,
        'profile', jsonb_build_object(
          'id', p.id,
          'email', p.email,
          'full_name', coalesce(p.full_name, p.email)
        )
      ) order by coalesce(p.full_name, p.email))
      from public.org_members m
      left join public.profiles p on p.id = m.user_id
      where m.org_id = p_organization_id
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(to_jsonb(l) order by coalesce(l.name, l.city, l.address_line1))
      from public.org_locations l
      where l.organization_id = p_organization_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.name)
      from public.org_teams t
      where t.organization_id = p_organization_id
    ), '[]'::jsonb),
    'member_assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'organization_id', a.organization_id,
        'user_id', a.user_id,
        'org_team_id', a.org_team_id,
        'org_location_id', a.org_location_id,
        'assignment_role', a.assignment_role,
        'is_primary', a.is_primary,
        'status', a.status,
        'authority_state', a.authority_state,
        'member_name', coalesce(p.full_name, p.email),
        'member_email', p.email,
        'team_name', t.name,
        'location_name', l.name
      ) order by coalesce(p.full_name, p.email), t.name, l.name)
      from public.org_member_assignments a
      left join public.profiles p on p.id = a.user_id
      left join public.org_teams t on t.id = a.org_team_id
      left join public.org_locations l on l.id = a.org_location_id
      where a.organization_id = p_organization_id
    ), '[]'::jsonb),
    'service_offerings', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.name)
      from public.org_service_offerings s
      where s.organization_id = p_organization_id
    ), '[]'::jsonb),
    'brand_relationships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'from_org_id', r.from_org_id,
        'to_org_id', r.to_org_id,
        'relationship_type', r.relationship_type,
        'status', r.status,
        'evidence_state', r.evidence_state,
        'authority_state', r.authority_state,
        'source_type', r.metadata ->> 'source_type',
        'source_name', r.source_name,
        'source_url', r.source_url,
        'metadata', r.metadata,
        'org', jsonb_build_object(
          'id', o.id,
          'name', coalesce(o.display_name, o.name),
          'slug', o.slug,
          'organization_type', o.organization_type,
          'authority_state', o.authority_state
        )
      ) order by coalesce(o.display_name, o.name))
      from public.org_relationships r
      join public.orgs o on o.id = r.to_org_id
      where r.from_org_id = p_organization_id
        and r.relationship_type in ('represented_brand', 'brand_reference', 'authorized_dealer', 'dealer_network_member', 'oem_partner', 'service_partner', 'sales_partner', 'marina_partner')
    ), '[]'::jsonb)
  );
end;
$$;
