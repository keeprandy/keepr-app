-- Backfill Activation Engine member identities for existing profile handles.
-- This materializes durable /invite/{slug} URLs for members who already have
-- username or inbox_name values, without creating or changing attribution credit.

do $$
declare
  profile_row record;
begin
  for profile_row in
    select p.id
    from public.profiles p
    where (
        public.is_valid_personal_activation_slug(p.username)
        or public.is_valid_personal_activation_slug(p.inbox_name)
      )
    order by p.created_at asc
  loop
    perform *
    from public.ensure_user_activation_identity(
      profile_row.id,
      'https://www.keeprhome.com/invite'
    );
  end loop;
end;
$$;
