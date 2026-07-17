insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('asset-photos', 'asset-photos', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[]),
  ('asset-files', 'asset-files', false, 52428800, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']::text[])
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staging_asset_photos_auth_insert_own" on storage.objects;
drop policy if exists "staging_asset_photos_auth_read_own" on storage.objects;
drop policy if exists "staging_asset_photos_auth_update_own" on storage.objects;
drop policy if exists "staging_asset_photos_auth_delete_own" on storage.objects;
drop policy if exists "staging_asset_files_auth_insert_own" on storage.objects;
drop policy if exists "staging_asset_files_auth_read_own" on storage.objects;
drop policy if exists "staging_asset_files_auth_update_own" on storage.objects;
drop policy if exists "staging_asset_files_auth_delete_own" on storage.objects;

create policy "staging_asset_photos_auth_insert_own"
on storage.objects for insert to authenticated
with check (bucket_id = 'asset-photos' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = auth.uid()::text);

create policy "staging_asset_photos_auth_read_own"
on storage.objects for select to authenticated
using (bucket_id = 'asset-photos' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = auth.uid()::text);

create policy "staging_asset_photos_auth_update_own"
on storage.objects for update to authenticated
using (bucket_id = 'asset-photos' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = auth.uid()::text)
with check (bucket_id = 'asset-photos' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = auth.uid()::text);

create policy "staging_asset_photos_auth_delete_own"
on storage.objects for delete to authenticated
using (bucket_id = 'asset-photos' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = auth.uid()::text);

create policy "staging_asset_files_auth_insert_own"
on storage.objects for insert to authenticated
with check (bucket_id = 'asset-files' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = auth.uid()::text);

create policy "staging_asset_files_auth_read_own"
on storage.objects for select to authenticated
using (bucket_id = 'asset-files' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = auth.uid()::text);

create policy "staging_asset_files_auth_update_own"
on storage.objects for update to authenticated
using (bucket_id = 'asset-files' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = auth.uid()::text)
with check (bucket_id = 'asset-files' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = auth.uid()::text);

create policy "staging_asset_files_auth_delete_own"
on storage.objects for delete to authenticated
using (bucket_id = 'asset-files' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = auth.uid()::text);
