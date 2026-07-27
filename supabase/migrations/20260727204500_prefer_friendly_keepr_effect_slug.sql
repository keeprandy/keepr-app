-- Keepr Effect V1 hotfix: prefer member-friendly active aliases for share URLs.
-- Canonical u_* slugs remain durable identity fallbacks, not the first member-facing URL.

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
           'A new Keepr joined from your invitation.'::text as label
    from attributed ar
    union all
    select aa.created_at,
           'asset_created',
           'An attributed Keepr created an asset.'
    from attributed_assets aa
    union all
    select ap.created_at,
           'proof_added',
           'An attributed Keepr preserved proof.'
    from attributed_proof ap
  ),
  recent_limited as (
    select event_type, label, happened_at
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
