-- Separate org authoring from reusable catalog truth authority.
--
-- Dealers can create/import/build boats through their own workspace, but only
-- orgs with model_catalog capability can mutate reusable model templates.

create or replace function public.activator_user_can_author_catalog_for_org(
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
    join public.orgs o on o.id = m.org_id
    where p_user_id is not null
      and m.org_id = p_organization_id
      and m.user_id = p_user_id
      and coalesce(m.status, 'active') = 'active'
      and coalesce(m.role, m.member_role, 'member') in ('owner', 'admin', 'manager')
      and (
        coalesce(o.workspace_type, '') = 'keeproem'
        or coalesce(o.org_type, '') = 'manufacturer'
        or coalesce(o.workspace_capabilities, '[]'::jsonb) ? 'model_catalog'
      )
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
      and public.activator_user_can_author_catalog_for_org(p_user_id, t.organization_id)
  );
$$;

drop policy if exists "Org authors manage templates" on public.asset_model_templates;
create policy "Org catalog authors manage templates"
  on public.asset_model_templates
  for all
  to authenticated
  using (public.activator_user_can_author_catalog_for_org(auth.uid(), organization_id))
  with check (public.activator_user_can_author_catalog_for_org(auth.uid(), organization_id));

drop policy if exists "Org authors manage catalog template drafts" on public.catalog_template_drafts;
create policy "Org catalog authors manage catalog template drafts"
  on public.catalog_template_drafts
  for all
  to authenticated
  using (public.activator_user_can_author_catalog_for_org(auth.uid(), organization_id))
  with check (public.activator_user_can_author_catalog_for_org(auth.uid(), organization_id));

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

  if not public.activator_user_can_author_catalog_for_org(auth.uid(), p_organization_id) then
    raise exception 'not allowed to author reusable catalog truth for this organization';
  end if;

  if v_manufacturer is null or v_model is null or p_model_year is null then
    raise exception 'manufacturer, model, and model_year are required';
  end if;

  v_template_key := coalesce(
    nullif(public.keepr_slugify(p_template_key), ''),
    public.keepr_slugify(p_model_year::text || ' ' || v_manufacturer || ' ' || v_model)
  );
  v_template_key := public.keepr_unique_template_key(v_template_key, 1);

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

grant execute on function public.activator_user_can_author_catalog_for_org(uuid, uuid) to authenticated;
grant execute on function public.activator_user_can_manage_template(uuid, uuid) to authenticated;
grant execute on function public.create_org_model_template(uuid, text, text, integer, text, text, text) to authenticated;

comment on function public.activator_user_can_author_catalog_for_org(uuid, uuid) is
  'Returns true for active owner/admin/manager members of orgs that carry model_catalog/OEM manufacturer authority.';
