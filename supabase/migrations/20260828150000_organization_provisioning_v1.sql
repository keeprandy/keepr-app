-- Organization provisioning V1.
--
-- Keeps OEMs, dealers, and member teams on one org model. Presets configure
-- org type, workspace type, and capabilities; roles grant mutation authority.

create or replace function public.activator_user_can_author_for_org(
  p_user_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where p_user_id is not null
      and m.org_id = p_organization_id
      and m.user_id = p_user_id
      and coalesce(m.status, 'active') = 'active'
      and coalesce(m.role, m.member_role, 'member') in ('owner', 'admin', 'manager')
  );
$$;

create or replace function public.activator_user_can_manage_template(
  p_user_id uuid,
  p_template_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.asset_model_templates t
    where t.id = p_template_id
      and public.activator_user_can_author_for_org(p_user_id, t.organization_id)
  );
$$;

drop policy if exists "Org members manage templates" on public.asset_model_templates;
create policy "Org authors manage templates"
  on public.asset_model_templates
  for all
  to authenticated
  using (public.activator_user_can_author_for_org(auth.uid(), organization_id))
  with check (public.activator_user_can_author_for_org(auth.uid(), organization_id));

drop policy if exists "Org members manage catalog template drafts" on public.catalog_template_drafts;
create policy "Org authors manage catalog template drafts"
  on public.catalog_template_drafts
  for all
  to authenticated
  using (public.activator_user_can_author_for_org(auth.uid(), organization_id))
  with check (public.activator_user_can_author_for_org(auth.uid(), organization_id));

drop policy if exists "Exact build drafts are manageable by org members" on public.exact_build_drafts;
create policy "Org authors manage exact build drafts"
  on public.exact_build_drafts
  for all
  to authenticated
  using (public.activator_user_can_author_for_org(auth.uid(), organization_id))
  with check (public.activator_user_can_author_for_org(auth.uid(), organization_id));

drop policy if exists "Exact build draft items are manageable by org members" on public.exact_build_draft_items;
create policy "Org authors manage exact build draft items"
  on public.exact_build_draft_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.exact_build_drafts d
      where d.id = draft_id
        and public.activator_user_can_author_for_org(auth.uid(), d.organization_id)
    )
  )
  with check (
    exists (
      select 1
      from public.exact_build_drafts d
      where d.id = draft_id
        and public.activator_user_can_author_for_org(auth.uid(), d.organization_id)
    )
  );

create or replace function public.keepr_slugify(p_value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g'));
$$;

create or replace function public.keepr_unique_org_slug(p_base text, p_existing_org_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text := coalesce(nullif(public.keepr_slugify(p_base), ''), 'organization');
  v_slug text := v_base;
  v_suffix integer := 2;
begin
  while exists (
    select 1
    from public.orgs o
    where lower(o.slug) = lower(v_slug)
      and (p_existing_org_id is null or o.id <> p_existing_org_id)
  ) loop
    v_slug := v_base || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  end loop;

  return v_slug;
end;
$$;

create or replace function public.keepr_org_preset_config(p_preset text)
returns jsonb
language sql
immutable
as $$
  select case lower(coalesce(nullif(p_preset, ''), 'org'))
    when 'oem' then jsonb_build_object(
      'preset', 'oem',
      'organization_type', 'oem',
      'org_type', 'manufacturer',
      'workspace_type', 'keeproem',
      'capabilities', public.keepr_default_capabilities_for_workspace('keeproem'),
      'profile_category', 'oem'
    )
    when 'dealer' then jsonb_build_object(
      'preset', 'dealer',
      'organization_type', 'dealer',
      'org_type', 'dealer',
      'workspace_type', 'keeprdealer',
      'capabilities', public.keepr_default_capabilities_for_workspace('keeprdealer'),
      'profile_category', 'dealer'
    )
    when 'member_team' then jsonb_build_object(
      'preset', 'member_team',
      'organization_type', 'member_team',
      'org_type', 'member_team',
      'workspace_type', 'org',
      'capabilities', '["shared_assets","member_portfolio","team_access","relationships"]'::jsonb,
      'profile_category', 'member_team'
    )
    else jsonb_build_object(
      'preset', 'org',
      'organization_type', 'org',
      'org_type', 'org',
      'workspace_type', 'org',
      'capabilities', '[]'::jsonb,
      'profile_category', 'org'
    )
  end;
$$;

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
  v_profile public.keepr_pros%rowtype;
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
      'templates', 0,
      'drafts', 0,
      'exact_build_drafts', 0
    ),
    'workspace', public.keepr_admin_workspace_preview_json(v_org.id)
  );
end;
$$;

create or replace function public.create_org_model_template(
  p_organization_id uuid,
  p_manufacturer text,
  p_model text,
  p_model_year integer,
  p_template_key text default null,
  p_category text default 'marine',
  p_class text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manufacturer text := nullif(trim(coalesce(p_manufacturer, '')), '');
  v_model text := nullif(trim(coalesce(p_model, '')), '');
  v_template_key text;
  v_template public.asset_model_templates%rowtype;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if not public.activator_user_can_author_for_org(auth.uid(), p_organization_id) then
    raise exception 'not allowed to author catalog for this organization';
  end if;

  if v_manufacturer is null or v_model is null or p_model_year is null then
    raise exception 'manufacturer, model, and model_year are required';
  end if;

  v_template_key := coalesce(
    nullif(public.keepr_slugify(p_template_key), ''),
    public.keepr_slugify(p_model_year::text || ' ' || v_manufacturer || ' ' || v_model)
  );

  insert into public.asset_model_templates (
    organization_id,
    asset_type,
    category,
    class,
    manufacturer,
    model,
    model_year,
    model_year_start,
    model_year_end,
    template_key,
    version,
    status,
    authority_state,
    metadata,
    created_by,
    created_at,
    updated_at
  )
  values (
    p_organization_id,
    'boat',
    coalesce(nullif(trim(p_category), ''), 'marine'),
    nullif(trim(p_class), ''),
    v_manufacturer,
    v_model,
    p_model_year,
    p_model_year,
    p_model_year,
    v_template_key,
    1,
    'draft',
    'oem_published',
    jsonb_build_object('source', 'create_org_model_template'),
    auth.uid(),
    now(),
    now()
  )
  returning * into v_template;

  return jsonb_build_object(
    'ok', true,
    'template', to_jsonb(v_template)
  );
end;
$$;

grant execute on function public.activator_user_can_author_for_org(uuid, uuid) to authenticated;
grant execute on function public.keepr_slugify(text) to authenticated;
grant execute on function public.keepr_unique_org_slug(text, uuid) to authenticated;
grant execute on function public.keepr_org_preset_config(text) to authenticated;
grant execute on function public.create_keepr_organization(text, text, uuid, text, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.create_org_model_template(uuid, text, text, integer, text, text, text) to authenticated;

comment on function public.activator_user_can_author_for_org(uuid, uuid) is
  'Returns true for active owner/admin/manager org members. Members can use a workspace but cannot mutate reusable catalog truth.';

comment on function public.create_keepr_organization(text, text, uuid, text, jsonb, jsonb) is
  'Keepr internal operation for creating an isolated organization tenant using existing org/member/workspace primitives and a preset.';
