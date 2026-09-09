begin;

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

revoke execute on function public.get_exact_build_work_queue(uuid) from public;
revoke execute on function public.get_exact_build_work_queue(uuid) from anon;
grant execute on function public.get_exact_build_work_queue(uuid) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');

commit;
