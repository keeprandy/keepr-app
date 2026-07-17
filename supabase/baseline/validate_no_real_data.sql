-- Read-only real-data guard for staging.
-- This is intentionally conservative and should be run after synthetic fixture cleanup.

select 'profiles' as table_name, count(*) as row_count from public.profiles
union all
select 'assets', count(*) from public.assets
union all
select 'asset_threads', count(*) from public.asset_threads
union all
select 'asset_thread_messages', count(*) from public.asset_thread_messages
union all
select 'public_asset_thread_tokens', count(*) from public.public_asset_thread_tokens
union all
select 'notifications', count(*) from public.notifications
union all
select 'event_inbox', count(*) from public.event_inbox;

-- Optional synthetic-prefix check. Replace the prefix before running.
-- select id, kac_id, name from public.assets where name not like 'stg_evtproj_%';

