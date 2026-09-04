-- Organization-wide resources use the same attachment placement primitive as
-- model resources, but target the organization object directly.

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
        'model_template'::text,
        'system_template'::text,
        'org'::text
      ]
    )
  );
