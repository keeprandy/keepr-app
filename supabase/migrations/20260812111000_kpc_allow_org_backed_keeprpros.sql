-- KPC V1 compatibility: KeeprPro rows can represent canonical org-backed
-- identities before any one owner saves them to a personal Blackbook.
--
-- The owner-specific association lives in profile_kpc_relationships. Keeping
-- user_id nullable prevents global KPC directory saves from creating private,
-- duplicate provider identities just to satisfy the legacy contact shape.

alter table public.keepr_pros
  alter column user_id drop not null;
