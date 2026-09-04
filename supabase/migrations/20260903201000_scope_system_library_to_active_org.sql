-- Scope System Library browsing to the active organization when provided.
-- Shared/supplier catalog browsing should be explicit, not mixed into an OEM's
-- owned standard systems by default.

drop function if exists public.list_system_templates(text, integer);

create or replace function public.list_system_templates(
  p_query text default null,
  p_limit integer default 25,
  p_organization_id uuid default null,
  p_scope text default 'all'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := nullif(trim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_scope text := coalesce(nullif(trim(p_scope), ''), 'all');
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;

  if p_organization_id is not null
     and not public.activator_user_can_act_for_org(auth.uid(), p_organization_id) then
    raise exception 'not allowed to browse this organization System Library';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', st.id,
        'canonical_key', st.canonical_key,
        'name', st.name,
        'manufacturer', st.manufacturer,
        'owner_org_id', st.owner_org_id,
        'supplier_org_id', st.supplier_org_id,
        'system_category', st.system_category,
        'description', st.description,
        'authority_state', st.authority_state,
        'metadata', coalesce(st.metadata, '{}'::jsonb),
        'resource_count', (
          select count(*)
          from public.attachment_placements ap
          join public.attachments att on att.id = ap.attachment_id
          where ap.target_type = 'system_template'
            and ap.target_id = st.id
            and att.deleted_at is null
        )
      )
      order by
        case
          when v_query is not null and lower(st.name) = lower(v_query) then 0
          when v_query is not null and lower(st.name) like lower(v_query) || '%' then 1
          else 2
        end,
        st.name
    )
    from (
      select *
      from public.system_templates st
      where st.authority_state <> 'retired'
        and (
          v_scope <> 'owned'
          or (
            p_organization_id is not null
            and st.owner_org_id = p_organization_id
          )
        )
        and (
          v_query is null
          or st.name ilike '%' || v_query || '%'
          or st.manufacturer ilike '%' || v_query || '%'
          or st.canonical_key ilike '%' || v_query || '%'
        )
      order by st.name
      limit v_limit
    ) st
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_system_templates(text, integer, uuid, text) to authenticated;

comment on function public.list_system_templates(text, integer, uuid, text) is
  'Lists canonical System Templates. With scope=owned, returns only templates owned by the active organization after membership authorization.';

select pg_notify('pgrst', 'reload schema');
