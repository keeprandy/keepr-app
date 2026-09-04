-- Production convergence function reconciliation.
-- DO NOT RUN until explicitly approved.
-- Contains function contracts required by the release code and KeeprLINK API.
-- Functions are idempotently replaced; no table data is changed by this file.

begin;

-- Bring in the canonical shared resolver contract from staging. This migration
-- is idempotent for table/index creation and primarily installs the missing
-- resolve_keeprlink_context(...) function family production needs.
\ir ../../migrations/20260904110500_keeprlink_context_resolver_v1.sql

create or replace function public.keeprlink_slugify(p_value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.keeprlink_normalize_address(p_address text)
returns text
language sql
immutable
as $$
  select public.keeprlink_slugify(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(p_address, ''), '^https?://[^/]+', '', 'i'),
          '^/*(api/)?k/',
          '',
          'i'
        ),
        '/context$',
        '',
        'i'
      ),
      '[?#].*$',
      '',
      'g'
    )
  );
$$;

create or replace function public.keeprlink_compact_address(p_address text)
returns text
language sql
immutable
as $$
  select regexp_replace(public.keeprlink_normalize_address(p_address), '-', '', 'g');
$$;

create or replace function public.keeprlink_purpose(p_purpose text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(nullif(trim(coalesce(p_purpose, '')), ''), 'understand'))
    when 'understand' then 'understand'
    when 'self_service' then 'self_service'
    when 'llm_context' then 'llm_context'
    when 'keepr_enablement' then 'keepr_enablement'
    else 'understand'
  end;
$$;

create or replace function public.keeprlink_public_purpose(p_purpose text)
returns boolean
language sql
immutable
as $$
  select public.keeprlink_purpose(p_purpose) = any (
    array['understand'::text, 'self_service'::text, 'llm_context'::text]
  );
$$;

create or replace function public.keeprlink_context_instructions(p_purpose text, p_authorized boolean default false)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'role', 'external_llm_context_consumer',
    'purpose', public.keeprlink_purpose(p_purpose),
    'access', case when p_authorized then 'authorized' else 'public_read_only' end,
    'rules', jsonb_build_array(
      'Keepr is the source of canonical identity, applicability, authority, and provenance for this projection.',
      'Treat exact asset or system facts separately from reusable model or system-template knowledge.',
      'Do not promote inference, missing values, or generic web knowledge to fact.',
      'Prefer Keepr-established applicability and configuration facts, plus Keepr-linked authoritative resources, over generic web search.',
      'If Keepr does not establish an applicability or configuration fact, say that Keepr has not established it.',
      'Identify missing context explicitly instead of guessing.',
      'Use source provenance and authority labels when explaining why a statement is trusted.'
    )
  );
$$;

create or replace function public.keeprlink_resource_projection(
  p_applies_to_type text,
  p_applies_to_ids uuid[],
  p_public_only boolean default true
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', r.id,
          'attachment_id', case when not p_public_only then r.attachment_id else null end,
          'resource_type', r.resource_type,
          'title', r.title,
          'source_name', r.source_name,
          'source_platform', r.source_platform,
          'source_url', case when r.public_link_allowed and r.source_url ~* '^https?://' then r.source_url else null end,
          'url', case when r.public_url_allowed and r.url ~* '^https?://' then r.url else null end,
          'authority_state', r.authority_state,
          'rights_status', r.rights_status,
          'applies_to_type', r.applies_to_type,
          'applies_to_id', r.applies_to_id,
          'role', r.role,
          'access_mode', case
            when r.public_url_allowed then 'public_url'
            when r.public_link_allowed and p_public_only then 'public_descriptor'
            when r.public_link_allowed then 'authorized_descriptor'
            when not p_public_only then 'authorized_private_descriptor'
            else 'restricted'
          end,
          'ai_context_status', 'included',
          'ai_context_role', r.ai_context_role,
          'scope', r.scope,
          'privacy', r.privacy,
          'review_state', r.review_state,
          'provenance', coalesce(r.provenance, '{}'::jsonb),
          'known_gap', r.known_gap
        )
      )
      order by r.title
    ),
    '[]'::jsonb
  )
  from (
    select
      r.id::text as id,
      r.attachment_id,
      r.resource_type,
      coalesce(nullif(r.title, ''), r.source_name, 'Resource') as title,
      r.source_name,
      r.source_platform,
      r.source_url,
      r.url,
      r.authority_state,
      r.rights_status,
      r.applies_to_type,
      r.applies_to_id,
      coalesce(r.role, r.metadata ->> 'role', r.resource_type) as role,
      lower(coalesce(r.metadata #>> '{ai_context,role}', r.metadata ->> 'ai_context_role', r.metadata ->> 'context_role')) as ai_context_role,
      coalesce(r.metadata #>> '{ai_context,scope}', r.metadata ->> 'scope') as scope,
      coalesce(r.metadata #>> '{ai_context,privacy}', r.metadata ->> 'privacy', r.rights_status) as privacy,
      coalesce(r.metadata #>> '{ai_context,review_state}', r.metadata ->> 'review_state') as review_state,
      coalesce(r.metadata -> 'provenance', '{}'::jsonb) as provenance,
      r.metadata ->> 'known_gap' as known_gap,
      coalesce(r.public_link_allowed, false) as public_link_allowed,
      coalesce(r.public_url_allowed, false) as public_url_allowed
    from public.asset_resources r
    where r.applies_to_type = p_applies_to_type
      and r.applies_to_id = any(coalesce(p_applies_to_ids, array[]::uuid[]))
      and lower(coalesce(r.metadata #>> '{ai_context,role}', r.metadata ->> 'ai_context_role', r.metadata ->> 'context_role', 'off'))
        in ('primary', 'supporting')
      and (
        not p_public_only
        or coalesce(r.public_link_allowed, false)
        or r.rights_status in ('public_ok', 'review_permission')
      )

    union all

    select
      ('attachment:' || a.id::text) as id,
      a.id as attachment_id,
      coalesce(nullif(ap.role, ''), a.ai_metadata ->> 'role', a.kind, 'resource') as resource_type,
      coalesce(nullif(a.title, ''), nullif(ap.label, ''), a.file_name, 'Attachment resource') as title,
      coalesce(a.source_context ->> 'source_name', a.source_context ->> 'provided_by_label', a.source_context ->> 'authored_by_label') as source_name,
      'Keepr attachments' as source_platform,
      coalesce(a.source_context ->> 'source_url', a.url) as source_url,
      a.url,
      coalesce(a.source_context ->> 'authority_state', a.ai_metadata ->> 'authority', 'oem_published') as authority_state,
      coalesce(a.ai_metadata ->> 'privacy', a.source_context ->> 'privacy', 'moves_with_asset') as rights_status,
      p_applies_to_type as applies_to_type,
      ap.target_id as applies_to_id,
      coalesce(nullif(ap.role, ''), a.ai_metadata ->> 'role', a.kind, 'resource') as role,
      lower(coalesce(a.ai_metadata ->> 'ai_context', a.ai_metadata ->> 'context_role')) as ai_context_role,
      coalesce(a.ai_metadata ->> 'ai_scope', a.source_context ->> 'scope', p_applies_to_type) as scope,
      coalesce(a.ai_metadata ->> 'privacy', a.source_context ->> 'visibility', 'moves_with_asset') as privacy,
      coalesce(a.ai_metadata ->> 'review_state', a.source_context ->> 'review_state', 'unreviewed') as review_state,
      coalesce(a.source_context, '{}'::jsonb) as provenance,
      a.ai_metadata ->> 'known_gap' as known_gap,
      coalesce(a.ai_metadata ->> 'privacy', a.source_context ->> 'visibility', 'moves_with_asset') !~* '^(internal_private|private|restricted|secret)$' as public_link_allowed,
      a.url ~* '^https?://'
        and coalesce(a.ai_metadata ->> 'privacy', a.source_context ->> 'visibility', 'moves_with_asset') !~* '^(internal_private|private|restricted|secret)$' as public_url_allowed
    from public.attachment_placements ap
    join public.attachments a on a.id = ap.attachment_id
    where ap.target_type = case
        when p_applies_to_type = 'template' then 'model_template'
        when p_applies_to_type = 'org' then 'org'
        else p_applies_to_type
      end
      and ap.target_id = any(coalesce(p_applies_to_ids, array[]::uuid[]))
      and a.deleted_at is null
      and lower(coalesce(a.ai_metadata ->> 'ai_context', a.ai_metadata ->> 'context_role', 'off'))
        in ('primary', 'supporting')
      and (
        not p_public_only
        or coalesce(a.ai_metadata ->> 'privacy', a.source_context ->> 'visibility', 'moves_with_asset') !~* '^(internal_private|private|restricted|secret)$'
      )
  ) r;
$$;

create or replace function public.search_keeprspace_organizations(
  p_query text default null,
  p_workspace_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
  v_workspace_type text := lower(nullif(trim(coalesce(p_workspace_type, '')), ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  return jsonb_build_object(
    'query', coalesce(p_query, ''),
    'workspace_type', v_workspace_type,
    'organizations', coalesce((
      with matches as (
        select
          o.id,
          coalesce(nullif(o.display_name, ''), nullif(o.name, ''), 'Organization') as display_name,
          o.name,
          o.slug,
          o.organization_type,
          o.org_type,
          public.keepr_workspace_type_for_org(o.workspace_type, o.organization_type, o.org_type) as workspace_type,
          coalesce(o.status, 'active') as profile_status,
          case
            when v_query = '' then 50
            when lower(coalesce(o.slug, '')) = v_query then 0
            when lower(coalesce(o.display_name, o.name, '')) = v_query then 1
            when lower(coalesce(o.display_name, o.name, '')) like v_query || '%' then 10
            when lower(coalesce(o.display_name, o.name, '')) like '%' || v_query || '%' then 20
            else 90
          end as rank
        from public.orgs o
        where coalesce(o.status, 'active') = 'active'
          and (
            v_query = ''
            or lower(coalesce(o.display_name, o.name, '')) like '%' || v_query || '%'
            or lower(coalesce(o.slug, '')) like '%' || v_query || '%'
          )
      )
      select jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'id', id,
          'display_name', display_name,
          'name', name,
          'slug', slug,
          'organization_type', organization_type,
          'org_type', org_type,
          'workspace_type', workspace_type,
          'profile_status', profile_status,
          'rank', rank
        ))
        order by rank, display_name
      )
      from matches
      where (v_workspace_type is null or workspace_type = v_workspace_type)
      limit 20
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.apply_system_template_reference_from_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_item_id uuid;
  v_system_template_id uuid;
begin
  if new.system_template_id is null then
    begin
      v_template_item_id := nullif(new.metadata ->> 'exact_build_template_item_id', '')::uuid;
    exception when invalid_text_representation then
      v_template_item_id := null;
    end;

    if v_template_item_id is not null then
      select item.system_template_id
      into v_system_template_id
      from public.asset_model_template_items item
      where item.id = v_template_item_id
      limit 1;

      new.system_template_id := v_system_template_id;
    end if;
  end if;

  if new.system_template_id is not null then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'system_template_id', new.system_template_id,
      'system_template_reference_source', 'production_convergence_2026_09_04'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists systems_apply_system_template_reference on public.systems;
create trigger systems_apply_system_template_reference
before insert or update of metadata, system_template_id
on public.systems
for each row
execute function public.apply_system_template_reference_from_metadata();

grant execute on function public.keeprlink_normalize_address(text) to anon, authenticated;
grant execute on function public.keeprlink_compact_address(text) to anon, authenticated;
grant execute on function public.keeprlink_purpose(text) to anon, authenticated;
grant execute on function public.keeprlink_resource_projection(text, uuid[], boolean) to anon, authenticated, service_role;
grant execute on function public.search_keeprspace_organizations(text, text) to authenticated;
grant execute on function public.resolve_keeprlink_context(text, text, uuid, boolean) to anon, authenticated;

commit;
