insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'org-images',
  'org-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read org images'
  ) then
    create policy "Public read org images"
      on storage.objects
      for select
      to public
      using (bucket_id = 'org-images');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated upload org images'
  ) then
    create policy "Authenticated upload org images"
      on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'org-images');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated update org images'
  ) then
    create policy "Authenticated update org images"
      on storage.objects
      for update
      to authenticated
      using (bucket_id = 'org-images')
      with check (bucket_id = 'org-images');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated delete org images'
  ) then
    create policy "Authenticated delete org images"
      on storage.objects
      for delete
      to authenticated
      using (bucket_id = 'org-images');
  end if;
end $$;
