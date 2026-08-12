-- Remove Codex validation accounts from member invite impact.

update public.activation_sessions s
set internal_test_status = 'test',
    status = case when s.status in ('open', 'identified') then 'ignored' else s.status end,
    metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
      'internal_test_marked_at', now(),
      'internal_test_marked_by', '20260806151000_keepr_effect_remove_codex_test_attribution',
      'internal_test_reason', 'Codex validation account must not count as member invite impact'
    ),
    updated_at = now()
from public.profiles p
where s.converted_user_id = p.id
  and lower(coalesce(p.email, '')) like '%+codex%';

update public.attribution_records ar
set status = 'ignored',
    metadata = coalesce(ar.metadata, '{}'::jsonb) || jsonb_build_object(
      'internal_test_removed_at', now(),
      'internal_test_removed_by', '20260806151000_keepr_effect_remove_codex_test_attribution',
      'internal_test_reason', 'Codex validation account must not count as member invite impact'
    ),
    updated_at = now()
from public.profiles p
where ar.user_id = p.id
  and lower(coalesce(p.email, '')) like '%+codex%'
  and ar.status = 'verified';
