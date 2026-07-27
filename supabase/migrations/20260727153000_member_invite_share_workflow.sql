-- Production Mode 2.0: member invite share workflow on Activation Engine.
--
-- Scope:
-- - Adds a public, preview-safe resolver for clean /invite/:slug links.
-- - Notifies the source member when a verified signup attribution joins from
--   their member activation source.
-- - Preserves existing /s/:token share actions, activation sessions, and
--   historical attribution data.

create or replace function public.resolve_member_invite_link(p_slug text)
returns table (
  resolution_state text,
  activation_source_id uuid,
  source_type text,
  display_name text,
  slug text,
  normalized_slug text,
  slug_kind text,
  is_redirect boolean,
  title text,
  description text,
  image_url text,
  cta text,
  route_name text,
  route_path text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resolved record;
begin
  select *
    into resolved
    from public.resolve_activation_source_slug(p_slug)
    limit 1;

  resolution_state := coalesce(resolved.resolution_state, 'unresolved');
  activation_source_id := resolved.activation_source_id;
  source_type := resolved.source_type;
  display_name := resolved.display_name;
  slug := resolved.slug;
  normalized_slug := resolved.normalized_slug;
  slug_kind := resolved.slug_kind;
  is_redirect := coalesce(resolved.is_redirect, false);
  title := case
    when resolved.source_type = 'user' then 'Join Keepr'
    else 'Open Keepr'
  end;
  description := case
    when resolved.source_type = 'user' and nullif(trim(resolved.display_name), '') is not null
      then resolved.display_name || ' invited you to Keepr.'
    when resolved.source_type = 'user'
      then 'A Keepr member invited you to start building the story of what you own.'
    else 'Start building the story of what you own.'
  end;
  image_url := null;
  cta := 'Create your Keepr account';
  route_name := 'Invite';
  route_path := '/invite/' || coalesce(resolved.normalized_slug, public.normalize_activation_slug(p_slug), '');
  return next;
end;
$$;

revoke all on function public.resolve_member_invite_link(text) from public;
grant execute on function public.resolve_member_invite_link(text) to anon, authenticated;

create or replace function public.notify_member_invite_attribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row public.activation_sources%rowtype;
  joined_display_name text;
begin
  if new.activation_source_id is null
    or new.status <> 'verified'
    or new.attribution_model <> 'person'
    or to_regclass('public.notifications') is null
  then
    return new;
  end if;

  select *
    into source_row
    from public.activation_sources src
    where src.id = new.activation_source_id
      and src.source_type = 'user'
    limit 1;

  if source_row.owner_user_id is null
    or source_row.owner_user_id = new.user_id
  then
    return new;
  end if;

  select nullif(trim(coalesce(p.display_name, '')), '')
    into joined_display_name
    from public.profiles p
    where p.id = new.user_id
    limit 1;

  execute
    'insert into public.notifications (user_id, type, title, body, payload)
     values ($1, $2, $3, $4, $5)'
  using
    source_row.owner_user_id,
    'member_invite_joined',
    'Someone joined Keepr from your invite',
    coalesce(joined_display_name, 'A new Keepr member') || ' joined from your invite.',
    public.sanitize_activation_jsonb(jsonb_build_object(
      'attribution_record_id', new.id,
      'activation_source_id', new.activation_source_id,
      'activation_session_id', new.activation_session_id,
      'joined_user_id', new.user_id,
      'source_slug', new.source_slug_snapshot,
      'notification_type', 'member_invite_joined',
      'created_by_build', 'production_mode_2_member_invite_share_workflow'
    ));

  return new;
exception
  when undefined_table or undefined_column then
    return new;
end;
$$;

drop trigger if exists notify_member_invite_attribution_after_insert on public.attribution_records;
create trigger notify_member_invite_attribution_after_insert
after insert on public.attribution_records
for each row execute function public.notify_member_invite_attribution();
