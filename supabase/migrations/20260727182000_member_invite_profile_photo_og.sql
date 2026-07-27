-- Member invite OG should prefer the source member's profile photo when present.
-- The canonical member-node image remains the app/server fallback for missing photos.

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
  owner_profile record;
  member_display_name text;
  member_image_url text;
begin
  select *
    into resolved
    from public.resolve_activation_source_slug(p_slug)
    limit 1;

  if resolved.source_type = 'user' and resolved.activation_source_id is not null then
    select
      nullif(trim(coalesce(p.full_name, '')), '') as full_name,
      nullif(trim(coalesce(p.display_name, '')), '') as display_name,
      nullif(trim(coalesce(p.username, '')), '') as username,
      nullif(trim(coalesce(p.inbox_name, '')), '') as inbox_name,
      case
        when a.id is null then null
        when coalesce(a.mime_type, '') not ilike 'image/%' then null
        when nullif(trim(coalesce(a.url, '')), '') is not null then nullif(trim(a.url), '')
        when nullif(trim(coalesce(a.bucket, '')), '') is not null
          and nullif(trim(coalesce(a.storage_path, '')), '') is not null
          then 'https://jjzjuqxysucqutgjnrkk.supabase.co/storage/v1/object/public/'
            || trim(a.bucket)
            || '/'
            || trim(a.storage_path)
        else null
      end as profile_image_url
      into owner_profile
      from public.activation_sources src
      left join public.profiles p on p.id = src.owner_user_id
      left join public.attachments a on a.id = p.profile_photo_attachment_id
      where src.id = resolved.activation_source_id
      limit 1;
  end if;

  member_display_name := coalesce(
    owner_profile.full_name,
    owner_profile.display_name,
    owner_profile.username,
    owner_profile.inbox_name,
    nullif(trim(coalesce(resolved.display_name, '')), ''),
    'Keepr member'
  );

  member_image_url := nullif(trim(coalesce(owner_profile.profile_image_url, '')), '');

  resolution_state := coalesce(resolved.resolution_state, 'unresolved');
  activation_source_id := resolved.activation_source_id;
  source_type := resolved.source_type;
  display_name := member_display_name;
  slug := resolved.slug;
  normalized_slug := resolved.normalized_slug;
  slug_kind := resolved.slug_kind;
  is_redirect := coalesce(resolved.is_redirect, false);
  title := case
    when resolved.source_type = 'user' then member_display_name || ' invited you to Keepr'
    else 'Open Keepr'
  end;
  description := case
    when resolved.source_type = 'user'
      then member_display_name || ' invited you to start building the story of what you own.'
    else 'Start building the story of what you own.'
  end;
  image_url := member_image_url;
  cta := 'Create your Keepr account';
  route_name := 'Invite';
  route_path := '/invite/' || coalesce(resolved.normalized_slug, public.normalize_activation_slug(p_slug), '');
  return next;
end;
$$;

revoke all on function public.resolve_member_invite_link(text) from public;
grant execute on function public.resolve_member_invite_link(text) to anon, authenticated;
