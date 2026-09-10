-- Compatibility contract for Dashboard pending owner handoff reads.
-- This restores the read-only list function expected by the current client
-- without introducing the owner handoff mutation functions in this patch.

create or replace function public.list_pending_asset_owner_handoffs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_rows jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('handoffs', '[]'::jsonb);
  end if;

  select lower(email)
  into v_email
  from public.profiles
  where id = v_user_id
  limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'asset_relationship_id', ar.id,
      'asset_id', a.id,
      'kac_id', a.kac_id,
      'asset_name', a.name,
      'year', a.year,
      'make', a.make,
      'model', a.model,
      'status', ar.status,
      'access_scope', ar.access_scope,
      'pending_owner_email', ar.metadata ->> 'pending_owner_email',
      'pending_owner_display_name', ar.metadata ->> 'pending_owner_display_name',
      'dealer_org_id', ar.initiated_by_org_id,
      'dealer_name', coalesce(nullif(o.display_name, ''), nullif(o.name, ''), 'Dealer'),
      'initiated_at', ar.created_at
    )
    order by ar.created_at desc
  ), '[]'::jsonb)
  into v_rows
  from public.asset_relationships ar
  join public.assets a
    on a.id = ar.asset_id
   and coalesce(a.deleted_at is null, true)
  left join public.orgs o
    on o.id = ar.initiated_by_org_id
  where ar.relationship_type = 'owner'
    and ar.status in ('pending', 'invited')
    and (
      ar.user_id = v_user_id
      or lower(ar.metadata ->> 'pending_owner_email') = v_email
    );

  return jsonb_build_object('handoffs', v_rows);
end;
$$;

revoke execute on function public.list_pending_asset_owner_handoffs() from public;
revoke execute on function public.list_pending_asset_owner_handoffs() from anon;
grant execute on function public.list_pending_asset_owner_handoffs() to authenticated;
grant execute on function public.list_pending_asset_owner_handoffs() to service_role;
