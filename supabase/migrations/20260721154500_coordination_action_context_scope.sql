-- Coordination V1: make Action context explicit.
-- Team-visible generic coordination Actions use org membership; asset/system
-- Actions continue to use active asset stewardship. Provider metadata never
-- grants visibility.

create or replace function public.keepr_coordination_has_active_org_membership(
  p_org_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_org_id is not null
    and p_user_id is not null
    and (
      exists (
        select 1
        from public.orgs o
        where o.id = p_org_id
          and o.owner_user_id = p_user_id
      )
      or exists (
        select 1
        from public.org_members m
        where m.org_id = p_org_id
          and m.user_id = p_user_id
      )
    );
$$;

create or replace function public.keepr_coordination_action_context(
  p_reminder public.reminders
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when coalesce((p_reminder).extra_metadata ->> 'action_context', '') in
      ('personal', 'household', 'asset', 'system')
      then (p_reminder).extra_metadata ->> 'action_context'
    when (p_reminder).system_id is not null then 'system'
    when (p_reminder).asset_id is not null then 'asset'
    when public.keepr_coordination_is_team_scoped((p_reminder).extra_metadata)
      then 'household'
    else 'personal'
  end;
$$;

create or replace function public.keepr_coordination_action_visibility_org_id(
  p_reminder public.reminders
)
returns uuid
language sql
stable
set search_path = public
as $$
  select nullif(
    coalesce(
      (p_reminder).extra_metadata ->> 'visibility_org_id',
      (p_reminder).extra_metadata #>> '{responsible_party,org_id}',
      (p_reminder).extra_metadata #>> '{assignment_target,org_id}'
    ),
    ''
  )::uuid;
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

grant execute on function public.keepr_coordination_has_active_org_membership(uuid, uuid) to authenticated;
grant execute on function public.keepr_coordination_action_context(public.reminders) to authenticated;
grant execute on function public.keepr_coordination_action_visibility_org_id(public.reminders) to authenticated;
