drop policy if exists "Activator readers read systems" on public.systems;
create policy "Activator readers read systems"
  on public.systems
  for select
  to authenticated
  using (public.activator_user_can_read_asset(auth.uid(), asset_id));

drop policy if exists "Activator managers insert systems" on public.systems;
create policy "Activator managers insert systems"
  on public.systems
  for insert
  to authenticated
  with check (public.activator_user_can_manage_asset(auth.uid(), asset_id));

drop policy if exists "Activator managers update systems" on public.systems;
create policy "Activator managers update systems"
  on public.systems
  for update
  to authenticated
  using (public.activator_user_can_manage_asset(auth.uid(), asset_id))
  with check (public.activator_user_can_manage_asset(auth.uid(), asset_id));

drop policy if exists "Activator managers delete systems" on public.systems;
create policy "Activator managers delete systems"
  on public.systems
  for delete
  to authenticated
  using (public.activator_user_can_manage_asset(auth.uid(), asset_id));

comment on policy "Activator readers read systems" on public.systems is
  'KeeprSpace/OEM relationship readers can load canonical systems for assets they can access.';

comment on policy "Activator managers update systems" on public.systems is
  'KeeprSpace/OEM relationship managers can edit canonical systems through the shared Keepr system experience.';
