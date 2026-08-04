create or replace function public.get_keeprpro_relationship_portal(
  p_asset_id uuid default null,
  p_kac text default null,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_action record;
  v_thread record;
  v_service_state jsonb;
begin
  select
    a.id as asset_id,
    a.name as asset_name,
    a.kac_id,
    coalesce(nullif(owner_profile.display_name, ''), nullif(owner_profile.full_name, ''), owner_profile.email, 'Owner') as owner_display_name,
    aps.id as stewardship_id,
    aps.relationship_type,
    aps.access_scope,
    o.id as organization_id,
    coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.name) as organization_name,
    kp.id as keepr_pro_id,
    coalesce(nullif(kp.display_name, ''), nullif(kp.name, ''), nullif(o.display_name, ''), o.name) as keepr_pro_name
  into v_row
  from public.assets a
  join public.asset_provider_stewardships aps
    on aps.asset_id = a.id
  join public.orgs o
    on o.id = aps.organization_id
  join public.keepr_pros kp
    on kp.id = aps.keepr_pro_id
  left join public.profiles owner_profile
    on owner_profile.id = a.owner_id
  where auth.uid() is not null
    and (p_asset_id is null or a.id = p_asset_id)
    and (nullif(trim(coalesce(p_kac, '')), '') is null or upper(a.kac_id) = upper(trim(p_kac)))
    and aps.status = 'active'
    and aps.access_scope = 'service_stewardship'
    and (p_organization_id is null or aps.organization_id = p_organization_id)
    and public.keeprpro_user_can_act_for_org(auth.uid(), aps.organization_id)
    and a.deleted_at is null
  order by a.created_at desc
  limit 1;

  if v_row.asset_id is null then
    return null;
  end if;

  select r.*
  into v_action
  from public.reminders r
  where r.asset_id = v_row.asset_id
    and coalesce(r.status, 'open') not in ('completed', 'deleted', 'archived')
    and public.keeprpro_can_access_provider_action(r.id, auth.uid(), v_row.organization_id)
    and (
      r.extra_metadata ->> 'relationship_portal_kind' = 'annual_winterization'
      or r.title ilike '%winterization%'
    )
  order by
    case when r.extra_metadata ->> 'relationship_portal_kind' = 'annual_winterization' then 0 else 1 end,
    r.due_at asc nulls last,
    r.created_at desc
  limit 1;

  select t.*
  into v_thread
  from public.asset_threads t
  where t.asset_id = v_row.asset_id
    and (
      t.keepr_pro_id = v_row.keepr_pro_id
      or t.resource_ref #>> '{message_link,intended_recipient,source_type}' = 'keepr_pro'
    )
  order by t.updated_at desc
  limit 1;

  v_service_state := coalesce(v_action.extra_metadata -> 'service_state', '{}'::jsonb);

  return jsonb_build_object(
    'portal_label', 'Relationship Portal',
    'relationship_title', v_row.owner_display_name || ' ↔ ' || v_row.organization_name,
    'relationship_subtitle', v_row.asset_name || ' · ' || v_row.kac_id,
    'scope_label', 'KeeprPro projection thread',
    'owner_display_name', v_row.owner_display_name,
    'organization_name', v_row.organization_name,
    'asset_name', v_row.asset_name,
    'kac_id', v_row.kac_id,
    'stewardship_id', v_row.stewardship_id,
    'access_scope', v_row.access_scope,
    'current_service',
    jsonb_build_object(
      'name', coalesce(v_service_state ->> 'name', 'Annual winterization'),
      'status', coalesce(v_service_state ->> 'status', 'Reserved'),
      'deposit_status', coalesce(v_service_state ->> 'deposit_status', 'paid'),
      'deposit_amount', coalesce(nullif(v_service_state ->> 'deposit_amount', '')::numeric, 600),
      'reservation_status', coalesce(v_service_state ->> 'reservation_status', 'spot reserved'),
      'pickup_status', coalesce(v_service_state ->> 'pickup_status', 'not scheduled'),
      'next_step', coalesce(v_service_state ->> 'next_step', 'Schedule pickup with Wilson Marine'),
      'source_note', coalesce(
        v_service_state ->> 'source_note',
        'Deposit was handled outside Keepr; the relationship portal now carries the shared state.'
      )
    ),
    'what_next',
    jsonb_build_object(
      'title', coalesce(v_service_state ->> 'next_step', 'Schedule pickup with Wilson Marine'),
      'body', coalesce(
        v_service_state ->> 'what_next_body',
        '$600 winterization deposit paid. Wilson Marine has reserved the spot; pickup still needs to be scheduled.'
      ),
      'action_id', v_action.id,
      'due_at', v_action.due_at,
      'status', v_action.status
    ),
    'projection_thread',
    case
      when v_thread.id is null then null
      else jsonb_build_object(
        'id', v_thread.id,
        'subject', v_thread.subject,
        'status', v_thread.status,
        'updated_at', v_thread.updated_at
      )
    end
  );
end;
$$;

grant execute on function public.get_keeprpro_relationship_portal(uuid, text, uuid) to authenticated;

update public.reminders
set
  title = 'Schedule pickup for winterization',
  extra_metadata = coalesce(extra_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'relationship_portal_kind',
      'annual_winterization',
      'service_state',
      jsonb_build_object(
        'name',
        'Annual winterization',
        'status',
        'Reserved',
        'deposit_status',
        'paid',
        'deposit_amount',
        600,
        'reservation_status',
        'spot reserved',
        'pickup_status',
        'not scheduled',
        'next_step',
        'Schedule pickup with Wilson Marine',
        'what_next_body',
        '$600 winterization deposit paid. Wilson Marine has reserved the spot; pickup still needs to be scheduled.',
        'source_note',
        'Deposit was handled outside Keepr; the relationship portal now carries the shared state.'
      )
    ),
  updated_at = now()
where id = '5d740c3b-ff98-41c9-aa8f-f44d76b61334'
  and asset_id = '9733c254-579b-47ab-8b51-593b1d44f8fa';
