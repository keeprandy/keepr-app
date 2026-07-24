-- Coordination V1: split Action visibility from responsibility.
-- New Actions use extra_metadata.visibility_scope for read access and
-- extra_metadata.responsible_party for responsibility. Legacy Team assignment
-- metadata remains readable for compatibility only.

create or replace function public.keepr_coordination_is_team_scoped(p_meta jsonb)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    lower(coalesce(p_meta ->> 'visibility_scope', '')) = 'team'
    or (
      coalesce(p_meta ->> 'visibility_scope', '') = ''
      and (
        coalesce(p_meta #>> '{assignment_target,type}', '') in ('team', 'team_member')
        or lower(coalesce(p_meta ->> 'assigned_to', '')) = 'team'
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
        (p_reminder).asset_id is not null
        and public.keepr_coordination_is_team_scoped((p_reminder).extra_metadata)
        and public.keepr_coordination_has_active_asset_stewardship(
          (p_reminder).asset_id,
          p_user_id
        )
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
