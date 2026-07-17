create extension if not exists pgcrypto;

drop function if exists public.delete_service_record_full(uuid);
