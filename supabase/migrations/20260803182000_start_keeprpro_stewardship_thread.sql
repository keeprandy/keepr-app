create or replace function public.start_keeprpro_stewardship_thread(
  p_asset_id uuid,
  p_organization_id uuid,
  p_body text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_thread public.asset_threads;
  v_message public.asset_thread_messages;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
begin
  select
    a.id as asset_id,
    a.owner_id,
    a.name as asset_name,
    a.kac_id,
    aps.id as stewardship_id,
    aps.organization_id,
    aps.keepr_pro_id,
    coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.name, 'KeeprPro') as organization_name
  into v_row
  from public.assets a
  join public.asset_provider_stewardships aps
    on aps.asset_id = a.id
  join public.orgs o
    on o.id = aps.organization_id
  join public.keepr_pros kp
    on kp.id = aps.keepr_pro_id
  where auth.uid() is not null
    and a.id = p_asset_id
    and aps.organization_id = p_organization_id
    and aps.status = 'active'
    and aps.access_scope = 'service_stewardship'
    and (aps.starts_at is null or aps.starts_at <= now())
    and (aps.ends_at is null or aps.ends_at > now())
    and public.keeprpro_user_can_act_for_org(auth.uid(), aps.organization_id)
    and a.deleted_at is null
  limit 1;

  if v_row.asset_id is null then
    return null;
  end if;

  select t.*
  into v_thread
  from public.asset_threads t
  where t.asset_id = v_row.asset_id
    and (
      t.keepr_pro_id = v_row.keepr_pro_id
      or t.resource_ref #>> '{message_link,intended_recipient,source_type}' = 'keepr_pro'
    )
  order by t.updated_at desc nulls last, t.created_at desc
  limit 1;

  if v_thread.id is null then
    insert into public.asset_threads (
      asset_id,
      system_id,
      keepr_pro_id,
      owner_id,
      created_by,
      subject,
      source_type,
      resource_ref,
      status
    )
    values (
      v_row.asset_id,
      null,
      v_row.keepr_pro_id,
      v_row.owner_id,
      auth.uid(),
      'General · ' || v_row.organization_name,
      'keeprpro_stewardship',
      jsonb_build_object(
        'asset_id', v_row.asset_id,
        'kac', v_row.kac_id,
        'keepr_pro_id', v_row.keepr_pro_id,
        'organization_id', v_row.organization_id,
        'stewardship_id', v_row.stewardship_id,
        'relationship_scope', 'service_stewardship',
        'participant_ids', jsonb_build_array(v_row.owner_id, auth.uid())
      ),
      'open'
    )
    returning * into v_thread;

    update public.asset_threads
    set resource_ref = coalesce(resource_ref, '{}'::jsonb) || jsonb_build_object('thread_id', v_thread.id)
    where id = v_thread.id
    returning * into v_thread;
  end if;

  if v_body is not null then
    insert into public.asset_thread_messages (
      thread_id,
      from_user_id,
      body,
      sender_type,
      sender_name
    )
    values (
      v_thread.id,
      auth.uid(),
      v_body,
      'keepr_pro',
      v_row.organization_name
    )
    returning * into v_message;

    update public.asset_threads
    set updated_at = v_message.created_at
    where id = v_thread.id
    returning * into v_thread;
  end if;

  return jsonb_build_object(
    'thread', to_jsonb(v_thread),
    'message', case when v_message.id is null then null else to_jsonb(v_message) end,
    'asset_id', v_row.asset_id,
    'kac', v_row.kac_id,
    'stewardship_id', v_row.stewardship_id,
    'keepr_pro_id', v_row.keepr_pro_id,
    'organization_id', v_row.organization_id,
    'owner_id', v_row.owner_id
  );
end;
$$;

grant execute on function public.start_keeprpro_stewardship_thread(uuid, uuid, text) to authenticated;
