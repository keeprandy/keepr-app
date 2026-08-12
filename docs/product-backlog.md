# Product Backlog

## Settings -> Sign-in methods V1

The Hub activation path should not be blocked by account-linking work. For the
current activation build:

- New Google or Apple sign-in may create a new Keepr user/profile.
- Existing email/password users continue using their current login.
- Identical verified emails may follow Supabase's supported identity-linking
  behavior.
- Different emails remain separate and are not automatically merged.

Implemented V1 scope:

- Show connected sign-in identities.
- Link Google while authenticated.
- Link Apple while authenticated.
- Unlink a provider with safety checks.
- Preserve one canonical Keepr user id and all owned assets.

Remaining follow-up:

- Native Google/Apple identity linking after native OAuth is implemented.
- Stronger recent-auth prompts for unlinking, such as a dedicated reauthenticate
  flow instead of requiring the user to sign out and back in.
