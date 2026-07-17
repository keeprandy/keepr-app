create table if not exists public.public_asset_thread_tokens (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.asset_threads(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  sender_email text not null,
  sender_name text,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);

create index if not exists public_asset_thread_tokens_thread_id_idx
  on public.public_asset_thread_tokens(thread_id);

create index if not exists public_asset_thread_tokens_asset_id_idx
  on public.public_asset_thread_tokens(asset_id);

alter table public.public_asset_thread_tokens enable row level security;

comment on table public.public_asset_thread_tokens is
  'Stores hashed opaque public sender conversation tokens. Raw tokens are never persisted.';

comment on column public.public_asset_thread_tokens.token_hash is
  'SHA-256 hash of the public sender conversation token.';
