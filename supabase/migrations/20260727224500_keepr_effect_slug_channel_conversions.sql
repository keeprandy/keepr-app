-- Count channel conversions from both legacy /s share actions and slug invite URLs.

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
  attributed_sessions as (
    select
      session.id,
      session.landing_url,
      lower(nullif(session.utm->>'channel', '')) as utm_channel,
      lower(nullif(session.metadata->>'share_channel', '')) as metadata_channel,
      lower(nullif(substring(coalesce(session.landing_url, '') from '[?&]channel=([^&#]+)'), '')) as url_channel,
      sa.channel as share_action_channel
    from current_source src
    join public.attribution_records ar
      on ar.activation_source_id = src.id
     and ar.status = 'verified'
     and ar.attribution_model = 'person'
    join public.activation_sessions session
      on session.id = ar.activation_session_id
    left join public.share_actions sa
      on sa.id = session.share_action_id
     and sa.activation_source_id = src.id
  ),
  normalized as (
    select
      case
        when coalesce(share_action_channel, utm_channel, metadata_channel, url_channel) in ('sms', 'text') then 'text'
        when coalesce(share_action_channel, utm_channel, metadata_channel, url_channel) in (
          'native_share',
          'copy_link',
          'qr',
          'email',
          'facebook',
          'linkedin'
        ) then coalesce(share_action_channel, utm_channel, metadata_channel, url_channel)
        else null
      end as channel
    from attributed_sessions
  ),
  conversion_counts as (
    select channel, count(*)::integer as count
    from normalized
    where channel is not null
    group by 1
  )
  select coalesce(jsonb_object_agg(channel, count), '{}'::jsonb)
  from conversion_counts;
$$;

revoke all on function public.get_my_keepr_effect_channel_conversions() from public;
grant execute on function public.get_my_keepr_effect_channel_conversions() to authenticated;
