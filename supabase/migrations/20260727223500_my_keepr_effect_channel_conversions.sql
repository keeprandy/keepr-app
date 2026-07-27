-- Channel conversion breakdown for Keepr Effect.
-- Counts verified signups that arrived through durable /s/{token} share actions.

create or replace function public.get_my_keepr_effect_channel_conversions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with current_source as (
    select s.id
    from public.activation_sources s
    where s.source_type = 'user'
      and s.owner_user_id = auth.uid()
      and s.status = 'active'
    order by s.created_at asc
    limit 1
  ),
  conversion_counts as (
    select
      case
        when sa.channel = 'sms' then 'text'
        else sa.channel
      end as channel,
      count(*)::integer as count
    from current_source src
    join public.attribution_records ar
      on ar.activation_source_id = src.id
     and ar.status = 'verified'
     and ar.attribution_model = 'person'
    join public.activation_sessions session
      on session.id = ar.activation_session_id
    join public.share_actions sa
      on sa.id = session.share_action_id
     and sa.activation_source_id = src.id
    group by 1
  )
  select coalesce(jsonb_object_agg(channel, count), '{}'::jsonb)
  from conversion_counts;
$$;

revoke all on function public.get_my_keepr_effect_channel_conversions() from public;
grant execute on function public.get_my_keepr_effect_channel_conversions() to authenticated;
