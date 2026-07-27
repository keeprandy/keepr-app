-- Keepr Effect V1: enrich private recent impact with current attributed member identity.
-- Names/photos are resolved dynamically from profiles; immutable attribution rows remain unchanged.

create or replace function public.get_my_keepr_effect()
returns table (
  source_slug text,
  activation_source_id uuid,
  invite_visits integer,
  verified_keeprs integer,
  activated_keeprs integer,
  assets_created integer,
  proof_items_added integer,
  downstream_keeprs integer,
  recent_impact jsonb,
  shares_by_channel jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  source_row public.activation_sources%rowtype;
  profile_slug text;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  select *
    into source_row
    from public.activation_sources s
    where s.source_type = 'user'
      and s.owner_user_id = current_user_id
      and s.status = 'active'
    order by s.created_at asc
    limit 1;

  if source_row.id is null then
    source_slug := null;
    activation_source_id := null;
    invite_visits := 0;
    verified_keeprs := 0;
    activated_keeprs := 0;
    assets_created := 0;
    proof_items_added := 0;
    downstream_keeprs := 0;
    recent_impact := '[]'::jsonb;
    shares_by_channel := '{}'::jsonb;
    return next;
    return;
  end if;

  select coalesce(
      nullif(trim(p.acquisition_source_slug), ''),
      nullif(trim(p.username), ''),
      nullif(trim(p.inbox_name), '')
    )
    into profile_slug
    from public.profiles p
    where p.id = current_user_id;

  select coalesce(
      (
        select s.normalized_slug
        from public.activation_source_slugs s
        where s.activation_source_id = source_row.id
          and s.status = 'active'
          and s.normalized_slug = public.normalize_activation_slug(profile_slug)
        limit 1
      ),
      (
        select s.normalized_slug
        from public.activation_source_slugs s
        where s.activation_source_id = source_row.id
          and s.status = 'active'
          and s.slug_kind = 'alias'
          and s.normalized_slug !~ '^u_[0-9a-f]{8}$'
        order by
          case when s.metadata->>'alias_source' = 'profile' then 0 else 1 end,
          s.created_at asc
        limit 1
      ),
      (
        select s.normalized_slug
        from public.activation_source_slugs s
        where s.activation_source_id = source_row.id
          and s.status = 'active'
          and s.slug_kind = 'canonical'
        order by s.created_at asc
        limit 1
      ),
      (
        select s.normalized_slug
        from public.activation_source_slugs s
        where s.activation_source_id = source_row.id
          and s.status = 'active'
        order by s.created_at asc
        limit 1
      ),
      source_row.source_key
    )
    into source_slug;

  activation_source_id := source_row.id;

  with attributed as (
    select ar.id,
           ar.user_id,
           ar.created_at
    from public.attribution_records ar
    where ar.activation_source_id = source_row.id
      and ar.status = 'verified'
      and ar.attribution_model = 'person'
  ),
  attributed_identity as (
    select ar.user_id,
           coalesce(
             nullif(
               trim(
                 coalesce(split_part(nullif(trim(p.full_name), ''), ' ', 1), split_part(nullif(trim(p.display_name), ''), ' ', 1), '')
                 || case
                   when coalesce(nullif(regexp_replace(nullif(trim(p.full_name), ''), '^.*\s+', ''), ''), nullif(regexp_replace(nullif(trim(p.display_name), ''), '^.*\s+', ''), '')) is not null
                    and coalesce(split_part(nullif(trim(p.full_name), ''), ' ', 1), split_part(nullif(trim(p.display_name), ''), ' ', 1), '') <>
                        coalesce(nullif(regexp_replace(nullif(trim(p.full_name), ''), '^.*\s+', ''), ''), nullif(regexp_replace(nullif(trim(p.display_name), ''), '^.*\s+', ''), ''))
                   then ' ' || left(coalesce(regexp_replace(nullif(trim(p.full_name), ''), '^.*\s+', ''), regexp_replace(nullif(trim(p.display_name), ''), '^.*\s+', '')), 1) || '.'
                   else ''
                 end
               ),
               ''
             ),
             nullif(trim(p.username), ''),
             nullif(trim(p.inbox_name), ''),
             member_slug.normalized_slug,
             'A Keepr'
           ) as actor_display_name,
           case
             when coalesce(photo.mime_type, '') not ilike 'image/%' then null
             when nullif(trim(coalesce(photo.url, '')), '') is not null then nullif(trim(photo.url), '')
             when nullif(trim(coalesce(photo.bucket, '')), '') is not null
              and nullif(trim(coalesce(photo.storage_path, '')), '') is not null
             then 'https://jjzjuqxysucqutgjnrkk.supabase.co/storage/v1/object/public/'
               || trim(photo.bucket)
               || '/'
               || trim(photo.storage_path)
             else null
           end as actor_photo_url
    from attributed ar
    left join public.profiles p on p.id = ar.user_id
    left join public.attachments photo on photo.id = p.profile_photo_attachment_id
    left join lateral (
      select s.normalized_slug
      from public.activation_sources member_source
      join public.activation_source_slugs s on s.activation_source_id = member_source.id
      where member_source.source_type = 'user'
        and member_source.owner_user_id = ar.user_id
        and member_source.status = 'active'
        and s.status = 'active'
      order by
        case when s.slug_kind = 'alias' and s.normalized_slug !~ '^u_[0-9a-f]{8}$' then 0 else 1 end,
        case when s.slug_kind = 'canonical' then 1 else 0 end,
        s.created_at asc
      limit 1
    ) member_slug on true
  ),
  attributed_assets as (
    select a.id,
           a.owner_id,
           a.created_at
    from public.assets a
    join attributed ar on ar.user_id = a.owner_id
    where a.deleted_at is null
  ),
  attributed_proof as (
    select att.id,
           att.owner_user_id,
           att.asset_id,
           att.created_at
    from public.attachments att
    join attributed ar on ar.user_id = att.owner_user_id
    where att.deleted_at is null
  ),
  downstream as (
    select distinct ar.user_id
    from attributed ar
    join public.activation_sources child_source
      on child_source.source_type = 'user'
     and child_source.owner_user_id = ar.user_id
     and child_source.status = 'active'
    join public.attribution_records child_ar
      on child_ar.activation_source_id = child_source.id
     and child_ar.status = 'verified'
     and child_ar.attribution_model = 'person'
  ),
  recent_events as (
    select ar.created_at as happened_at,
           'verified_keepr'::text as event_type,
           ai.actor_display_name,
           ai.actor_photo_url,
           ai.actor_display_name || ' became a Keepr.'::text as label
    from attributed ar
    left join attributed_identity ai on ai.user_id = ar.user_id
    union all
    select aa.created_at,
           'asset_created',
           ai.actor_display_name,
           ai.actor_photo_url,
           ai.actor_display_name || ' created an asset.'
    from attributed_assets aa
    left join attributed_identity ai on ai.user_id = aa.owner_id
    union all
    select ap.created_at,
           'proof_added',
           ai.actor_display_name,
           ai.actor_photo_url,
           ai.actor_display_name || ' preserved an ownership record.'
    from attributed_proof ap
    left join attributed_identity ai on ai.user_id = ap.owner_user_id
  ),
  recent_limited as (
    select event_type, actor_display_name, actor_photo_url, label, happened_at
    from recent_events
    order by happened_at desc
    limit 8
  ),
  share_counts as (
    select case when sa.channel = 'sms' then 'text' else sa.channel end as channel,
           count(*)::integer as count
    from public.share_actions sa
    where sa.activation_source_id = source_row.id
      and sa.actor_user_id = current_user_id
    group by 1
  )
  select
    (
      select count(*)::integer
      from public.activation_sessions s
      where s.activation_source_id = source_row.id
        and s.status not in ('ignored', 'blocked')
        and coalesce(s.internal_test_status, 'normal') = 'normal'
    ),
    (select count(*)::integer from attributed),
    (
      select count(distinct ar.user_id)::integer
      from attributed ar
      join attributed_assets aa on aa.owner_id = ar.user_id
    ),
    (select count(*)::integer from attributed_assets),
    (select count(*)::integer from attributed_proof),
    (select count(*)::integer from downstream),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'event_type', rl.event_type,
            'actor_display_name', rl.actor_display_name,
            'actor_photo_url', rl.actor_photo_url,
            'label', rl.label,
            'happened_at', rl.happened_at
          )
          order by rl.happened_at desc
        )
        from recent_limited rl
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_object_agg(sc.channel, sc.count)
        from share_counts sc
      ),
      '{}'::jsonb
    )
  into
    invite_visits,
    verified_keeprs,
    activated_keeprs,
    assets_created,
    proof_items_added,
    downstream_keeprs,
    recent_impact,
    shares_by_channel;

  return next;
end;
$$;

revoke all on function public.get_my_keepr_effect() from public;
grant execute on function public.get_my_keepr_effect() to authenticated;
