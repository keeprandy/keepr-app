-- Make organization provisioning idempotent for exact existing org matches.
--
-- This lets Keepr promote a pre-existing brand/dealer/member-team org into a
-- configured workspace tenant without creating duplicate slugs.

create or replace function public.create_keepr_organization(
  p_org_name text,
  p_org_preset text,
  p_admin_user_id uuid,
  p_admin_email text default null,
  p_brand jsonb default '{}'::jsonb,
  p_capabilities jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_name text := nullif(trim(coalesce(p_org_name, '')), '');
  v_admin_email text := lower(nullif(trim(coalesce(p_admin_email, '')), ''));
  v_brand jsonb := coalesce(p_brand, '{}'::jsonb);
  v_preset jsonb := public.keepr_org_preset_config(p_org_preset);
  v_workspace_type text := v_preset ->> 'workspace_type';
  v_capabilities jsonb := case
    when jsonb_typeof(coalesce(p_capabilities, 'null'::jsonb)) = 'array' then p_capabilities
    else v_preset -> 'capabilities'
  end;
  v_org public.orgs%rowtype;
  v_admin public.profiles%rowtype;
  v_slug text;
  v_candidate_slug text;
  v_profile public.keepr_pros%rowtype;
  v_template_count integer := 0;
  v_draft_count integer := 0;
  v_exact_build_count integer := 0;
begin
  if not public.is_keepr_internal_admin(auth.uid()) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  if v_org_name is null then
    raise exception 'org_name is required';
  end if;

  if p_admin_user_id is null then
    raise exception 'admin_user_id is required';
  end if;

  select *
  into v_admin
  from public.profiles
  where id = p_admin_user_id;

  if v_admin.id is null then
    raise exception 'admin profile not found';
  end if;

  v_admin_email := coalesce(v_admin_email, lower(nullif(v_admin.email, '')));
  v_candidate_slug := coalesce(
    nullif(public.keepr_slugify(v_brand ->> 'slug'), ''),
    public.keepr_slugify(v_org_name)
  );

  select *
  into v_org
  from public.orgs o
  where lower(coalesce(o.slug, '')) = lower(v_candidate_slug)
     or lower(coalesce(o.name, '')) = lower(v_org_name)
     or lower(coalesce(o.display_name, '')) = lower(v_org_name)
  order by
    case when lower(coalesce(o.slug, '')) = lower(v_candidate_slug) then 0 else 1 end,
    o.created_at asc nulls last
  limit 1;

  if v_org.id is null then
    v_slug := public.keepr_unique_org_slug(coalesce(v_brand ->> 'slug', v_org_name));

    insert into public.orgs (
      name,
      display_name,
      slug,
      organization_type,
      org_type,
      workspace_type,
      workspace_capabilities,
      status,
      authority_state,
      source_type,
      source_name,
      source_url,
      source_metadata,
      created_at,
      updated_at
    )
    values (
      v_org_name,
      coalesce(nullif(v_brand ->> 'display_name', ''), v_org_name),
      v_slug,
      v_preset ->> 'organization_type',
      v_preset ->> 'org_type',
      v_workspace_type,
      v_capabilities,
      'active',
      'org_managed',
      'keepr_admin',
      'create_keepr_organization',
      nullif(v_brand ->> 'website', ''),
      jsonb_build_object(
        'created_by_operation', 'create_keepr_organization',
        'preset', v_preset ->> 'preset',
        'created_by', auth.uid(),
        'created_at', now()
      ),
      now(),
      now()
    )
    returning * into v_org;
  else
    v_slug := coalesce(nullif(v_org.slug, ''), public.keepr_unique_org_slug(coalesce(v_brand ->> 'slug', v_org_name), v_org.id));

    update public.orgs
    set name = coalesce(nullif(name, ''), v_org_name),
        display_name = coalesce(nullif(v_brand ->> 'display_name', ''), nullif(display_name, ''), v_org_name),
        slug = v_slug,
        organization_type = v_preset ->> 'organization_type',
        org_type = v_preset ->> 'org_type',
        workspace_type = v_workspace_type,
        workspace_capabilities = v_capabilities,
        status = 'active',
        authority_state = 'org_managed',
        source_type = coalesce(nullif(source_type, ''), 'keepr_admin'),
        source_name = 'create_keepr_organization',
        source_url = coalesce(nullif(v_brand ->> 'website', ''), source_url),
        source_metadata = coalesce(source_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'provisioned_by_operation', 'create_keepr_organization',
            'preset', v_preset ->> 'preset',
            'provisioned_by', auth.uid(),
            'provisioned_at', now()
          ),
        updated_at = now()
    where id = v_org.id
    returning * into v_org;
  end if;

  insert into public.org_members (
    org_id,
    user_id,
    member_role,
    role,
    status,
    metadata,
    created_at,
    joined_at
  )
  values (
    v_org.id,
    v_admin.id,
    'admin',
    'admin',
    'active',
    jsonb_build_object(
      'source', 'create_keepr_organization',
      'preset', v_preset ->> 'preset',
      'assigned_by', auth.uid(),
      'assigned_at', now()
    ),
    now(),
    now()
  )
  on conflict (org_id, user_id) do update
    set member_role = 'admin',
        role = 'admin',
        status = 'active',
        metadata = coalesce(public.org_members.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'source', 'create_keepr_organization',
            'preset', v_preset ->> 'preset',
            'assigned_by', auth.uid(),
            'assigned_at', now()
          ),
        joined_at = coalesce(public.org_members.joined_at, now());

  select *
  into v_profile
  from public.keepr_pros kp
  where kp.organization_id = v_org.id
  order by kp.created_at asc nulls last
  limit 1;

  if v_profile.id is null then
    insert into public.keepr_pros (
      organization_id,
      user_id,
      name,
      display_name,
      slug,
      category,
      email,
      website,
      logo_url,
      avatar_url,
      header_image_url,
      short_description,
      public_description,
      profile_status,
      publish_status,
      claimed_state,
      source,
      source_metadata,
      created_at,
      updated_at
    )
    values (
      v_org.id,
      v_admin.id,
      v_org_name,
      coalesce(nullif(v_brand ->> 'display_name', ''), v_org_name),
      v_slug,
      v_preset ->> 'profile_category',
      v_admin_email,
      nullif(v_brand ->> 'website', ''),
      nullif(v_brand ->> 'logo_url', ''),
      nullif(v_brand ->> 'avatar_url', ''),
      nullif(v_brand ->> 'header_image_url', ''),
      nullif(v_brand ->> 'short_description', ''),
      nullif(v_brand ->> 'public_description', ''),
      'draft',
      'draft',
      'unclaimed',
      'create_keepr_organization',
      jsonb_build_object('workspace_type', v_workspace_type, 'preset', v_preset ->> 'preset'),
      now(),
      now()
    )
    returning * into v_profile;
  else
    update public.keepr_pros
    set user_id = coalesce(user_id, v_admin.id),
        name = coalesce(nullif(name, ''), v_org_name),
        display_name = coalesce(nullif(v_brand ->> 'display_name', ''), nullif(display_name, ''), v_org_name),
        slug = coalesce(nullif(slug, ''), v_slug),
        category = v_preset ->> 'profile_category',
        email = coalesce(nullif(email, ''), v_admin_email),
        website = coalesce(nullif(v_brand ->> 'website', ''), website),
        logo_url = coalesce(nullif(v_brand ->> 'logo_url', ''), logo_url),
        avatar_url = coalesce(nullif(v_brand ->> 'avatar_url', ''), avatar_url),
        header_image_url = coalesce(nullif(v_brand ->> 'header_image_url', ''), header_image_url),
        short_description = coalesce(nullif(v_brand ->> 'short_description', ''), short_description),
        public_description = coalesce(nullif(v_brand ->> 'public_description', ''), public_description),
        source = 'create_keepr_organization',
        source_metadata = coalesce(source_metadata, '{}'::jsonb)
          || jsonb_build_object('workspace_type', v_workspace_type, 'preset', v_preset ->> 'preset'),
        updated_at = now()
    where id = v_profile.id
    returning * into v_profile;
  end if;

  insert into public.org_activations (
    organization_id,
    workspace_type,
    status,
    capabilities,
    activation_metadata,
    activated_at,
    activated_by
  )
  values (
    v_org.id,
    v_workspace_type,
    'active',
    v_capabilities,
    jsonb_build_object(
      'source', 'create_keepr_organization',
      'preset', v_preset ->> 'preset',
      'admin_user_id', v_admin.id,
      'admin_email', v_admin_email
    ),
    now(),
    auth.uid()
  )
  on conflict (organization_id) do update
    set workspace_type = excluded.workspace_type,
        status = 'active',
        capabilities = excluded.capabilities,
        activation_metadata = coalesce(public.org_activations.activation_metadata, '{}'::jsonb) || excluded.activation_metadata,
        activated_at = coalesce(public.org_activations.activated_at, excluded.activated_at),
        activated_by = excluded.activated_by,
        updated_at = now();

  select count(*)::integer
  into v_template_count
  from public.asset_model_templates t
  where t.organization_id = v_org.id;

  select count(*)::integer
  into v_draft_count
  from public.catalog_template_drafts d
  where d.organization_id = v_org.id;

  select count(*)::integer
  into v_exact_build_count
  from public.exact_build_drafts d
  where d.organization_id = v_org.id;

  return jsonb_build_object(
    'ok', true,
    'preset', v_preset ->> 'preset',
    'organization_id', v_org.id,
    'workspace_id', 'org:' || v_org.id::text,
    'organization', to_jsonb(v_org),
    'admin_user_id', v_admin.id,
    'admin_email', v_admin_email,
    'brand_profile', to_jsonb(v_profile),
    'catalog_counts', jsonb_build_object(
      'templates', v_template_count,
      'drafts', v_draft_count,
      'exact_build_drafts', v_exact_build_count
    ),
    'workspace', public.keepr_admin_workspace_preview_json(v_org.id)
  );
end;
$$;

grant execute on function public.create_keepr_organization(text, text, uuid, text, jsonb, jsonb) to authenticated, service_role;
