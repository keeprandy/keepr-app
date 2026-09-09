-- KeeprLINK asset context v2 phase 1.
--
-- This preserves the existing exact-asset v1 keys while adding a bounded,
-- governed operational projection for LLM context. It intentionally does not
-- add action execution, spending authority, job engines, or broad raw dumps.

create or replace function public.keeprlink_asset_context(
  p_asset_id uuid,
  p_purpose text,
  p_authorized boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with asset_row as (
    select *
    from public.assets a
    where a.id = p_asset_id
      and a.deleted_at is null
  ),
  system_rows as (
    select
      s.*,
      st.canonical_key as template_canonical_key,
      st.name as template_name,
      st.manufacturer as template_manufacturer,
      st.supplier_org_id as template_supplier_org_id,
      st.authority_state as template_authority_state,
      coalesce(
        nullif(s.metadata #>> '{standard,identity,manufacturer}', ''),
        nullif(s.metadata #>> '{identity,manufacturer}', ''),
        nullif(s.metadata ->> 'manufacturer', ''),
        nullif(s.ai_metadata ->> 'manufacturer', ''),
        st.manufacturer
      ) as normalized_manufacturer,
      coalesce(
        nullif(s.metadata #>> '{standard,identity,model}', ''),
        nullif(s.metadata #>> '{identity,model}', ''),
        nullif(s.metadata ->> 'model', ''),
        nullif(s.ai_metadata ->> 'model', '')
      ) as normalized_model,
      coalesce(
        nullif(s.metadata #>> '{standard,identity,serial_number}', ''),
        nullif(s.metadata #>> '{standard,identity,serial}', ''),
        nullif(s.metadata #>> '{identity,serial_number}', ''),
        nullif(s.metadata #>> '{identity,serial}', ''),
        nullif(s.metadata ->> 'serial_number', ''),
        nullif(s.metadata ->> 'serial', ''),
        nullif(s.ai_metadata ->> 'serial_number', ''),
        nullif(s.ai_metadata ->> 'serial', '')
      ) as normalized_serial_number,
      coalesce(
        nullif(s.metadata #>> '{standard,identity,location}', ''),
        nullif(s.metadata #>> '{standard,identity,position}', ''),
        nullif(s.metadata #>> '{identity,location}', ''),
        nullif(s.metadata #>> '{identity,position}', ''),
        nullif(s.metadata ->> 'location', ''),
        nullif(s.metadata ->> 'position', '')
      ) as normalized_location,
      coalesce(
        nullif(s.metadata #>> '{standard,identity,installed_on}', ''),
        nullif(s.metadata #>> '{identity,installed_on}', ''),
        nullif(s.metadata ->> 'installed_on', '')
      ) as normalized_installed_on,
      (
        select count(*)::integer
        from public.attachment_placements ap
        join public.attachments att on att.id = ap.attachment_id
        where ap.target_type = 'system'
          and ap.target_id = s.id
          and att.deleted_at is null
          and (
            p_authorized
            or coalesce(att.ai_metadata ->> 'privacy', att.source_context ->> 'visibility', att.privacy, 'moves_with_asset')
              !~* '^(internal_private|private|restricted|secret)$'
          )
      ) as evidence_count,
      (
        select count(*)::integer
        from public.attachment_placements ap
        join public.attachments att on att.id = ap.attachment_id
        where ap.target_type = 'system'
          and ap.target_id = s.id
          and att.deleted_at is null
          and lower(coalesce(att.ai_metadata ->> 'ai_context', att.ai_metadata ->> 'context_role', 'off'))
            in ('primary', 'supporting')
          and (
            p_authorized
            or coalesce(att.ai_metadata ->> 'privacy', att.source_context ->> 'visibility', att.privacy, 'moves_with_asset')
              !~* '^(internal_private|private|restricted|secret)$'
          )
      ) + (
        select count(*)::integer
        from public.asset_resources r
        where r.applies_to_type = 'system'
          and r.applies_to_id = s.id
          and lower(coalesce(r.metadata #>> '{ai_context,role}', r.metadata ->> 'ai_context_role', r.metadata ->> 'context_role', 'off'))
            in ('primary', 'supporting')
          and (
            p_authorized
            or r.rights_status in ('public_ok', 'review_permission')
          )
      ) as resource_count
    from public.systems s
    left join public.system_templates st on st.id = s.system_template_id
    join asset_row a on a.id = s.asset_id
  ),
  resource_projection as (
    select
      public.keeprlink_resource_projection('template', coalesce((
        select array_agg(distinct b.template_id)
        from public.asset_template_bindings b
        join asset_row a on a.id = b.asset_id
        where b.binding_status in ('suggested', 'inherited', 'verified')
      ), array[]::uuid[]), not p_authorized)
      || public.keeprlink_resource_projection('system_template', coalesce((
        select array_agg(distinct s.system_template_id)
        from system_rows s
        where s.system_template_id is not null
      ), array[]::uuid[]), not p_authorized)
      || public.keeprlink_resource_projection('asset', array[p_asset_id], not p_authorized)
      || public.keeprlink_resource_projection('system', coalesce((
        select array_agg(distinct s.id)
        from system_rows s
      ), array[]::uuid[]), not p_authorized) as resources
  ),
  service_summary as (
    select
      count(*)::integer as total_records,
      count(*) filter (where sr.verification_status = 'verified')::integer as verified_record_count,
      max(sr.performed_at) as recent_service_date
    from public.service_records sr
    where sr.asset_id = p_asset_id
      and coalesce(sr.record_scope, 'current') = 'current'
      and sr.performed_at is not null
  ),
  recent_service_records as (
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', case when p_authorized then sr.id else null end,
      'title', left(coalesce(nullif(sr.title, ''), 'Service record'), case when p_authorized then 700 else 280 end),
      'kind', 'service',
      'service_type', sr.service_type,
      'category', sr.category,
      'performed_at', sr.performed_at,
      'verified', sr.verification_status = 'verified',
      'verification_status', sr.verification_status,
      'system_id', sr.system_id,
      'system_name', s.name,
      'notes', case when p_authorized then left(nullif(sr.notes, ''), 700) else null end,
      'provenance', jsonb_strip_nulls(jsonb_build_object(
        'source_table', 'service_records',
        'source_id', case when p_authorized then sr.id else null end,
        'source_type', sr.source_type,
        'authority_state', case
          when sr.verification_status = 'verified' then 'service_verified'
          else 'source_reported'
        end
      ))
    )) order by sr.performed_at desc nulls last, sr.created_at desc), '[]'::jsonb) as records
    from (
      select *
      from public.service_records
      where asset_id = p_asset_id
        and coalesce(record_scope, 'current') = 'current'
        and performed_at is not null
      order by performed_at desc nulls last, created_at desc
      limit 10
    ) sr
    left join public.systems s on s.id = sr.system_id
  ),
  relationship_rows as (
    select coalesce(jsonb_agg(item order by sort_order, relationship_type), '[]'::jsonb) as relationships
    from (
      select
        1 as sort_order,
        ar.relationship_type,
        jsonb_strip_nulls(jsonb_build_object(
          'relationship_type', ar.relationship_type,
          'status', ar.status,
          'access_scope', case when p_authorized then ar.access_scope else null end,
          'claim_state', case when p_authorized then ar.claim_state else null end,
          'organization', case when o.id is null then null else jsonb_strip_nulls(jsonb_build_object(
            'id', case when p_authorized then o.id else null end,
            'name', o.name,
            'slug', o.slug,
            'organization_type', coalesce(o.organization_type, o.org_type)
          )) end,
          'provider', case when kp.id is null then null else jsonb_strip_nulls(jsonb_build_object(
            'id', case when p_authorized then kp.id else null end,
            'name', coalesce(kp.display_name, kp.name),
            'slug', kp.slug
          )) end,
          'provenance', jsonb_strip_nulls(jsonb_build_object(
            'source_table', 'asset_relationships',
            'source_id', case when p_authorized then ar.id else null end,
            'source_resource_id', case when p_authorized then ar.source_resource_id else null end,
            'initiated_by', case
              when ar.initiated_by_org_id is not null then 'organization'
              when ar.initiated_by_user_id is not null then 'user'
              else null
            end
          ))
        )) as item
      from public.asset_relationships ar
      left join public.orgs o on o.id = ar.organization_id
      left join public.keepr_pros kp on kp.id = ar.keepr_pro_id
      where ar.asset_id = p_asset_id
        and ar.status in ('active', 'claimed', 'accepted', 'pending')
        and (
          p_authorized
          or ar.access_scope in ('public_context', 'service_workspace', 'oem_context')
        )

      union all

      select
        2 as sort_order,
        aps.relationship_type,
        jsonb_strip_nulls(jsonb_build_object(
          'relationship_type', aps.relationship_type,
          'status', aps.status,
          'access_scope', case when p_authorized then aps.access_scope else null end,
          'organization', jsonb_strip_nulls(jsonb_build_object(
            'id', case when p_authorized then o.id else null end,
            'name', o.name,
            'slug', o.slug,
            'organization_type', coalesce(o.organization_type, o.org_type)
          )),
          'provider', jsonb_strip_nulls(jsonb_build_object(
            'id', case when p_authorized then kp.id else null end,
            'name', coalesce(kp.display_name, kp.name),
            'slug', kp.slug
          )),
          'provenance', jsonb_strip_nulls(jsonb_build_object(
            'source_table', 'asset_provider_stewardships',
            'source_id', case when p_authorized then aps.id else null end,
            'authority_state', 'service_verified'
          ))
        )) as item
      from public.asset_provider_stewardships aps
      left join public.orgs o on o.id = aps.organization_id
      left join public.keepr_pros kp on kp.id = aps.keepr_pro_id
      where aps.asset_id = p_asset_id
        and aps.status in ('active', 'pending')
        and (p_authorized or aps.status = 'active')
      limit 20
    ) relationships_union
  ),
  evidence_rows as (
    select coalesce(jsonb_agg(item order by priority, title), '[]'::jsonb) as evidence
    from (
      select
        case lower(coalesce(att.ai_metadata ->> 'ai_context', att.ai_metadata ->> 'context_role', 'off'))
          when 'primary' then 0
          when 'supporting' then 1
          else 9
        end as priority,
        coalesce(nullif(att.title, ''), nullif(ap.label, ''), att.file_name, 'Attachment') as title,
        jsonb_strip_nulls(jsonb_build_object(
          'target_type', ap.target_type,
          'target_id', ap.target_id,
          'target_label', case
            when ap.target_type = 'asset' then a.name
            when ap.target_type = 'system' then s.name
            else null
          end,
          'role', coalesce(nullif(ap.role, ''), att.ai_metadata ->> 'role', att.kind),
          'label', ap.label,
          'is_showcase', ap.is_showcase,
          'attachment', jsonb_strip_nulls(jsonb_build_object(
            'id', case when p_authorized then att.id else null end,
            'title', coalesce(nullif(att.title, ''), nullif(ap.label, ''), att.file_name, 'Attachment'),
            'kind', att.kind,
            'mime_type', case when p_authorized then att.mime_type else null end,
            'ai_context', lower(coalesce(att.ai_metadata ->> 'ai_context', att.ai_metadata ->> 'context_role')),
            'privacy', coalesce(att.ai_metadata ->> 'privacy', att.source_context ->> 'visibility', att.privacy, 'moves_with_asset'),
            'access_mode', case
              when att.url ~* '^https?://'
                and att.url !~* '(/storage/v1/object/sign/|[?&](token|X-Amz-Signature|sig)=)'
                then 'public_url'
              when p_authorized then 'authorized_descriptor'
              else 'public_descriptor'
            end
          )),
          'provenance', jsonb_strip_nulls(jsonb_build_object(
            'source_table', 'attachment_placements',
            'source_id', case when p_authorized then ap.id else null end,
            'attachment_id', case when p_authorized then att.id else null end,
            'authority_state', coalesce(att.source_context ->> 'authority_state', att.ai_metadata ->> 'authority')
          ))
        )) as item
      from public.attachment_placements ap
      join public.attachments att on att.id = ap.attachment_id
      join asset_row a on true
      left join public.systems s on s.id = ap.target_id and ap.target_type = 'system'
      where att.deleted_at is null
        and (
          (ap.target_type = 'asset' and ap.target_id = p_asset_id)
          or (ap.target_type = 'system' and s.asset_id = p_asset_id)
        )
        and (
          p_authorized
          or coalesce(att.ai_metadata ->> 'privacy', att.source_context ->> 'visibility', att.privacy, 'moves_with_asset')
            !~* '^(internal_private|private|restricted|secret)$'
        )
      limit 40
    ) evidence_union
  ),
  binding_rows as (
    select coalesce(jsonb_agg(item order by target_type, target_label, title), '[]'::jsonb) as bindings
    from (
      select
        ap.target_type,
        coalesce(nullif(att.title, ''), nullif(ap.label, ''), att.file_name, 'Attachment') as title,
        case when ap.target_type = 'asset' then a.name when ap.target_type = 'system' then s.name else null end as target_label,
        jsonb_strip_nulls(jsonb_build_object(
          'binding_type', 'attachment_placement',
          'target_type', ap.target_type,
          'target_id', ap.target_id,
          'target_label', case when ap.target_type = 'asset' then a.name when ap.target_type = 'system' then s.name else null end,
          'resource_title', coalesce(nullif(att.title, ''), nullif(ap.label, ''), att.file_name, 'Attachment'),
          'role', coalesce(nullif(ap.role, ''), att.ai_metadata ->> 'role', att.kind),
          'ai_context_role', lower(coalesce(att.ai_metadata ->> 'ai_context', att.ai_metadata ->> 'context_role')),
          'privacy', coalesce(att.ai_metadata ->> 'privacy', att.source_context ->> 'visibility', att.privacy, 'moves_with_asset'),
          'provenance', jsonb_strip_nulls(jsonb_build_object(
            'source_table', 'attachment_placements',
            'source_id', case when p_authorized then ap.id else null end,
            'attachment_id', case when p_authorized then att.id else null end
          ))
        )) as item
      from public.attachment_placements ap
      join public.attachments att on att.id = ap.attachment_id
      join asset_row a on true
      left join public.systems s on s.id = ap.target_id and ap.target_type = 'system'
      where att.deleted_at is null
        and (
          (ap.target_type = 'asset' and ap.target_id = p_asset_id)
          or (ap.target_type = 'system' and s.asset_id = p_asset_id)
        )
        and lower(coalesce(att.ai_metadata ->> 'ai_context', att.ai_metadata ->> 'context_role', 'off'))
          in ('primary', 'supporting')
        and (
          p_authorized
          or coalesce(att.ai_metadata ->> 'privacy', att.source_context ->> 'visibility', att.privacy, 'moves_with_asset')
            !~* '^(internal_private|private|restricted|secret)$'
        )
      limit 80
    ) binding_union
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'object', jsonb_build_object(
      'type', 'asset',
      'id', a.id,
      'address', '/k/' || a.kac_id,
      'kac_id', a.kac_id
    ),
    'identity', jsonb_strip_nulls(jsonb_build_object(
      'kind', 'exact_asset',
      'name', a.name,
      'asset_type', a.type,
      'make', a.make,
      'model', a.model,
      'year', a.year,
      'serial_number', case when p_authorized then a.serial_number else null end,
      'stable_address', '/k/' || a.kac_id
    )),
    'context_summary', jsonb_strip_nulls(jsonb_build_object(
      'context_readiness', case
        when coalesce((select count(*) from system_rows), 0) > 0
          and coalesce(jsonb_array_length((select resources from resource_projection)), 0) > 0
          and coalesce((select total_records from service_summary), 0) > 0
          then 'operational'
        when coalesce((select count(*) from system_rows), 0) > 0
          or coalesce(jsonb_array_length((select resources from resource_projection)), 0) > 0
          then 'partial'
        else 'identity_only'
      end,
      'action_readiness', 'phase_2_not_projected',
      'system_count', (select count(*)::integer from system_rows),
      'system_template_linked_count', (select count(*)::integer from system_rows where system_template_id is not null),
      'resource_count', coalesce(jsonb_array_length((select resources from resource_projection)), 0),
      'evidence_placement_count', coalesce(jsonb_array_length((select evidence from evidence_rows)), 0),
      'service_record_count', coalesce((select total_records from service_summary), 0),
      'verified_service_record_count', coalesce((select verified_record_count from service_summary), 0),
      'recent_service_date', (select recent_service_date from service_summary),
      'provider_relationships_present', coalesce(jsonb_array_length((select relationships from relationship_rows)), 0) > 0,
      'unresolved_gap_count', coalesce(jsonb_array_length(coalesce(a.extra_metadata -> 'knowledge_gaps', '[]'::jsonb)), 0)
        + (select count(*)::integer from system_rows where system_template_id is null),
      'attention', (
        select coalesce(jsonb_agg(attention), '[]'::jsonb)
        from (
          select jsonb_build_object(
            'type', 'missing_system_template',
            'message', 'One or more systems are not linked to a canonical System Template.',
            'source', 'systems',
            'count', count(*)::integer
          ) as attention
          from system_rows
          where system_template_id is null
          having count(*) > 0
          union all
          select jsonb_build_object(
            'type', 'missing_service_history',
            'message', 'No current service history is projected for this asset.',
            'source', 'service_records'
          )
          where coalesce((select total_records from service_summary), 0) = 0
        ) attention_rows
        limit 8
      )
    )),
    'parent_relationships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', 'model_template',
        'binding_status', b.binding_status,
        'binding_source', b.binding_source,
        'confidence', b.confidence,
        'address', '/k/' || t.template_key,
        'template', jsonb_build_object(
          'id', t.id,
          'template_key', t.template_key,
          'manufacturer', t.manufacturer,
          'model', t.model,
          'model_year', t.model_year,
          'authority_state', t.authority_state
        )
      ) order by b.created_at desc)
      from public.asset_template_bindings b
      join public.asset_model_templates t on t.id = b.template_id
      where b.asset_id = a.id
        and b.binding_status in ('suggested', 'inherited', 'verified')
    ), '[]'::jsonb),
    'relationships', (select relationships from relationship_rows),
    'systems', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', s.id,
        'address', '/k/' || a.kac_id || '?systemId=' || s.id,
        'name', s.name,
        'system_type', s.system_type,
        'ksc_code', s.ksc_code,
        'status', s.status,
        'system_template_id', s.system_template_id,
        'system_template', case when s.system_template_id is null then null else jsonb_build_object(
          'id', s.system_template_id,
          'address', '/k/' || public.keeprlink_slugify(coalesce(s.template_manufacturer || ' ', '') || s.template_name),
          'canonical_key', s.template_canonical_key,
          'name', s.template_name,
          'manufacturer', s.template_manufacturer,
          'supplier_org_id', s.template_supplier_org_id,
          'authority_state', s.template_authority_state
        ) end,
        'facts', jsonb_strip_nulls(jsonb_build_object(
          'manufacturer', s.normalized_manufacturer,
          'model', s.normalized_model,
          'serial_number', case when p_authorized then s.normalized_serial_number else null end,
          'location', case when p_authorized then s.normalized_location else null end,
          'installed_on', case when p_authorized then s.normalized_installed_on else null end,
          'mode', s.mode,
          'lifecycle_status', s.lifecycle_status,
          'lifecycle_phase', s.lifecycle_phase,
          'last_service_date', s.last_service_date,
          'next_service_date', s.next_service_date,
          'interval_months', s.interval_months,
          'interval_hours', s.interval_hours
        )),
        'claims', (
          select coalesce(jsonb_agg(claim), '[]'::jsonb)
          from (
            select jsonb_build_object(
              'claim_type', 'missing_canonical_system_template',
              'claim', 'This installed system is not linked to a canonical System Template.',
              'status', 'needs_review',
              'reason', 'systems.system_template_id is null',
              'source_table', 'systems',
              'source_id', case when p_authorized then s.id else null end,
              'confidence', 'high',
              'authority_state', 'resolver_check'
            ) as claim
            where s.system_template_id is null
            union all
            select jsonb_build_object(
              'claim_type', 'has_ai_context_resources',
              'claim', 'This system has AI-context resources or evidence associated with it.',
              'status', 'established',
              'reason', 'AI-enabled resources or placements target this system.',
              'source_table', 'attachment_placements',
              'source_id', null,
              'confidence', 'high',
              'authority_state', 'evidence_verified'
            )
            where s.resource_count > 0
          ) claim_rows
          limit 5
        ),
        'provider_relationships', (
          select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'relationship_type', 'system_keepr_pro',
            'status', 'active',
            'provider', jsonb_strip_nulls(jsonb_build_object(
              'id', case when p_authorized then kp.id else null end,
              'name', coalesce(kp.display_name, kp.name),
              'slug', kp.slug
            )),
            'provenance', jsonb_strip_nulls(jsonb_build_object(
              'source_table', 'systems',
              'source_id', case when p_authorized then s.id else null end,
              'source_path', 'systems.metadata.standard.relationships.keepr_pro_ids'
            ))
          )) order by coalesce(kp.display_name, kp.name, kp_id.value)), '[]'::jsonb)
          from jsonb_array_elements_text(coalesce(
            s.metadata #> '{standard,relationships,keepr_pro_ids}',
            s.metadata #> '{relationships,keepr_pro_ids}',
            '[]'::jsonb
          )) as kp_id(value)
          left join public.keepr_pros kp on kp.id::text = kp_id.value
          limit 10
        ),
        'resource_bindings', (
          select coalesce(jsonb_agg(item order by priority, resource_title), '[]'::jsonb)
          from (
            select
              case lower(coalesce(att.ai_metadata ->> 'ai_context', att.ai_metadata ->> 'context_role', 'off'))
                when 'primary' then 0
                when 'supporting' then 1
                else 9
              end as priority,
              coalesce(nullif(att.title, ''), nullif(ap.label, ''), att.file_name, 'Attachment') as resource_title,
              jsonb_strip_nulls(jsonb_build_object(
                'binding_type', 'attachment_placement',
                'target_type', 'system',
                'target_label', s.name,
                'resource_title', coalesce(nullif(att.title, ''), nullif(ap.label, ''), att.file_name, 'Attachment'),
                'role', coalesce(nullif(ap.role, ''), att.ai_metadata ->> 'role', att.kind),
                'ai_context_role', lower(coalesce(att.ai_metadata ->> 'ai_context', att.ai_metadata ->> 'context_role')),
                'privacy', coalesce(att.ai_metadata ->> 'privacy', att.source_context ->> 'visibility', att.privacy, 'moves_with_asset'),
                'provenance', jsonb_strip_nulls(jsonb_build_object(
                  'source_table', 'attachment_placements',
                  'source_id', case when p_authorized then ap.id else null end,
                  'attachment_id', case when p_authorized then att.id else null end
                ))
              )) as item
            from public.attachment_placements ap
            join public.attachments att on att.id = ap.attachment_id
            where ap.target_type = 'system'
              and ap.target_id = s.id
              and att.deleted_at is null
              and lower(coalesce(att.ai_metadata ->> 'ai_context', att.ai_metadata ->> 'context_role', 'off'))
                in ('primary', 'supporting')
              and (
                p_authorized
                or coalesce(att.ai_metadata ->> 'privacy', att.source_context ->> 'visibility', att.privacy, 'moves_with_asset')
                  !~* '^(internal_private|private|restricted|secret)$'
              )
            limit 10
          ) system_resource_union
        ),
        'evidence_summary', jsonb_build_object(
          'total_count', s.evidence_count,
          'ai_context_resource_count', s.resource_count,
          'recent', (
            select coalesce(jsonb_agg(item order by created_at desc nulls last, title), '[]'::jsonb)
            from (
              select
                ap.created_at,
                coalesce(nullif(att.title, ''), nullif(ap.label, ''), att.file_name, 'Attachment') as title,
                jsonb_strip_nulls(jsonb_build_object(
                  'target_type', 'system',
                  'target_label', s.name,
                  'role', coalesce(nullif(ap.role, ''), att.ai_metadata ->> 'role', att.kind),
                  'label', ap.label,
                  'attachment', jsonb_strip_nulls(jsonb_build_object(
                    'id', case when p_authorized then att.id else null end,
                    'title', coalesce(nullif(att.title, ''), nullif(ap.label, ''), att.file_name, 'Attachment'),
                    'kind', att.kind,
                    'ai_context', lower(coalesce(att.ai_metadata ->> 'ai_context', att.ai_metadata ->> 'context_role')),
                    'privacy', coalesce(att.ai_metadata ->> 'privacy', att.source_context ->> 'visibility', att.privacy, 'moves_with_asset'),
                    'access_mode', case
                      when att.url ~* '^https?://'
                        and att.url !~* '(/storage/v1/object/sign/|[?&](token|X-Amz-Signature|sig)=)'
                        then 'public_url'
                      when p_authorized then 'authorized_descriptor'
                      else 'public_descriptor'
                    end
                  )),
                  'provenance', jsonb_strip_nulls(jsonb_build_object(
                    'source_table', 'attachment_placements',
                    'source_id', case when p_authorized then ap.id else null end,
                    'attachment_id', case when p_authorized then att.id else null end
                  ))
                )) as item
              from public.attachment_placements ap
              join public.attachments att on att.id = ap.attachment_id
              where ap.target_type = 'system'
                and ap.target_id = s.id
                and att.deleted_at is null
                and (
                  p_authorized
                  or coalesce(att.ai_metadata ->> 'privacy', att.source_context ->> 'visibility', att.privacy, 'moves_with_asset')
                    !~* '^(internal_private|private|restricted|secret)$'
                )
              order by ap.created_at desc nulls last
              limit 8
            ) system_evidence_union
          )
        ),
        'operational_history', jsonb_strip_nulls(jsonb_build_object(
          'summary', jsonb_strip_nulls(jsonb_build_object(
            'total_records', (
              select count(*)::integer
              from public.service_records sr
              where sr.system_id = s.id
                and coalesce(sr.record_scope, 'current') = 'current'
                and sr.performed_at is not null
            ),
            'verified_record_count', (
              select count(*)::integer
              from public.service_records sr
              where sr.system_id = s.id
                and coalesce(sr.record_scope, 'current') = 'current'
                and sr.performed_at is not null
                and sr.verification_status = 'verified'
            ),
            'recent_service_date', (
              select max(sr.performed_at)
              from public.service_records sr
              where sr.system_id = s.id
                and coalesce(sr.record_scope, 'current') = 'current'
                and sr.performed_at is not null
            ),
            'recent_limit', 5
          )),
          'recent', (
            select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', case when p_authorized then sr.id else null end,
              'title', left(coalesce(nullif(sr.title, ''), 'Service record'), case when p_authorized then 700 else 280 end),
              'kind', 'service',
              'service_type', sr.service_type,
              'category', sr.category,
              'performed_at', sr.performed_at,
              'verified', sr.verification_status = 'verified',
              'verification_status', sr.verification_status,
              'notes', case when p_authorized then left(nullif(sr.notes, ''), 700) else null end,
              'provenance', jsonb_strip_nulls(jsonb_build_object(
                'source_table', 'service_records',
                'source_id', case when p_authorized then sr.id else null end,
                'source_type', sr.source_type,
                'authority_state', case
                  when sr.verification_status = 'verified' then 'service_verified'
                  else 'source_reported'
                end
              ))
            )) order by sr.performed_at desc nulls last, sr.created_at desc), '[]'::jsonb)
            from (
              select *
              from public.service_records
              where system_id = s.id
                and coalesce(record_scope, 'current') = 'current'
                and performed_at is not null
              order by performed_at desc nulls last, created_at desc
              limit 5
            ) sr
          )
        )),
        'resource_count', s.resource_count,
        'evidence_count', s.evidence_count,
        'open_action_count', null,
        'applicable_playbook_count', null
      )) order by s.name)
      from system_rows s
    ), '[]'::jsonb),
    'applicable_resources', (select resources from resource_projection),
    'resource_bindings', (select bindings from binding_rows),
    'evidence_placements', (select evidence from evidence_rows),
    'operational_history', jsonb_strip_nulls(jsonb_build_object(
      'summary', jsonb_strip_nulls(jsonb_build_object(
        'total_records', coalesce((select total_records from service_summary), 0),
        'verified_record_count', coalesce((select verified_record_count from service_summary), 0),
        'recent_service_date', (select recent_service_date from service_summary),
        'recent_limit', 10
      )),
      'recent', (select records from recent_service_records)
    )),
    'known_operational_state', jsonb_strip_nulls(jsonb_build_object(
      'status', a.status,
      'operating_states', a.extra_metadata -> 'operating_states',
      'factory_confirmed', a.extra_metadata -> 'factory_confirmed'
    )),
    'knowledge_gaps', coalesce(a.extra_metadata -> 'knowledge_gaps', '[]'::jsonb),
    'job_readiness', '[]'::jsonb,
    'v2_contract', jsonb_build_object(
      'phase', 'phase_1',
      'actions_projected', false,
      'playbook_applicability_projected', false,
      'caps', jsonb_build_object(
        'operational_history_recent', 10,
        'evidence_placements', 40,
        'resource_bindings', 80,
        'system_claims_per_system', 5
      )
    )
  ))
  from asset_row a;
$$;

grant execute on function public.keeprlink_asset_context(uuid, text, boolean) to service_role;

comment on function public.keeprlink_asset_context(uuid, text, boolean) is
  'KeeprLINK exact-asset context v2 phase 1: preserves v1 identity/resources while adding bounded operational history, relationships, richer system facts, evidence summaries, and resource bindings.';

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
      'manifest_version', case
        when v_object_type = 'asset' and v_context ? 'v2_contract' then 'keepr.link.context.v2'
        else 'keepr.link.context.v1'
      end,
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

grant execute on function public.resolve_keeprlink_context(text, text, uuid, boolean) to anon, authenticated, service_role;

comment on function public.resolve_keeprlink_context(text, text, uuid, boolean) is
  'Resolves a KeeprLINK to purpose-scoped context; exact asset projections that carry v2_contract report the v2 manifest while other object projections preserve v1.';
