-- Compatibility projection for the durable user activation identity created by
-- Activation & Attribution V1 Build 3.
--
-- Authoritative identity remains public.activation_sources with source_type =
-- 'user'. This view gives internal/reporting clients a stable read-only object
-- name without duplicating identity state.

create or replace view public.user_activation_identities
with (security_invoker = true)
as
select
  src.owner_user_id as user_id,
  src.id as activation_source_id,
  canonical.slug as canonical_slug,
  case
    when canonical.slug is not null then 'https://www.keeprhome.com/invite/' || canonical.slug
    else null
  end as personal_share_url,
  src.status,
  src.created_at,
  src.updated_at
from public.activation_sources src
left join lateral (
  select s.slug
  from public.activation_source_slugs s
  where s.activation_source_id = src.id
    and s.slug_kind = 'canonical'
    and s.status = 'active'
  order by s.created_at desc
  limit 1
) canonical on true
where src.source_type = 'user'
  and src.owner_user_id is not null;

revoke all on table public.user_activation_identities from anon;
grant select on table public.user_activation_identities to authenticated;
