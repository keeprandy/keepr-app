-- Tiara KF018 factory work-order ingestion.
--
-- Staging-first pattern:
-- Tiara Work Order -> Exact Build Metadata -> Systems Graph -> Source Queue.
--
-- The work-order line remains authoritative factory evidence. Normalized Keepr
-- mapping lives beside, never instead of, Tiara item codes/descriptions.

create table if not exists public.factory_build_documents (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_document text not null,
  source_role text not null default 'factory_build_truth',
  manufacturer text not null,
  asset_id uuid references public.assets(id) on delete cascade,
  catalog_template_key text,
  exact_build_key text,
  order_number text,
  order_date date,
  hull_number text,
  hin text,
  completion_date date,
  raw_metadata jsonb not null default '{}'::jsonb,
  normalized_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_build_documents_source_type_check
    check (source_type in ('tiara_work_order')),
  constraint factory_build_documents_source_role_check
    check (source_role in ('factory_build_truth'))
);

create unique index if not exists factory_build_documents_source_uidx
  on public.factory_build_documents (source_type, order_number, hull_number);

create index if not exists factory_build_documents_asset_idx
  on public.factory_build_documents (asset_id)
  where asset_id is not null;

create table if not exists public.factory_build_line_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.factory_build_documents(id) on delete cascade,
  line_number integer not null,
  source_type text not null default 'tiara_work_order',
  source_document text not null,
  order_number text,
  order_date date,
  hull_number text,
  hin text,
  completion_date date,
  factory_item_code text,
  factory_description text not null,
  quantity numeric,
  factory_section text,
  raw_source_text text,
  normalized_name text,
  system_category text,
  system_id uuid references public.systems(id) on delete set null,
  component_id uuid,
  manufacturer text,
  model text,
  product_family text,
  relationship_type text not null,
  mapping_status text not null,
  mapping_confidence numeric(5,4) not null default 0,
  mapping_method text not null,
  source_role text not null default 'factory_build_truth',
  factory_confirmed boolean not null default true,
  manual_status text,
  owner_manual uuid references public.asset_resources(id) on delete set null,
  service_manual uuid references public.asset_resources(id) on delete set null,
  installation_manual uuid references public.asset_resources(id) on delete set null,
  warranty_source uuid references public.asset_resources(id) on delete set null,
  mapping_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_build_line_items_relationship_check
    check (relationship_type in ('system', 'component', 'option', 'configuration', 'build_only')),
  constraint factory_build_line_items_mapping_status_check
    check (mapping_status in ('mapped', 'partially_mapped', 'unmapped', 'needs_review')),
  constraint factory_build_line_items_mapping_method_check
    check (mapping_method in ('exact_catalog_match', 'alias_match', 'rules', 'ai_assisted', 'manual')),
  constraint factory_build_line_items_manual_status_check
    check (manual_status is null or manual_status in ('found', 'missing', 'needs_exact_model')),
  constraint factory_build_line_items_confidence_check
    check (mapping_confidence >= 0 and mapping_confidence <= 1)
);

create unique index if not exists factory_build_line_items_doc_line_uidx
  on public.factory_build_line_items (document_id, line_number);

create index if not exists factory_build_line_items_system_idx
  on public.factory_build_line_items (system_id)
  where system_id is not null;

create index if not exists factory_build_line_items_review_idx
  on public.factory_build_line_items (document_id, mapping_status, manual_status);

comment on table public.factory_build_line_items is
  'Preserved factory build evidence plus normalized Keepr system/component/option mapping. Never overwrite Tiara item code or original factory description during normalization.';

create or replace function public.get_tiara_factory_build_workspace(
  p_hull_number text default null,
  p_template_key text default null,
  p_build_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.factory_build_documents%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_systems jsonb := '[]'::jsonb;
  v_manual_queue jsonb := '[]'::jsonb;
begin
  select *
    into v_doc
  from public.factory_build_documents d
  where (p_template_key is null or lower(d.catalog_template_key) = lower(p_template_key))
    and (
      p_build_key is null
      or lower(d.exact_build_key) = lower(p_build_key)
      or lower(d.raw_metadata ->> 'build_code') = lower(p_build_key)
    )
    and (
      p_hull_number is null
      or upper(d.hull_number) = upper(p_hull_number)
      or upper(d.hin) = upper(p_hull_number)
    )
  order by d.created_at desc
  limit 1;

  if v_doc.id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(to_jsonb(li) order by li.line_number), '[]'::jsonb)
    into v_lines
  from public.factory_build_line_items li
  where li.document_id = v_doc.id;

  select coalesce(jsonb_agg(system_row order by system_row ->> 'system_category'), '[]'::jsonb)
    into v_systems
  from (
    select jsonb_build_object(
      'system_id', coalesce(li.system_id::text, li.mapping_metadata ->> 'stable_system_id'),
      'name', case
        when li.system_category = 'Generator / AC Power' then 'Generator'
        else li.system_category
      end,
      'system_category', li.system_category,
      'factory_confirmed', bool_or(li.factory_confirmed),
      'manual_status', case
        when bool_or(li.manual_status = 'needs_exact_model') then 'needs_exact_model'
        when bool_or(li.manual_status = 'missing') then 'missing'
        else 'found'
      end,
      'evidence_line_ids', jsonb_agg(li.id order by li.line_number)
    ) as system_row
    from public.factory_build_line_items li
    where li.document_id = v_doc.id
      and li.relationship_type in ('system', 'component', 'option')
      and li.system_category is not null
    group by coalesce(li.system_id::text, li.mapping_metadata ->> 'stable_system_id'), li.system_category
  ) s;

  select coalesce(jsonb_agg(queue_row order by queue_row ->> 'system_category'), '[]'::jsonb)
    into v_manual_queue
  from (
    select jsonb_build_object(
      'system_id', coalesce(li.system_id::text, li.mapping_metadata ->> 'stable_system_id'),
      'system_category', li.system_category,
      'normalized_name', case
        when li.system_category = 'Generator / AC Power' then 'Generator'
        else li.system_category
      end,
      'manual_status', case
        when bool_or(li.manual_status = 'needs_exact_model') then 'needs_exact_model'
        else 'missing'
      end,
      'factory_confirmed', true,
      'missing_sources', jsonb_build_array('owner_manual', 'service_manual', 'installation_manual', 'warranty_source'),
      'evidence_lines', jsonb_agg(jsonb_build_object(
        'id', li.id,
        'factory_item_code', li.factory_item_code,
        'factory_description', li.factory_description,
        'relationship_type', li.relationship_type
      ) order by li.line_number)
    ) as queue_row
    from public.factory_build_line_items li
    where li.document_id = v_doc.id
      and li.relationship_type in ('system', 'component')
      and li.manual_status in ('missing', 'needs_exact_model')
    group by coalesce(li.system_id::text, li.mapping_metadata ->> 'stable_system_id'), li.system_category
  ) q;

  return jsonb_build_object(
    'work_order', to_jsonb(v_doc),
    'line_items', v_lines,
    'systems', v_systems,
    'manual_queue', v_manual_queue
  );
end;
$$;

create or replace function public.get_tiara_factory_build_workspace(p_hull_number text default 'SSUKF018H627')
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.get_tiara_factory_build_workspace(p_hull_number, null, null);
$$;

grant execute on function public.get_tiara_factory_build_workspace(text) to authenticated, service_role;
grant execute on function public.get_tiara_factory_build_workspace(text, text, text) to authenticated, service_role;
