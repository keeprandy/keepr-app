alter table public.profiles
  add column if not exists preferred_contact_email text,
  add column if not exists provisional_slug text,
  add column if not exists provisional_slug_confirmed_at timestamptz,
  add column if not exists profile_initialized_at timestamptz,
  add column if not exists policy_accepted_at timestamptz,
  add column if not exists policy_version text;

comment on column public.profiles.preferred_contact_email is
  'User-editable contact email. This is not an authentication identity key.';

comment on column public.profiles.provisional_slug is
  'Private provisional Keepr address generated during progressive onboarding. Not public until confirmed.';

comment on column public.profiles.provisional_slug_confirmed_at is
  'When the provisional Keepr address was confirmed or replaced by the user.';

comment on column public.profiles.profile_initialized_at is
  'When the minimum Keepr identity row was initialized for this user.';

comment on column public.profiles.policy_accepted_at is
  'When the user accepted Keepr Terms and Privacy Policy for account creation.';

comment on column public.profiles.policy_version is
  'Terms/privacy policy version accepted by the user.';

create unique index if not exists profiles_provisional_slug_unique_idx
  on public.profiles (lower(provisional_slug))
  where provisional_slug is not null;
