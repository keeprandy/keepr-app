create extension if not exists pgcrypto with schema extensions;

create or replace function public.digest(data text, type text)
returns bytea
language sql
immutable
parallel safe
set search_path = extensions, pg_catalog
as $$
  select extensions.digest(data, type);
$$;
