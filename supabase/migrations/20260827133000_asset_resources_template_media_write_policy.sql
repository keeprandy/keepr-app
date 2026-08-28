-- Let Model Catalog media use the same attachment + placement contract as
-- Boat Showcase. The attachment remains the stored file/link; this only adds
-- model templates as a legal placement target.

alter table public.attachment_placements
  drop constraint if exists attachment_placements_target_type_check;

alter table public.attachment_placements
  add constraint attachment_placements_target_type_check
  check (
    target_type = any (
      array[
        'asset'::text,
        'system'::text,
        'service_record'::text,
        'event'::text,
        'model_template'::text
      ]
    )
  );

drop policy if exists "Readable model template attachment placements" on public.attachment_placements;
create policy "Readable model template attachment placements"
  on public.attachment_placements
  for select
  to authenticated
  using (
    target_type = 'model_template'
    and exists (
      select 1
      from public.asset_model_templates template
      where template.id = attachment_placements.target_id
        and (
          template.status = 'published'
          or public.activator_user_can_manage_template(auth.uid(), template.id)
        )
    )
  );

drop policy if exists "Template managers create model template attachment placements" on public.attachment_placements;
create policy "Template managers create model template attachment placements"
  on public.attachment_placements
  for insert
  to authenticated
  with check (
    target_type = 'model_template'
    and exists (
      select 1
      from public.attachments attachment
      join public.asset_model_templates template
        on template.id = attachment_placements.target_id
      where attachment.id = attachment_placements.attachment_id
        and attachment.owner_user_id = auth.uid()
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  );

drop policy if exists "Template managers update model template attachment placements" on public.attachment_placements;
create policy "Template managers update model template attachment placements"
  on public.attachment_placements
  for update
  to authenticated
  using (
    target_type = 'model_template'
    and exists (
      select 1
      from public.asset_model_templates template
      where template.id = attachment_placements.target_id
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  )
  with check (
    target_type = 'model_template'
    and exists (
      select 1
      from public.asset_model_templates template
      where template.id = attachment_placements.target_id
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  );

drop policy if exists "Template managers delete model template attachment placements" on public.attachment_placements;
create policy "Template managers delete model template attachment placements"
  on public.attachment_placements
  for delete
  to authenticated
  using (
    target_type = 'model_template'
    and exists (
      select 1
      from public.asset_model_templates template
      where template.id = attachment_placements.target_id
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  );
