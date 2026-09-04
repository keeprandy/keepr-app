-- KeeprLINK resource bridge: model pages already store many OEM resources as
-- attachment_placements. Project those through the shared resolver so model
-- buyer guides, org-wide manuals, and warranty descriptors show up in one
-- context contract instead of drifting from the Resources UI.

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
          'source_artifact', jsonb_strip_nulls(jsonb_build_object(
            'kind', r.source_artifact_kind,
            'canonical_url', case when r.public_url_allowed and r.url ~* '^https?://' then r.url else null end,
            'canonical_source_url', case when r.public_link_allowed and r.source_url ~* '^https?://' then r.source_url else null end,
            'attachment_id', case when not p_public_only then r.attachment_id else null end
          )),
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
      order by
        case r.authority_state
          when 'oem_as_built' then 0
          when 'oem_published' then 1
          when 'evidence_verified' then 2
          else 9
        end,
        r.title
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
      case
        when r.attachment_id is not null then 'attachment'
        when r.url is not null then 'url'
        when r.source_url is not null then 'source_url'
        else 'descriptor'
      end as source_artifact_kind,
      r.authority_state,
      r.rights_status,
      r.applies_to_type,
      r.applies_to_id,
      coalesce(r.metadata ->> 'role', r.resource_type) as role,
      lower(coalesce(r.metadata #>> '{ai_context,role}', r.metadata ->> 'ai_context_role', r.metadata ->> 'context_role')) as ai_context_role,
      coalesce(r.metadata #>> '{ai_context,scope}', r.metadata ->> 'scope', r.metadata ->> 'document_scope', r.metadata ->> 'media_scope') as scope,
      coalesce(r.metadata #>> '{ai_context,privacy}', r.metadata ->> 'privacy', r.metadata ->> 'visibility_intent', r.rights_status) as privacy,
      coalesce(r.metadata #>> '{ai_context,review_state}', r.metadata ->> 'review_state', r.metadata ->> 'rights_review_state') as review_state,
      coalesce(r.metadata -> 'provenance', '{}'::jsonb) as provenance,
      r.metadata ->> 'known_gap' as known_gap,
      r.rights_status in ('public_ok', 'review_permission') as public_link_allowed,
      r.rights_status = 'public_ok' as public_url_allowed
    from public.asset_resources r
    where r.applies_to_type = p_applies_to_type
      and r.applies_to_id = any(coalesce(p_applies_to_ids, array[]::uuid[]))
      and lower(coalesce(r.metadata #>> '{ai_context,role}', r.metadata ->> 'ai_context_role', r.metadata ->> 'context_role', 'off'))
        in ('primary', 'supporting')
      and (
        not p_public_only
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
      case
        when a.id is not null then 'attachment'
        when a.url is not null then 'url'
        else 'descriptor'
      end as source_artifact_kind,
      coalesce(a.source_context ->> 'authority_state', a.ai_metadata ->> 'authority', 'oem_published') as authority_state,
      coalesce(a.ai_metadata ->> 'privacy', a.source_context ->> 'privacy', 'moves_with_asset') as rights_status,
      p_applies_to_type as applies_to_type,
      ap.target_id as applies_to_id,
      coalesce(nullif(ap.role, ''), a.ai_metadata ->> 'role', a.kind, 'resource') as role,
      lower(coalesce(a.ai_metadata ->> 'ai_context', a.ai_metadata ->> 'context_role')) as ai_context_role,
      coalesce(a.ai_metadata ->> 'ai_scope', a.source_context ->> 'scope', a.source_context ->> 'applies_to_type', p_applies_to_type) as scope,
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

grant execute on function public.keeprlink_resource_projection(text, uuid[], boolean) to anon, authenticated, service_role;
