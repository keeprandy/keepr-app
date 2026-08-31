-- Keepr Admin organization classification editing V1.
--
-- Classification describes what the organization is. Workspace type describes
-- which Keepr product surface it receives. This operation updates only the
-- former and leaves workspace_type/capabilities unchanged.

create or replace function public.update_keepr_admin_org_classification(
  p_organization_id uuid,
  p_organization_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_organization_type text := lower(coalesce(nullif(trim(coalesce(p_organization_type, '')), ''), 'org'));
  v_org_type text;
  v_previous public.orgs%rowtype;
  v_updated public.orgs%rowtype;
begin
  if not public.is_keepr_internal_admin(v_actor_user_id) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if v_organization_type not in ('oem', 'dealer', 'member_team', 'parent_company', 'org') then
    raise exception 'unsupported organization_type: %', p_organization_type;
  end if;

  v_org_type := case v_organization_type
    when 'oem' then 'manufacturer'
    when 'dealer' then 'dealer'
    when 'member_team' then 'member_team'
    when 'parent_company' then 'parent_company'
    else 'org'
  end;

  select *
  into v_previous
  from public.orgs
  where id = p_organization_id
  for update;

  if v_previous.id is null then
    raise exception 'organization not found';
  end if;

  update public.orgs
  set organization_type = v_organization_type,
      org_type = v_org_type,
      updated_at = now()
  where id = p_organization_id
  returning * into v_updated;

  perform public.keepr_admin_record_audit_event(
    v_actor_user_id,
    'organization.classification.updated',
    p_organization_id,
    'organization',
    p_organization_id::text,
    'success',
    jsonb_build_object(
      'previous_organization_type', v_previous.organization_type,
      'previous_org_type', v_previous.org_type,
      'organization_type', v_updated.organization_type,
      'org_type', v_updated.org_type,
      'workspace_type', v_updated.workspace_type
    ) || coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object(
    'ok', true,
    'organization', to_jsonb(v_updated)
  );
end;
$$;

grant execute on function public.update_keepr_admin_org_classification(uuid, text, jsonb) to authenticated;

comment on function public.update_keepr_admin_org_classification(uuid, text, jsonb) is
  'Keepr Admin operation for changing org classification without changing workspace product surface or customer membership.';
