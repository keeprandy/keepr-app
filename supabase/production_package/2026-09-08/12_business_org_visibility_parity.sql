-- Business Organization Visibility Parity
-- Scope: restore OEM/Dealer/Supplier catalog/resource visibility for released business orgs.
-- This intentionally does not modify Personal orgs, owner assets, systems, history, or data rows.

\set ON_ERROR_STOP on

begin;

create or replace function public.activator_user_can_act_for_org(
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
      and coalesce(m.role, m.member_role, 'member') in ('owner', 'admin', 'manager', 'member', 'provider_member')
  );
$$;

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

drop policy if exists "Org members manage templates" on public.asset_model_templates;
drop policy if exists "Org catalog authors manage templates" on public.asset_model_templates;
create policy "Org catalog authors manage templates"
  on public.asset_model_templates
  for all
  to authenticated
  using (public.activator_user_can_author_catalog_for_org(auth.uid(), organization_id))
  with check (public.activator_user_can_author_catalog_for_org(auth.uid(), organization_id));

drop policy if exists "Readable model template attachment placements" on public.attachment_placements;
create policy "Readable model template attachment placements"
  on public.attachment_placements
  for select
  to authenticated
  using (
    target_type = 'model_template'
    and exists (
      select 1
      from public.asset_model_templates template
      where template.id = attachment_placements.target_id
        and (
          template.status = 'published'
          or public.activator_user_can_manage_template(auth.uid(), template.id)
        )
    )
  );

drop policy if exists "Template managers create model template attachment placements" on public.attachment_placements;
create policy "Template managers create model template attachment placements"
  on public.attachment_placements
  for insert
  to authenticated
  with check (
    target_type = 'model_template'
    and public.keepr_attachment_owned_by_user(auth.uid(), attachment_id)
    and exists (
      select 1
      from public.asset_model_templates template
      where template.id = attachment_placements.target_id
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  );

drop policy if exists "Template managers update model template attachment placements" on public.attachment_placements;
create policy "Template managers update model template attachment placements"
  on public.attachment_placements
  for update
  to authenticated
  using (
    target_type = 'model_template'
    and exists (
      select 1
      from public.asset_model_templates template
      where template.id = attachment_placements.target_id
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  )
  with check (
    target_type = 'model_template'
    and exists (
      select 1
      from public.asset_model_templates template
      where template.id = attachment_placements.target_id
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  );

drop policy if exists "Template managers delete model template attachment placements" on public.attachment_placements;
create policy "Template managers delete model template attachment placements"
  on public.attachment_placements
  for delete
  to authenticated
  using (
    target_type = 'model_template'
    and exists (
      select 1
      from public.asset_model_templates template
      where template.id = attachment_placements.target_id
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  );

drop policy if exists "Owner org creates system template attachment placements" on public.attachment_placements;
create policy "Owner org creates system template attachment placements"
  on public.attachment_placements
  for insert
  to authenticated
  with check (
    target_type = 'system_template'
    and public.keepr_attachment_owned_by_user(auth.uid(), attachment_id)
    and exists (
      select 1
      from public.system_templates st
      where st.id = attachment_placements.target_id
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

drop policy if exists "Template managers update model template attachments" on public.attachments;
create policy "Template managers update model template attachments"
  on public.attachments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.attachment_placements ap
      join public.asset_model_templates template on template.id = ap.target_id
      where ap.attachment_id = attachments.id
        and ap.target_type = 'model_template'
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  )
  with check (
    exists (
      select 1
      from public.attachment_placements ap
      join public.asset_model_templates template on template.id = ap.target_id
      where ap.attachment_id = attachments.id
        and ap.target_type = 'model_template'
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  );

drop policy if exists "attachments_select_model_template_resources" on public.attachments;
create policy "attachments_select_model_template_resources"
  on public.attachments
  for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.attachment_placements ap
      join public.asset_model_templates template on template.id = ap.target_id
      where ap.attachment_id = attachments.id
        and ap.target_type = 'model_template'
        and (
          template.status = 'published'
          or public.activator_user_can_manage_template(auth.uid(), template.id)
        )
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
      join public.system_templates st on st.id = ap.target_id
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

grant execute on function public.activator_user_can_act_for_org(uuid, uuid) to authenticated, service_role;
grant execute on function public.activator_user_can_author_catalog_for_org(uuid, uuid) to authenticated, service_role;
grant execute on function public.activator_user_can_manage_template(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- Read-only smoke: these counts should match production parity while acting as Tiara.
begin;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where lower(email)='tiara@keeprhome.com'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select 'tiara_visible_templates' as metric, count(*)::text as value
from public.asset_model_templates t
join public.orgs o on o.id = t.organization_id
where o.slug = 'tiara-yachts';

select 'tiara_visible_items' as metric, count(*)::text as value
from public.asset_model_template_items i
join public.asset_model_templates t on t.id = i.template_id
join public.orgs o on o.id = t.organization_id
where o.slug = 'tiara-yachts';

select 'tiara_visible_model_resources' as metric, count(*)::text as value
from public.attachment_placements ap
join public.asset_model_templates t on t.id = ap.target_id and ap.target_type = 'model_template'
join public.orgs o on o.id = t.organization_id
where o.slug = 'tiara-yachts';

select 'tiara_visible_attachments_for_model_resources' as metric, count(a.id)::text as value
from public.attachments a
join public.attachment_placements ap on ap.attachment_id = a.id
join public.asset_model_templates t on t.id = ap.target_id and ap.target_type = 'model_template'
join public.orgs o on o.id = t.organization_id
where o.slug = 'tiara-yachts'
  and a.deleted_at is null;

rollback;
