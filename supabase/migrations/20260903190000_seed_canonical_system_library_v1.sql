-- Seed the first reusable System Library entries.
-- These are canonical System Templates, not exact installed systems and not
-- model-specific applicability records.

insert into public.system_templates (
  canonical_key,
  name,
  manufacturer,
  system_category,
  description,
  authority_state,
  metadata
)
values
  (
    'system_template.mercury.mercury_600_v12_verado',
    'Mercury 600 V12 Verado',
    'Mercury Marine',
    'Propulsion',
    'Reusable propulsion system template for Mercury 600 V12 Verado outboard packages.',
    'keepr_curated',
    jsonb_build_object(
      'reusable_specs_text', '600 HP V12 outboard. Capture exact serial, install date, prop package, warranty registration, and dealer setup on each System Instance.',
      'warranty_guidance', 'Keep proof of purchase, dealer rigging documentation, warranty registration confirmation, and service bulletins with the exact installed system.',
      'ownership_tasks', jsonb_build_array('Annual engine service', 'Lower unit service', 'Prop inspection', 'Software/diagnostic check'),
      'playbooks', jsonb_build_array('Annual propulsion service', 'Winterization', 'Spring commissioning'),
      'proof_expectations', jsonb_build_array('Serial plate photo', 'Install invoice', 'Warranty registration', 'Service receipt'),
      'seeded_by', 'seed_canonical_system_library_v1'
    )
  ),
  (
    'system_template.seakeeper.seakeeper_sk10_5',
    'Seakeeper SK10.5',
    'Seakeeper',
    'Stabilization',
    'Reusable gyro stabilization system template for Seakeeper SK10.5 installations.',
    'keepr_curated',
    jsonb_build_object(
      'reusable_specs_text', 'Gyro stabilizer template. Capture exact installation, commissioning, serial, service interval, and controller details on each System Instance.',
      'warranty_guidance', 'Keep commissioning records, warranty registration, service interval evidence, and authorized-service documentation.',
      'ownership_tasks', jsonb_build_array('Annual inspection', 'Cooling system check', 'Controller/firmware check'),
      'playbooks', jsonb_build_array('Annual gyro service'),
      'proof_expectations', jsonb_build_array('Serial plate photo', 'Commissioning document', 'Service record'),
      'seeded_by', 'seed_canonical_system_library_v1'
    )
  ),
  (
    'system_template.onan.onan_13_5kw_generator',
    'Onan 13.5kW Generator',
    'Onan',
    'Electrical',
    'Reusable marine generator template for Onan 13.5kW generator packages.',
    'keepr_curated',
    jsonb_build_object(
      'reusable_specs_text', '13.5kW generator template. Capture exact serial, hours, install date, fuel type, battery setup, and service records on each System Instance.',
      'warranty_guidance', 'Keep purchase/install invoice, warranty registration, startup checklist, and maintenance receipts.',
      'ownership_tasks', jsonb_build_array('Oil and filter service', 'Impeller inspection', 'Load test', 'Battery and fuel check'),
      'playbooks', jsonb_build_array('Annual generator service', 'Winterization', 'Spring commissioning'),
      'proof_expectations', jsonb_build_array('Serial plate photo', 'Hour meter photo', 'Install invoice', 'Service receipt'),
      'seeded_by', 'seed_canonical_system_library_v1'
    )
  ),
  (
    'system_template.dometic_vacuflush.sanitation_system',
    'Dometic/VacuFlush Sanitation System',
    'Dometic/VacuFlush',
    'Plumbing',
    'Reusable sanitation system template for Dometic/VacuFlush marine head systems.',
    'keepr_curated',
    jsonb_build_object(
      'reusable_specs_text', 'Marine sanitation/head system template. Capture exact toilet model, pump, tank, hoses, service parts, and winterization evidence on each System Instance.',
      'warranty_guidance', 'Keep install records, part numbers, pump service documentation, and winterization proof.',
      'ownership_tasks', jsonb_build_array('Flush and inspect system', 'Check vacuum pump', 'Winterize plumbing', 'Replace wear parts as needed'),
      'playbooks', jsonb_build_array('Annual sanitation service', 'Winterization'),
      'proof_expectations', jsonb_build_array('Installed equipment photo', 'Pump/part label photo', 'Winterization record'),
      'seeded_by', 'seed_canonical_system_library_v1'
    )
  ),
  (
    'system_template.starlink.starlink_marine',
    'Starlink',
    'Starlink',
    'Connectivity',
    'Reusable connectivity system template for Starlink installations on mobile or marine assets.',
    'keepr_curated',
    jsonb_build_object(
      'reusable_specs_text', 'Satellite internet template. Capture exact kit, mount, router, power integration, account state, and install details on each System Instance.',
      'warranty_guidance', 'Keep equipment receipt, subscription/account notes, install photos, and support documentation.',
      'ownership_tasks', jsonb_build_array('Inspect mount and cable routing', 'Confirm firmware/account status', 'Verify power integration'),
      'playbooks', jsonb_build_array('Connectivity readiness check'),
      'proof_expectations', jsonb_build_array('Equipment photo', 'Mount photo', 'Receipt', 'Account/setup note'),
      'seeded_by', 'seed_canonical_system_library_v1'
    )
  )
on conflict (canonical_key) do update
set
  name = excluded.name,
  manufacturer = excluded.manufacturer,
  system_category = excluded.system_category,
  description = excluded.description,
  authority_state = case
    when public.system_templates.authority_state = 'retired' then public.system_templates.authority_state
    else excluded.authority_state
  end,
  metadata = coalesce(public.system_templates.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();
