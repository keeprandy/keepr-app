-- Coordination child authorization: asset/system Team Actions are visible to
-- authorized stewards of the exact asset. If the Action stores an org scope,
-- that org must also actively steward the same asset.

create or replace function public.keepr_coordination_action_org_matches_asset(
  p_reminder public.reminders
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.keepr_coordination_action_visibility_org_id(p_reminder) is null
    or exists (
      select 1
      from public.asset_stewardships s
      where s.asset_id = (p_reminder).asset_id
        and s.org_id = public.keepr_coordination_action_visibility_org_id(p_reminder)
        and s.active = true
        and (s.starts_at is null or s.starts_at <= now())
        and (s.ends_at is null or s.ends_at > now())
    );
$$;

create or replace function public.keepr_coordination_can_read_action(
  p_reminder public.reminders,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id is not null
    and (
      (p_reminder).owner_id = p_user_id
      or (
        public.keepr_coordination_is_team_scoped((p_reminder).extra_metadata)
        and (
          (
            public.keepr_coordination_action_context(p_reminder) = 'household'
            and public.keepr_coordination_has_active_org_membership(
              public.keepr_coordination_action_visibility_org_id(p_reminder),
              p_user_id
            )
          )
          or (
            public.keepr_coordination_action_context(p_reminder) in ('asset', 'system')
            and (p_reminder).asset_id is not null
            and public.keepr_coordination_action_org_matches_asset(p_reminder)
            and public.keepr_coordination_has_active_asset_stewardship(
              (p_reminder).asset_id,
              p_user_id
            )
          )
        )
      )
    );
$$;

create or replace function public.keepr_coordination_can_complete_action(
  p_reminder public.reminders,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id is not null
    and (
      (p_reminder).owner_id = p_user_id
      or (
        public.keepr_coordination_can_read_action(p_reminder, p_user_id)
        and (
          coalesce((p_reminder).extra_metadata #>> '{responsible_party,type}', '') = 'unassigned'
          or coalesce((p_reminder).extra_metadata #>> '{responsible_party,id}', '') = p_user_id::text
          or (
            coalesce((p_reminder).extra_metadata #>> '{responsible_party,type}', '') = ''
            and (
              coalesce((p_reminder).extra_metadata #>> '{assignment_target,type}', '') <> 'team_member'
              or coalesce((p_reminder).extra_metadata #>> '{assignment_target,id}', '') = p_user_id::text
            )
          )
        )
      )
    );
$$;

grant execute on function public.keepr_coordination_action_org_matches_asset(public.reminders) to authenticated;
