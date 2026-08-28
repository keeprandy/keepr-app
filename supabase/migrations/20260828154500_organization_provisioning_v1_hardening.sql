-- Organization provisioning V1 hardening.
--
-- Keep generated model template keys globally unique because the existing
-- asset_model_templates unique index is global on lower(template_key), version.

create or replace function public.keepr_unique_template_key(p_base text, p_version integer default 1)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text := coalesce(nullif(public.keepr_slugify(p_base), ''), 'model-template');
  v_key text := v_base;
  v_suffix integer := 2;
  v_version integer := coalesce(p_version, 1);
begin
  while exists (
    select 1
    from public.asset_model_templates t
    where lower(t.template_key) = lower(v_key)
      and t.version = v_version
  ) loop
    v_key := v_base || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  end loop;

  return v_key;
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

grant execute on function public.keepr_unique_template_key(text, integer) to authenticated;
grant execute on function public.create_org_model_template(uuid, text, text, integer, text, text, text) to authenticated;
