-- Signed-in app surfaces need editable attachment handles from the shared
-- KeeprLINK resolver, while anonymous/public AI links must keep those handles
-- stripped. Add an explicit authorized flag to the resolver RPC so the web API
-- can request the authorized projection only after Supabase auth succeeds.

create or replace function public.resolve_keeprlink_context(
  p_address text,
  p_purpose text default 'understand',
  p_system_id uuid default null,
  p_authorized boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_address text := nullif(trim(coalesce(p_address, '')), '');
  v_normalized text := public.keeprlink_normalize_address(p_address);
  v_compact text := public.keeprlink_compact_address(p_address);
  v_purpose text := public.keeprlink_purpose(p_purpose);
  v_authorized boolean := auth.uid() is not null and p_authorized;
  v_link public.keepr_links%rowtype;
  v_object_type text;
  v_object_id uuid;
  v_context jsonb;
begin
  if v_address is null or v_normalized is null or v_normalized = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_address');
  end if;

  if p_system_id is not null then
    select 'system_instance', s.id
    into v_object_type, v_object_id
    from public.systems s
    join public.assets a on a.id = s.asset_id and a.deleted_at is null
    where s.id = p_system_id
      and public.keeprlink_normalize_address(a.kac_id) = v_normalized
    limit 1;
  end if;

  if v_object_id is null then
    select *
    into v_link
    from public.keepr_links
    where normalized_address = v_normalized
      and status = 'active'
    order by is_canonical desc, updated_at desc
    limit 1;

    v_object_type := v_link.object_type;
    v_object_id := v_link.object_id;
  end if;

  if v_object_id is null then
    select 'asset', a.id
    into v_object_type, v_object_id
    from public.assets a
    where a.deleted_at is null
      and public.keeprlink_normalize_address(a.kac_id) = v_normalized
    limit 1;
  end if;

  if v_object_id is null then
    select 'organization', o.id
    into v_object_type, v_object_id
    from public.orgs o
    where public.keeprlink_normalize_address(coalesce(o.slug, o.display_name, o.name)) = v_normalized
       or public.keeprlink_normalize_address(coalesce(o.display_name, o.name)) = v_normalized
       or public.keeprlink_compact_address(coalesce(o.slug, o.display_name, o.name)) = v_compact
       or public.keeprlink_compact_address(coalesce(o.display_name, o.name)) = v_compact
    order by case when lower(coalesce(o.slug, '')) = v_normalized then 0 else 1 end
    limit 1;
  end if;

  if v_object_id is null then
    select 'asset_model_template', t.id
    into v_object_type, v_object_id
    from public.asset_model_templates t
    where t.status <> 'retired'
      and (
        public.keeprlink_normalize_address(t.template_key) = v_normalized
        or public.keeprlink_normalize_address(t.manufacturer || ' ' || t.model_year || ' ' || t.model) = v_normalized
        or public.keeprlink_normalize_address(t.manufacturer || ' ' || t.model) = v_normalized
        or public.keeprlink_compact_address(t.template_key) = v_compact
        or public.keeprlink_compact_address(t.manufacturer || ' ' || t.model_year || ' ' || t.model) = v_compact
        or public.keeprlink_compact_address(t.manufacturer || ' ' || t.model) = v_compact
      )
    order by t.version desc
    limit 1;
  end if;

  if v_object_id is null then
    select 'system_template', st.id
    into v_object_type, v_object_id
    from public.system_templates st
    where st.authority_state <> 'retired'
      and (
        public.keeprlink_normalize_address(st.canonical_key) = v_normalized
        or public.keeprlink_normalize_address(coalesce(st.manufacturer || ' ', '') || st.name) = v_normalized
        or public.keeprlink_normalize_address(st.name) = v_normalized
        or public.keeprlink_compact_address(st.canonical_key) = v_compact
        or public.keeprlink_compact_address(coalesce(st.manufacturer || ' ', '') || st.name) = v_compact
        or public.keeprlink_compact_address(st.name) = v_compact
      )
    limit 1;
  end if;

  if v_object_id is null then
    select 'system_instance', s.id
    into v_object_type, v_object_id
    from public.systems s
    join public.assets a on a.id = s.asset_id and a.deleted_at is null
    where v_normalized like public.keeprlink_normalize_address(a.kac_id) || '-%'
      and (
        v_normalized = public.keeprlink_normalize_address(a.kac_id || '-' || s.name)
        or v_normalized = public.keeprlink_normalize_address(a.kac_id || '-' || coalesce(s.metadata ->> 'canonical_key', s.ksc_code, s.system_type, s.name))
      )
    order by s.name
    limit 1;
  end if;

  if v_object_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'address', v_address);
  end if;

  v_context := case v_object_type
    when 'organization' then public.keeprlink_org_context(v_object_id, v_purpose, v_authorized)
    when 'asset_model_template' then public.keeprlink_model_context(v_object_id, v_purpose, v_authorized)
    when 'system_template' then public.keeprlink_system_template_context(v_object_id, v_purpose, v_authorized)
    when 'asset' then public.keeprlink_asset_context(v_object_id, v_purpose, v_authorized)
    when 'system_instance' then public.keeprlink_system_instance_context(v_object_id, v_purpose, v_authorized)
    else null
  end;

  if v_context is null then
    return jsonb_build_object('ok', false, 'error', 'unsupported_object_type', 'object_type', v_object_type);
  end if;

  return jsonb_strip_nulls(
    jsonb_build_object(
      'ok', true,
      'manifest_version', 'keepr.link.context.v1',
      'generated_at', now(),
      'purpose', v_purpose,
      'canonical_object', jsonb_build_object('type', v_object_type, 'id', v_object_id),
      'address', '/k/' || v_address,
      'resolution', jsonb_build_object(
        'normalized_address', v_normalized,
        'source', case when v_link.id is null then 'derived_existing_keeprlink' else 'keepr_links' end,
        'link_id', v_link.id
      ),
      'projection', v_context,
      'instructions', public.keeprlink_context_instructions(v_purpose, v_authorized)
    )
  );
end;
$$;

grant execute on function public.resolve_keeprlink_context(text, text, uuid, boolean) to anon, authenticated;

comment on function public.resolve_keeprlink_context(text, text, uuid, boolean) is
  'Resolves a KeeprLINK to purpose-scoped context; signed-in API calls can request editable descriptors without exposing them to public links.';

