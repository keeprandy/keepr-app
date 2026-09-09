-- Business Organization Visibility Recursion Fix
-- Scope: remove recursive attachment RLS references introduced by 12.
-- No data changes. No Personal org/workspace changes.

\set ON_ERROR_STOP on

begin;

create or replace function public.activator_attachment_visible_as_model_template_resource(
  p_user_id uuid,
  p_attachment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p_user_id is not null
    and p_attachment_id is not null
    and exists (
      select 1
      from public.attachments attachment
      join public.attachment_placements ap on ap.attachment_id = attachment.id
      join public.asset_model_templates template on template.id = ap.target_id
      where attachment.id = p_attachment_id
        and attachment.deleted_at is null
        and ap.target_type = 'model_template'
        and (
          template.status = 'published'
          or public.activator_user_can_manage_template(p_user_id, template.id)
        )
    );
$$;

create or replace function public.activator_attachment_visible_as_system_template_resource(
  p_user_id uuid,
  p_attachment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p_user_id is not null
    and p_attachment_id is not null
    and exists (
      select 1
      from public.attachments attachment
      join public.attachment_placements ap on ap.attachment_id = attachment.id
      join public.system_templates st on st.id = ap.target_id
      where attachment.id = p_attachment_id
        and attachment.deleted_at is null
        and ap.target_type = 'system_template'
        and (
          st.authority_state <> 'retired'
          or (
            st.owner_org_id is not null
            and public.activator_user_can_act_for_org(p_user_id, st.owner_org_id)
          )
        )
    );
$$;

drop policy if exists "attachments_select_model_template_resources" on public.attachments;
create policy "attachments_select_model_template_resources"
  on public.attachments
  for select
  to authenticated
  using (public.activator_attachment_visible_as_model_template_resource(auth.uid(), id));

drop policy if exists "attachments_select_system_template_resources" on public.attachments;
create policy "attachments_select_system_template_resources"
  on public.attachments
  for select
  to authenticated
  using (public.activator_attachment_visible_as_system_template_resource(auth.uid(), id));

revoke execute on function public.activator_attachment_visible_as_model_template_resource(uuid, uuid) from public;
revoke execute on function public.activator_attachment_visible_as_model_template_resource(uuid, uuid) from anon;
grant execute on function public.activator_attachment_visible_as_model_template_resource(uuid, uuid) to authenticated, service_role;

revoke execute on function public.activator_attachment_visible_as_system_template_resource(uuid, uuid) from public;
revoke execute on function public.activator_attachment_visible_as_system_template_resource(uuid, uuid) from anon;
grant execute on function public.activator_attachment_visible_as_system_template_resource(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

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

select 'owner_counts' as metric, jsonb_build_object(
  'assets', (select count(*) from public.assets),
  'systems', (select count(*) from public.systems),
  'attachments', (select count(*) from public.attachments),
  'placements', (select count(*) from public.attachment_placements)
)::text as value;

rollback;
