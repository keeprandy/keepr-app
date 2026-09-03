-- Introduce canonical System Template references behind the existing Model Item
-- UI. This is a reference/inheritance layer only: unresolved model items and
-- existing exact systems continue to work as-is.

create table if not exists public.system_templates (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null,
  name text not null,
  manufacturer text,
  supplier_org_id uuid references public.orgs(id) on delete set null,
  owner_org_id uuid references public.orgs(id) on delete set null,
  system_category text,
  description text,
  authority_state text not null default 'keepr_curated',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_templates_key_uidx unique (canonical_key),
  constraint system_templates_authority_check check (
    authority_state = any (
      array[
        'draft'::text,
        'keepr_curated'::text,
        'supplier_verified'::text,
        'oem_verified'::text,
        'official'::text,
        'retired'::text
      ]
    )
  )
);

create index if not exists system_templates_owner_org_idx
  on public.system_templates (owner_org_id);

create index if not exists system_templates_supplier_org_idx
  on public.system_templates (supplier_org_id);

alter table public.system_templates enable row level security;

drop policy if exists "Readable system templates" on public.system_templates;
create policy "Readable system templates"
on public.system_templates
for select
to authenticated
using (
  authority_state <> 'retired'
  or (
    owner_org_id is not null
    and public.activator_user_can_act_for_org(auth.uid(), owner_org_id)
  )
);

drop policy if exists "Owner org manages system templates" on public.system_templates;
create policy "Owner org manages system templates"
on public.system_templates
for all
to authenticated
using (
  owner_org_id is not null
  and public.activator_user_can_act_for_org(auth.uid(), owner_org_id)
)
with check (
  owner_org_id is not null
  and public.activator_user_can_act_for_org(auth.uid(), owner_org_id)
);

alter table public.asset_model_template_items
  add column if not exists system_template_id uuid references public.system_templates(id) on delete set null;

alter table public.systems
  add column if not exists system_template_id uuid references public.system_templates(id) on delete set null;

create index if not exists asset_model_template_items_system_template_idx
  on public.asset_model_template_items (system_template_id);

create index if not exists systems_system_template_idx
  on public.systems (system_template_id);

alter table public.attachment_placements
  drop constraint if exists attachment_placements_target_type_check;

alter table public.attachment_placements
  add constraint attachment_placements_target_type_check
  check (
    target_type = any (
      array[
        'asset'::text,
        'system'::text,
        'service_record'::text,
        'event'::text,
        'model_template'::text,
        'system_template'::text
      ]
    )
  );

drop policy if exists "Readable system template attachment placements" on public.attachment_placements;
create policy "Readable system template attachment placements"
on public.attachment_placements
for select
to authenticated
using (
  target_type = 'system_template'
  and exists (
    select 1
    from public.system_templates st
    where st.id = attachment_placements.target_id
      and (
        st.authority_state <> 'retired'
        or (
          st.owner_org_id is not null
          and public.activator_user_can_act_for_org(auth.uid(), st.owner_org_id)
        )
      )
  )
);

drop policy if exists "Owner org creates system template attachment placements" on public.attachment_placements;
create policy "Owner org creates system template attachment placements"
on public.attachment_placements
for insert
to authenticated
with check (
  target_type = 'system_template'
  and exists (
    select 1
    from public.attachments attachment
    join public.system_templates st
      on st.id = attachment_placements.target_id
    where attachment.id = attachment_placements.attachment_id
      and attachment.owner_user_id = auth.uid()
      and st.owner_org_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), st.owner_org_id)
  )
);

drop policy if exists "Owner org updates system template attachment placements" on public.attachment_placements;
create policy "Owner org updates system template attachment placements"
on public.attachment_placements
for update
to authenticated
using (
  target_type = 'system_template'
  and exists (
    select 1
    from public.system_templates st
    where st.id = attachment_placements.target_id
      and st.owner_org_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), st.owner_org_id)
  )
)
with check (
  target_type = 'system_template'
  and exists (
    select 1
    from public.system_templates st
    where st.id = attachment_placements.target_id
      and st.owner_org_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), st.owner_org_id)
  )
);

drop policy if exists "Owner org deletes system template attachment placements" on public.attachment_placements;
create policy "Owner org deletes system template attachment placements"
on public.attachment_placements
for delete
to authenticated
using (
  target_type = 'system_template'
  and exists (
    select 1
    from public.system_templates st
    where st.id = attachment_placements.target_id
      and st.owner_org_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), st.owner_org_id)
  )
);

drop policy if exists "attachments_select_system_template_resources" on public.attachments;
create policy "attachments_select_system_template_resources"
on public.attachments
for select
to authenticated
using (
  deleted_at is null
  and exists (
    select 1
    from public.attachment_placements ap
    join public.system_templates st
      on st.id = ap.target_id
    where ap.attachment_id = attachments.id
      and ap.target_type = 'system_template'
      and (
        st.authority_state <> 'retired'
        or (
          st.owner_org_id is not null
          and public.activator_user_can_act_for_org(auth.uid(), st.owner_org_id)
        )
      )
  )
);

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
      'system_template_reference_source', 'system_template_references_v1'
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

do $$
declare
  v_tiara_org_id uuid;
  v_tiara_actor_id uuid;
  v_onan_id uuid;
  v_seakeeper_id uuid;
  v_onan_attachment_id uuid;
  v_seakeeper_attachment_id uuid;
begin
  select id
  into v_tiara_org_id
  from public.orgs
  where id = '5c864cc2-87a5-4d29-b539-ebf4464a1a90'::uuid
     or lower(coalesce(slug, '')) in ('tiara', 'tiara-yachts')
     or lower(coalesce(name, display_name, '')) like '%tiara%'
  order by case when id = '5c864cc2-87a5-4d29-b539-ebf4464a1a90'::uuid then 0 else 1 end
  limit 1;

  if v_tiara_org_id is null then
    raise notice 'Skipping System Template proof data: Tiara org not found.';
    return;
  end if;

  select id
  into v_tiara_actor_id
  from public.profiles
  where lower(coalesce(email, '')) in ('tiara@keeprhome.com', 'adrake@keeprhome.com')
  order by case when lower(coalesce(email, '')) = 'tiara@keeprhome.com' then 0 else 1 end
  limit 1;

  insert into public.system_templates (
    canonical_key,
    name,
    manufacturer,
    owner_org_id,
    system_category,
    description,
    authority_state,
    metadata
  )
  values (
    'system_template.onan.13_5kw_generator',
    'Onan 13.5kW Generator',
    'Cummins / Onan',
    v_tiara_org_id,
    'Generator / AC Power',
    'Reusable generator system knowledge referenced by Tiara model templates and exact KAC system instances.',
    'oem_verified',
    jsonb_build_object(
      'source', 'system_template_references_v1',
      'promotion_state', 'seeded_from_reviewed_56ls_model_dna',
      'reusable_truth_only', true
    )
  )
  on conflict (canonical_key) do update
  set name = excluded.name,
      manufacturer = excluded.manufacturer,
      owner_org_id = coalesce(public.system_templates.owner_org_id, excluded.owner_org_id),
      system_category = excluded.system_category,
      description = excluded.description,
      authority_state = excluded.authority_state,
      metadata = coalesce(public.system_templates.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now()
  returning id into v_onan_id;

  insert into public.system_templates (
    canonical_key,
    name,
    manufacturer,
    owner_org_id,
    system_category,
    description,
    authority_state,
    metadata
  )
  values (
    'system_template.seakeeper.sk10_5',
    'Seakeeper SK10.5',
    'Seakeeper',
    v_tiara_org_id,
    'Stabilization',
    'Reusable gyro stabilizer system knowledge referenced by Tiara model templates and exact KAC system instances.',
    'oem_verified',
    jsonb_build_object(
      'source', 'system_template_references_v1',
      'promotion_state', 'seeded_from_reviewed_56ls_model_dna',
      'reusable_truth_only', true
    )
  )
  on conflict (canonical_key) do update
  set name = excluded.name,
      manufacturer = excluded.manufacturer,
      owner_org_id = coalesce(public.system_templates.owner_org_id, excluded.owner_org_id),
      system_category = excluded.system_category,
      description = excluded.description,
      authority_state = excluded.authority_state,
      metadata = coalesce(public.system_templates.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now()
  returning id into v_seakeeper_id;

  update public.asset_model_template_items item
  set system_template_id = v_onan_id,
      metadata = coalesce(item.metadata, '{}'::jsonb) || jsonb_build_object(
        'system_template_id', v_onan_id,
        'system_template_key', 'system_template.onan.13_5kw_generator',
        'system_template_reference_source', 'system_template_references_v1'
      ),
      updated_at = now()
  from public.asset_model_templates template
  where item.template_id = template.id
    and lower(template.template_key) = 'tiara-2027-56-ls'
    and item.canonical_key = 'system.generator.onan_13_5kw';

  update public.asset_model_template_items item
  set system_template_id = v_seakeeper_id,
      metadata = coalesce(item.metadata, '{}'::jsonb) || jsonb_build_object(
        'system_template_id', v_seakeeper_id,
        'system_template_key', 'system_template.seakeeper.sk10_5',
        'system_template_reference_source', 'system_template_references_v1'
      ),
      updated_at = now()
  from public.asset_model_templates template
  where item.template_id = template.id
    and lower(template.template_key) = 'tiara-2027-56-ls'
    and item.canonical_key = 'system.stabilization.seakeeper_sk10_5';

  update public.systems system
  set system_template_id = v_onan_id,
      metadata = coalesce(system.metadata, '{}'::jsonb) || jsonb_build_object(
        'system_template_id', v_onan_id,
        'system_template_key', 'system_template.onan.13_5kw_generator',
        'system_template_reference_source', 'system_template_references_v1'
      ),
      updated_at = now()
  from public.assets asset
  where system.asset_id = asset.id
    and asset.kac_id = 'KAC-TIARA-56LS-KF018'
    and (
      lower(system.name) like '%onan%'
      or lower(system.name) like '%generator%'
    )
    and lower(system.name) not like '%oil changer%';

  update public.systems system
  set system_template_id = v_seakeeper_id,
      metadata = coalesce(system.metadata, '{}'::jsonb) || jsonb_build_object(
        'system_template_id', v_seakeeper_id,
        'system_template_key', 'system_template.seakeeper.sk10_5',
        'system_template_reference_source', 'system_template_references_v1'
      ),
      updated_at = now()
  from public.assets asset
  where system.asset_id = asset.id
    and asset.kac_id = 'KAC-TIARA-56LS-KF018'
    and lower(system.name) like '%seakeeper%';

  if v_tiara_actor_id is not null then
    select id
    into v_onan_attachment_id
    from public.attachments
    where org_id = v_tiara_org_id
      and title = 'Cummins / Onan marine generator support'
      and source_context ->> 'system_template_key' = 'system_template.onan.13_5kw_generator'
    order by created_at desc
    limit 1;

    if v_onan_attachment_id is null then
      insert into public.attachments (
        owner_user_id,
        org_id,
        kind,
        url,
        title,
        notes,
        source_context,
        ai_metadata
      )
      values (
        v_tiara_actor_id,
        v_tiara_org_id,
        'link',
        'https://www.cummins.com/generators/marine',
        'Cummins / Onan marine generator support',
        'Canonical reusable support resource for Onan marine generator systems.',
        jsonb_build_object(
          'provenance', 'system_template',
          'provenance_label', 'Cummins / Onan system template resource',
          'provenance_detail', 'Reusable system-template knowledge inherited by model items and exact systems by reference.',
          'system_template_id', v_onan_id,
          'system_template_key', 'system_template.onan.13_5kw_generator',
          'authority', 'official',
          'source_url', 'https://www.cummins.com/generators/marine'
        ),
        jsonb_build_object(
          'ai_context', 'supporting',
          'role', 'support_resource',
          'scope', 'system_template',
          'authority', 'official'
        )
      )
      returning id into v_onan_attachment_id;
    end if;

    select id
    into v_seakeeper_attachment_id
    from public.attachments
    where org_id = v_tiara_org_id
      and title = 'Seakeeper product and support portal'
      and source_context ->> 'system_template_key' = 'system_template.seakeeper.sk10_5'
    order by created_at desc
    limit 1;

    if v_seakeeper_attachment_id is null then
      insert into public.attachments (
        owner_user_id,
        org_id,
        kind,
        url,
        title,
        notes,
        source_context,
        ai_metadata
      )
      values (
        v_tiara_actor_id,
        v_tiara_org_id,
        'link',
        'https://seakeeper.com/',
        'Seakeeper product and support portal',
        'Canonical reusable support resource for Seakeeper gyro stabilizer systems.',
        jsonb_build_object(
          'provenance', 'system_template',
          'provenance_label', 'Seakeeper system template resource',
          'provenance_detail', 'Reusable system-template knowledge inherited by model items and exact systems by reference.',
          'system_template_id', v_seakeeper_id,
          'system_template_key', 'system_template.seakeeper.sk10_5',
          'authority', 'official',
          'source_url', 'https://seakeeper.com/'
        ),
        jsonb_build_object(
          'ai_context', 'supporting',
          'role', 'support_resource',
          'scope', 'system_template',
          'authority', 'official'
        )
      )
      returning id into v_seakeeper_attachment_id;
    end if;

    if v_onan_attachment_id is not null then
      insert into public.attachment_placements (
        attachment_id,
        target_type,
        target_id,
        role,
        label,
        is_showcase
      )
      values (
        v_onan_attachment_id,
        'system_template',
        v_onan_id,
        'support_resource',
        'System Template resource',
        false
      )
      on conflict do nothing;
    end if;

    if v_seakeeper_attachment_id is not null then
      insert into public.attachment_placements (
        attachment_id,
        target_type,
        target_id,
        role,
        label,
        is_showcase
      )
      values (
        v_seakeeper_attachment_id,
        'system_template',
        v_seakeeper_id,
        'support_resource',
        'System Template resource',
        false
      )
      on conflict do nothing;
    end if;
  end if;
end;
$$;

comment on table public.system_templates is
  'Canonical reusable Keepr Core system truth. Asset model template items reference this for applicability; exact system instances reference it for inherited reusable knowledge.';

comment on column public.asset_model_template_items.system_template_id is
  'Nullable reference from a system-like model/template item to canonical reusable system truth. Model-specific applicability remains on this item.';

comment on column public.systems.system_template_id is
  'Nullable reference from an exact installed system instance to canonical reusable system truth. Exact serials, service, evidence, and condition remain on the instance.';

select pg_notify('pgrst', 'reload schema');
