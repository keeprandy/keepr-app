-- Generic exact-build draft primitives.
-- Stores one hull's mutable selection/state against a reusable model template.
-- Factory evidence remains in factory_build_* tables; this is draft work product.

create table if not exists public.exact_build_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.orgs(id) on delete restrict,
  template_id uuid not null references public.asset_model_templates(id) on delete restrict,
  asset_id uuid references public.assets(id) on delete set null,
  draft_key text not null,
  display_name text not null,
  status text not null default 'draft',
  source_type text not null default 'manual',
  source_resource_id uuid references public.asset_resources(id) on delete set null,
  work_order_number text,
  hin text,
  build_year integer,
  dealer_name text,
  customer_name text,
  build_date date,
  expected_completion_date date,
  identity jsonb not null default '{}'::jsonb,
  finish_selections jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint exact_build_drafts_status_check
    check (status in ('draft', 'in_review', 'factory_frozen', 'published', 'retired')),
  constraint exact_build_drafts_source_type_check
    check (source_type in ('manual', 'build_sheet', 'factory_work_order', 'csv', 'api', 'llm_proposed'))
);

create unique index if not exists exact_build_drafts_org_key_uidx
  on public.exact_build_drafts (organization_id, lower(draft_key));

create index if not exists exact_build_drafts_org_status_idx
  on public.exact_build_drafts (organization_id, status, updated_at desc);

create index if not exists exact_build_drafts_template_idx
  on public.exact_build_drafts (template_id, status, updated_at desc);

create table if not exists public.exact_build_draft_items (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.exact_build_drafts(id) on delete cascade,
  template_item_id uuid references public.asset_model_template_items(id) on delete set null,
  item_key text not null,
  state text not null default 'unselected',
  quantity numeric,
  value jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exact_build_draft_items_state_check
    check (state in ('selected', 'unselected', 'overridden', 'unknown'))
);

create unique index if not exists exact_build_draft_items_template_item_uidx
  on public.exact_build_draft_items (draft_id, template_item_id)
  where template_item_id is not null;

create unique index if not exists exact_build_draft_items_key_uidx
  on public.exact_build_draft_items (draft_id, lower(item_key));

create index if not exists exact_build_draft_items_draft_idx
  on public.exact_build_draft_items (draft_id, state);

alter table public.exact_build_drafts enable row level security;
alter table public.exact_build_draft_items enable row level security;

drop policy if exists "Exact build drafts are readable by org members" on public.exact_build_drafts;
create policy "Exact build drafts are readable by org members"
  on public.exact_build_drafts
  for select
  to authenticated
  using (public.activator_user_can_act_for_org(auth.uid(), organization_id));

drop policy if exists "Exact build drafts are manageable by org members" on public.exact_build_drafts;
create policy "Exact build drafts are manageable by org members"
  on public.exact_build_drafts
  for all
  to authenticated
  using (public.activator_user_can_act_for_org(auth.uid(), organization_id))
  with check (public.activator_user_can_act_for_org(auth.uid(), organization_id));

drop policy if exists "Exact build draft items are readable by org members" on public.exact_build_draft_items;
create policy "Exact build draft items are readable by org members"
  on public.exact_build_draft_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.exact_build_drafts d
      where d.id = draft_id
        and public.activator_user_can_act_for_org(auth.uid(), d.organization_id)
    )
  );

drop policy if exists "Exact build draft items are manageable by org members" on public.exact_build_draft_items;
create policy "Exact build draft items are manageable by org members"
  on public.exact_build_draft_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.exact_build_drafts d
      where d.id = draft_id
        and public.activator_user_can_act_for_org(auth.uid(), d.organization_id)
    )
  )
  with check (
    exists (
      select 1
      from public.exact_build_drafts d
      where d.id = draft_id
        and public.activator_user_can_act_for_org(auth.uid(), d.organization_id)
    )
  );

create or replace function public.exact_build_draft_payload(p_draft_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'draft', to_jsonb(d),
    'template', to_jsonb(t),
    'items', coalesce((
      select jsonb_agg(to_jsonb(di) order by di.created_at asc)
      from public.exact_build_draft_items di
      where di.draft_id = d.id
    ), '[]'::jsonb)
  )
  from public.exact_build_drafts d
  join public.asset_model_templates t
    on t.id = d.template_id
  where d.id = p_draft_id
    and public.activator_user_can_act_for_org(auth.uid(), d.organization_id);
$$;

create or replace function public.get_exact_build_draft(
  p_draft_id uuid default null,
  p_draft_key text default null,
  p_template_key text default null,
  p_organization_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft_id uuid := p_draft_id;
begin
  if v_draft_id is null then
    select d.id
    into v_draft_id
    from public.exact_build_drafts d
    join public.asset_model_templates t
      on t.id = d.template_id
    where (p_organization_id is null or d.organization_id = p_organization_id)
      and (nullif(trim(coalesce(p_draft_key, '')), '') is null or lower(d.draft_key) = lower(trim(p_draft_key)))
      and (nullif(trim(coalesce(p_template_key, '')), '') is null or lower(t.template_key) = lower(trim(p_template_key)))
      and d.status <> 'retired'
      and public.activator_user_can_act_for_org(auth.uid(), d.organization_id)
    order by d.updated_at desc
    limit 1;
  end if;

  if v_draft_id is null then
    return null;
  end if;

  return public.exact_build_draft_payload(v_draft_id);
end;
$$;

create or replace function public.upsert_exact_build_draft(
  p_organization_id uuid,
  p_template_key text,
  p_draft_id uuid default null,
  p_draft_key text default null,
  p_display_name text default null,
  p_identity jsonb default '{}'::jsonb,
  p_finish_selections jsonb default '[]'::jsonb,
  p_items jsonb default '[]'::jsonb,
  p_status text default 'draft',
  p_source_resource_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.asset_model_templates%rowtype;
  v_draft public.exact_build_drafts%rowtype;
  v_draft_key text;
  v_identity jsonb := coalesce(p_identity, '{}'::jsonb);
  v_item jsonb;
  v_template_item_id uuid;
  v_item_key text;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if not public.activator_user_can_act_for_org(auth.uid(), p_organization_id) then
    raise exception 'not allowed to manage exact build drafts for this organization';
  end if;

  select *
  into v_template
  from public.asset_model_templates
  where lower(template_key) = lower(trim(p_template_key))
    and organization_id = p_organization_id
    and status <> 'retired'
  order by version desc
  limit 1;

  if v_template.id is null then
    raise exception 'template not found';
  end if;

  v_draft_key := coalesce(
    nullif(trim(p_draft_key), ''),
    nullif(trim(v_identity ->> 'buildNumber'), ''),
    nullif(trim(v_identity ->> 'workOrderNumber'), ''),
    lower(v_template.template_key) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
  );

  insert into public.exact_build_drafts (
    id,
    organization_id,
    template_id,
    draft_key,
    display_name,
    status,
    source_type,
    source_resource_id,
    work_order_number,
    hin,
    build_year,
    dealer_name,
    customer_name,
    build_date,
    expected_completion_date,
    identity,
    finish_selections,
    metadata,
    created_by,
    updated_at
  )
  values (
    coalesce(p_draft_id, gen_random_uuid()),
    p_organization_id,
    v_template.id,
    v_draft_key,
    coalesce(nullif(trim(p_display_name), ''), concat_ws(' · ', nullif(v_identity ->> 'buildNumber', ''), v_template.model, 'Draft')),
    coalesce(nullif(trim(p_status), ''), 'draft'),
    coalesce(nullif(trim(v_identity ->> 'sourceType'), ''), 'manual'),
    p_source_resource_id,
    nullif(trim(coalesce(v_identity ->> 'workOrderNumber', v_identity ->> 'buildNumber', '')), ''),
    nullif(trim(coalesce(v_identity ->> 'hin', '')), ''),
    nullif(trim(coalesce(v_identity ->> 'buildYear', '')), '')::integer,
    nullif(trim(coalesce(v_identity ->> 'dealer', '')), ''),
    nullif(trim(coalesce(v_identity ->> 'customer', '')), ''),
    nullif(trim(coalesce(v_identity ->> 'buildDate', '')), '')::date,
    nullif(trim(coalesce(v_identity ->> 'expectedCompletionDate', '')), '')::date,
    v_identity,
    coalesce(p_finish_selections, '[]'::jsonb),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'saved_by', auth.uid(),
      'saved_at', now(),
      'template_key', v_template.template_key
    ),
    auth.uid(),
    now()
  )
  on conflict (organization_id, lower(draft_key))
  do update set
    display_name = excluded.display_name,
    status = excluded.status,
    source_resource_id = excluded.source_resource_id,
    work_order_number = excluded.work_order_number,
    hin = excluded.hin,
    build_year = excluded.build_year,
    dealer_name = excluded.dealer_name,
    customer_name = excluded.customer_name,
    build_date = excluded.build_date,
    expected_completion_date = excluded.expected_completion_date,
    identity = excluded.identity,
    finish_selections = excluded.finish_selections,
    metadata = public.exact_build_drafts.metadata || excluded.metadata,
    updated_at = now()
  returning * into v_draft;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_template_item_id := nullif(v_item ->> 'templateItemId', '')::uuid;
    v_item_key := coalesce(nullif(v_item ->> 'itemKey', ''), nullif(v_item ->> 'key', ''), v_template_item_id::text);

    if v_item_key is not null then
      insert into public.exact_build_draft_items (
        draft_id,
        template_item_id,
        item_key,
        state,
        quantity,
        value,
        provenance,
        notes,
        metadata,
        updated_at
      )
      values (
        v_draft.id,
        v_template_item_id,
        v_item_key,
        coalesce(nullif(v_item ->> 'state', ''), case when coalesce((v_item ->> 'selected')::boolean, false) then 'selected' else 'unselected' end),
        nullif(v_item ->> 'quantity', '')::numeric,
        coalesce(v_item -> 'value', '{}'::jsonb),
        coalesce(v_item -> 'provenance', '{}'::jsonb),
        nullif(v_item ->> 'notes', ''),
        coalesce(v_item -> 'metadata', '{}'::jsonb),
        now()
      )
      on conflict (draft_id, lower(item_key))
      do update set
        template_item_id = excluded.template_item_id,
        state = excluded.state,
        quantity = excluded.quantity,
        value = excluded.value,
        provenance = excluded.provenance,
        notes = excluded.notes,
        metadata = public.exact_build_draft_items.metadata || excluded.metadata,
        updated_at = now();
    end if;
  end loop;

  return public.exact_build_draft_payload(v_draft.id);
end;
$$;

create or replace function public.get_exact_build_work_queue(
  p_organization_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'draft_key', d.draft_key,
    'display_name', d.display_name,
    'status', d.status,
    'template_id', t.id,
    'template_key', t.template_key,
    'model', concat_ws(' ', 'MY' || t.model_year::text, t.manufacturer, t.model),
    'identifier', concat_ws(' · ', nullif(d.hin, ''), nullif(d.work_order_number, ''), nullif(d.dealer_name, '')),
    'updated_at', d.updated_at,
    'selected_count', (
      select count(*)
      from public.exact_build_draft_items di
      where di.draft_id = d.id
        and di.state in ('selected', 'overridden')
    )
  ) order by d.updated_at desc), '[]'::jsonb)
  from public.exact_build_drafts d
  join public.asset_model_templates t
    on t.id = d.template_id
  where d.organization_id = p_organization_id
    and d.status in ('draft', 'in_review', 'factory_frozen')
    and public.activator_user_can_act_for_org(auth.uid(), d.organization_id);
$$;

create or replace function public.publish_exact_build_draft(
  p_draft_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.exact_build_drafts%rowtype;
  v_template public.asset_model_templates%rowtype;
  v_created jsonb;
  v_asset_id uuid;
  v_kac text;
begin
  select *
  into v_draft
  from public.exact_build_drafts
  where id = p_draft_id
  limit 1;

  if v_draft.id is null then
    raise exception 'draft not found';
  end if;

  if not public.activator_user_can_act_for_org(auth.uid(), v_draft.organization_id) then
    raise exception 'not allowed to publish this exact build draft';
  end if;

  select *
  into v_template
  from public.asset_model_templates
  where id = v_draft.template_id
  limit 1;

  v_created := public.create_keeprspace_boat(
    v_draft.organization_id,
    jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(nullif(v_draft.identity ->> 'boatName', ''), concat_ws(' · ', nullif(v_draft.draft_key, ''), v_template.manufacturer || ' ' || v_template.model)),
      'year', coalesce(v_draft.build_year, v_template.model_year),
      'make', v_template.manufacturer,
      'model', v_template.model,
      'serial_number', nullif(v_draft.hin, ''),
      'hin', nullif(v_draft.hin, ''),
      'location', nullif(v_draft.identity ->> 'location', ''),
      'dealer', nullif(v_draft.dealer_name, ''),
      'catalog_template_id', v_template.id,
      'catalog_template_key', v_template.template_key,
      'source', 'exact_build_draft',
      'exact_build_draft_id', v_draft.id,
      'exact_build_draft_key', v_draft.draft_key
    )),
    'oem_context',
    array['in_build', 'factory_frozen'],
    jsonb_build_object(
      'source', 'exact_build_draft_publish',
      'exact_build_draft_id', v_draft.id,
      'template_id', v_template.id,
      'template_key', v_template.template_key
    )
  );

  v_asset_id := nullif(v_created ->> 'asset_id', '')::uuid;
  v_kac := nullif(v_created ->> 'kac_id', '');

  if v_asset_id is null then
    v_asset_id := nullif(v_created #>> '{asset,id}', '')::uuid;
  end if;

  if v_asset_id is not null then
    insert into public.asset_template_bindings (
      asset_id,
      template_id,
      template_version,
      binding_status,
      binding_source,
      confidence,
      source_resource_id,
      created_by,
      metadata
    )
    values (
      v_asset_id,
      v_template.id,
      v_template.version,
      'verified',
      'oem',
      0.9000,
      v_draft.source_resource_id,
      auth.uid(),
      jsonb_build_object(
        'source', 'exact_build_draft_publish',
        'exact_build_draft_id', v_draft.id,
        'draft_key', v_draft.draft_key
      )
    )
    on conflict do nothing;
  end if;

  update public.exact_build_drafts
  set status = 'published',
      asset_id = v_asset_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'published_by', auth.uid(),
        'published_at', now(),
        'published_asset_id', v_asset_id,
        'published_kac', v_kac
      ),
      published_at = now(),
      updated_at = now()
  where id = v_draft.id
  returning * into v_draft;

  return public.exact_build_draft_payload(v_draft.id) || jsonb_build_object(
    'asset_id', v_asset_id,
    'kac_id', v_kac,
    'created_asset', coalesce((v_created ->> 'created_asset')::boolean, false)
  );
end;
$$;

grant execute on function public.get_exact_build_draft(uuid, text, text, uuid) to authenticated;
grant execute on function public.upsert_exact_build_draft(uuid, text, uuid, text, text, jsonb, jsonb, jsonb, text, uuid, jsonb) to authenticated;
grant execute on function public.get_exact_build_work_queue(uuid) to authenticated;
grant execute on function public.publish_exact_build_draft(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
