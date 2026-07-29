-- Communication V1.1: allow claimed message-link recipients to participate
-- in the exact pending conversation represented by asset_threads.resource_ref.

create or replace function public.keepr_can_access_asset_thread(p_thread public.asset_threads)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      p_thread.owner_id = auth.uid()
      or p_thread.created_by = auth.uid()
      or auth.uid()::text in (
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(coalesce(p_thread.resource_ref, '{}'::jsonb)->'participant_ids') = 'array'
              then coalesce(p_thread.resource_ref, '{}'::jsonb)->'participant_ids'
            else '[]'::jsonb
          end
        )
      )
      or exists (
        select 1
        from public.asset_stewardships s
        where s.asset_id = p_thread.asset_id
          and s.user_id = auth.uid()
          and coalesce(s.active, true) = true
          and (s.starts_at is null or s.starts_at <= now())
          and (s.ends_at is null or s.ends_at > now())
      )
      or (
        p_thread.hub_id is not null
        and exists (
          select 1
          from public.hub_members hm
          where hm.hub_id = p_thread.hub_id
            and hm.user_id = auth.uid()
            and coalesce(hm.status, 'active') = 'active'
        )
      )
    );
$$;

grant execute on function public.keepr_can_access_asset_thread(public.asset_threads) to authenticated;

comment on function public.keepr_can_access_asset_thread(public.asset_threads) is
  'Authorizes Communication V1 asset/system threads for owners, creators, stewards, Hub members, and claimed resource_ref participant_ids.';
