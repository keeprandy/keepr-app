# KeeprLINK Asset Context v2 Contract

Status: proposed contract, not implemented.

Scope: this is an API contract change for the existing governed KeeprLINK resolver path:

- `GET /api/k/:address/context?purpose=llm_context`
- `public.resolve_keeprlink_context(text, text, uuid, boolean)`
- `public.keeprlink_asset_context(uuid, text, boolean)`

This contract does not make the LLM projection mirror the public story page. It defines a bounded machine-readable projection of canonical asset truth for external or authorized AI use.

## Goals

- Preserve v1 response compatibility for existing callers.
- Add the operational ownership layer: history, relationships, action state, richer system facts, evidence/resource bindings, and playbook applicability.
- Keep public context deny-by-default for private owner data and signed/private storage URLs.
- Preserve provenance on facts and claims.
- Avoid broad raw table dumps. Serialize curated, capped, purpose-scoped context.

## Non-Goals

- No new AI stack.
- No new public story architecture.
- No replacement of `/k/...` story rendering.
- No automatic promotion of inferred truth.
- No production change without reviewed SQL/code diff.

## v2 Response Shape

Existing top-level API envelope remains unchanged:

```json
{
  "ok": true,
  "purpose": "llm_context",
  "projection": {},
  "resolution": {},
  "generated_at": "2026-09-09T00:00:00.000Z",
  "instructions": {},
  "canonical_object": {},
  "manifest_version": "keeprlink-context-v2"
}
```

The `projection` object keeps the v1 keys and adds v2 keys:

```json
{
  "object": {},
  "identity": {},
  "context_summary": {},
  "parent_relationships": [],
  "relationships": [],
  "systems": [],
  "applicable_resources": [],
  "resource_bindings": [],
  "evidence_placements": [],
  "operational_history": {},
  "actions": {},
  "playbook_applicability": [],
  "known_operational_state": {},
  "knowledge_gaps": [],
  "job_readiness": []
}
```

## Compatibility

The following v1 keys must remain present and keep their current broad meaning:

- `object`
- `identity`
- `parent_relationships`
- `systems`
- `applicable_resources`
- `known_operational_state`
- `knowledge_gaps`

Breaking changes are not allowed in v2. New structure may add fields inside existing arrays, but existing field names should remain stable:

- `systems[].id`
- `systems[].address`
- `systems[].name`
- `systems[].system_type`
- `systems[].ksc_code`
- `systems[].status`
- `systems[].system_template_id`
- `systems[].system_template`
- resource `title`, `role`, `scope`, `privacy`, `authority_state`, `provenance`, and public-safe URLs

If a v1 caller ignores unknown keys, no client behavior should change.

## Field Contract

### `context_summary`

Purpose: give a machine-readable summary of what is true, what needs attention, and how complete the context is.

Example:

```json
{
  "context_readiness": "partial",
  "action_readiness": "needs_review",
  "system_count": 15,
  "system_template_linked_count": 2,
  "resource_count": 10,
  "evidence_placement_count": 24,
  "service_record_count": 17,
  "open_action_count": 2,
  "completed_action_count": 8,
  "active_playbook_count": 1,
  "recent_service_date": "2026-08-12",
  "provider_relationships_present": true,
  "unresolved_gap_count": 3,
  "attention": [
    "Engine manual is linked, but engine serial is not available in public context."
  ]
}
```

Source mapping:

- `system_count`: `public.systems where asset_id = p_asset_id`
- `system_template_linked_count`: `public.systems.system_template_id is not null`
- `resource_count`: length of `applicable_resources`
- `evidence_placement_count`: `public.attachment_placements` targeting asset or its systems
- `service_record_count`, `recent_service_date`: `public.service_records`
- `open_action_count`, `completed_action_count`: `public.actions`
- `active_playbook_count`: `public.playbooks`
- `provider_relationships_present`: `public.asset_relationships`, `public.asset_provider_stewardships`
- `unresolved_gap_count`: `assets.extra_metadata->'knowledge_gaps'` plus scoped system gaps

Privacy:

- Public: counts and coarse readiness only. No private text, serials, owner notes, signed URLs, or private relationship details.
- Authorized: counts plus more precise attention text if the caller can read the underlying object.

Provenance:

- `generated_from`: list of source tables used to compute the summary.
- Each `attention` item should carry `source_table`, optional `source_id` in authorized mode, and `reason`.

Caps:

- `attention`: max 8 items.
- Dates/counts are uncapped.

### `systems`

Purpose: preserve v1 system list and add bounded facts, claims, resource/evidence counts, and applicability hints.

Example:

```json
{
  "id": "a722a68a-3be6-491d-9d26-f238062a8437",
  "address": "/k/BOAT-2008-3BOZ95?systemId=a722a68a-3be6-491d-9d26-f238062a8437",
  "name": "Inboard/Outboard Motor",
  "system_type": "motor",
  "ksc_code": "ENG-MAIN",
  "status": "active",
  "system_template_id": null,
  "system_template": null,
  "facts": {
    "manufacturer": null,
    "model": null,
    "serial_number": null,
    "location": null,
    "installed_at": null
  },
  "claims": [],
  "resource_count": 1,
  "evidence_count": 1,
  "open_action_count": 0,
  "applicable_playbook_count": 0
}
```

Source mapping:

- Current v1 fields: `public.systems`, left join `public.system_templates`.
- `facts`: `systems.manufacturer`, `systems.model`, `systems.metadata`, `systems.mode`, `systems.lifecycle_status`, `system_templates` where linked.
- Counts: `attachment_placements`, `asset_resources`, `actions`, `playbooks` scoped to each system.
- `claims`: derived only from existing canonical rows, not LLM inference.

Privacy:

- Public: omit serial numbers, private notes, private install evidence, and private metadata keys. Include manufacturer/model/type when not marked private.
- Authorized: include serial/config fields only if the authenticated caller can read the system/asset.

Provenance:

- Each fact should expose `source` when available: `system_row`, `system_template`, `asset_resource`, `attachment_placement`, or `service_record`.
- Each claim must include `claim_type`, `reason`, `source_table`, `source_id` when authorized, `confidence`, and `authority_state`.

Caps:

- Return all systems for the asset, ordered by name.
- `facts` should be normalized and compact; do not dump full `metadata`.
- `claims`: max 5 per system.

### `relationships`

Purpose: expose provider, owner/dealer/service/OEM, and other asset relationships as context, separate from v1 model-template `parent_relationships`.

Example:

```json
{
  "relationship_type": "service_provider",
  "organization": {
    "id": "safe-if-authorized",
    "name": "Wilson Marine",
    "slug": "wilsonmarine"
  },
  "status": "active",
  "access_scope": "relationship",
  "authority_state": "dealer_confirmed",
  "provenance": {
    "source_table": "asset_relationships",
    "source_id": "authorized-only"
  }
}
```

Source mapping:

- `public.asset_relationships`
- `public.asset_provider_stewardships`
- `public.organizations` / `public.orgs`
- `public.keepr_pros` only where existing relationship rows depend on KeeprPro identity

Privacy:

- Public: include only public-safe organization display names and relationship categories that are allowed for public asset context. Exclude private owner identity and private relationship metadata.
- Authorized: include status, access scope, claim state, and relationship row IDs when caller can read the relationship.

Provenance:

- `source_table`, `source_id` authorized-only, `claim_state`, `initiated_by` category, `source_resource_id` when public-safe.

Caps:

- Max 20 relationships.
- Prefer active/current relationships; summarize expired relationships by count.

### `operational_history`

Purpose: expose service/story/timeline context as operational history, not as raw service record dumps.

Example:

```json
{
  "summary": {
    "total_records": 17,
    "recent_service_date": "2026-08-12",
    "verified_record_count": 4,
    "records_with_proof_count": 6
  },
  "recent": [
    {
      "id": "authorized-only",
      "title": "Annual service",
      "kind": "service",
      "performed_at": "2026-08-12",
      "verified": true,
      "document_count": 1,
      "photo_count": 2,
      "system_refs": []
    }
  ]
}
```

Source mapping:

- `public.service_records`
- proof counts from the existing public story timeline contract, currently represented by `public.public_asset_story_timeline`
- `service_record_documents`
- `service_record_photos`
- optional contribution tables from relationship record contribution migrations

Privacy:

- Public: include date/title/kind/verification/proof counts only when the public story policy would expose the record. Do not include private notes or storage URLs.
- Authorized: include notes/descriptions and linked proof descriptors only when caller can read them.

Provenance:

- Each item carries `source_table = service_records`, authorized `source_id`, verification state, contribution/relationship source if present.

Caps:

- `recent`: max 10 records by `performed_at desc`.
- Include summary counts for omitted records.
- Long text fields max 280 characters public, 700 authorized.

### `evidence_placements`

Purpose: expose the evidence graph as placements, distinct from resource descriptors.

Example:

```json
{
  "target_type": "system",
  "target_id": "a722a68a-3be6-491d-9d26-f238062a8437",
  "target_label": "Inboard/Outboard Motor",
  "attachment": {
    "id": "authorized-only",
    "title": "Mercruiser Service Manual #31 - MP 5.0",
    "kind": "link",
    "role": "manual",
    "ai_context": "primary",
    "privacy": "moves_with_asset",
    "access_mode": "public_url"
  },
  "provenance": {
    "source_table": "attachment_placements",
    "source_id": "authorized-only"
  }
}
```

Source mapping:

- `public.attachment_placements`
- `public.attachments`
- same sanitizer rules as `public.keeprlink_resource_projection`

Privacy:

- Public: include only attachments whose AI context is `primary` or `supporting` and whose privacy is not internal/private/restricted/secret. Never include signed Supabase storage URLs.
- Authorized: include private descriptors only if caller can read them; still do not expose signed URLs through `llm_context`.

Provenance:

- `placement_id`, `attachment_id`, target, role, label, source context. IDs can be omitted in public mode if needed.

Caps:

- Max 40 placements total.
- Prioritize primary resources, system-specific placements, and recent evidence.
- If capped, include `omitted_count`.

### `applicable_resources`

Purpose: preserve v1 resource projection.

Source mapping:

- Existing `public.keeprlink_resource_projection(text, uuid[], boolean)`.
- It currently projects from `public.asset_resources` and `public.attachment_placements` plus `public.attachments`.

Privacy:

- Preserve existing sanitizer behavior.
- No signed/private Supabase storage URLs.

Provenance:

- Preserve current `provenance` object.
- Add `binding_path` in v2 where possible: `asset`, `system`, `system_template`, `model_template`, or `org`.

Caps:

- Current behavior returns all matching resource descriptors. v2 should cap at 60 with deterministic priority:
  1. primary AI context
  2. system-specific
  3. asset-specific
  4. template/system-template
  5. supporting

### `resource_bindings`

Purpose: summarize how resources attach to the graph without duplicating full resource payloads.

Source mapping:

- `attachment_placements`
- `asset_resources`
- `asset_template_bindings`
- `systems.system_template_id`

Privacy:

- Public: target path and resource title/role/status only when public-safe.
- Authorized: include internal IDs and review state when readable.

Provenance:

- `source_table`, authorized `source_id`, `created_at` if public-safe.

Caps:

- Max 80 bindings, grouped by target.

### `actions`

Purpose: expose current and completed action state relevant to the asset without replacing the actions product.

Example:

```json
{
  "current": [
    {
      "title": "Schedule winterization",
      "status": "open",
      "priority": 50,
      "due_at": "2026-10-15",
      "source": {
        "table": "actions",
        "source_table": "systems",
        "source_id": "authorized-only"
      }
    }
  ],
  "completed_summary": {
    "count": 8,
    "recent_completed_at": "2026-08-01"
  }
}
```

Source mapping:

- `public.actions`
- Existing action helper/API contract in `lib/actionsApi.js`
- Link to asset through `actions.source_table/source_id`, `payload`, or explicit asset references where present.

Privacy:

- Public: no assignee emails/user IDs, no private body text. Include only public-safe task categories if applicable.
- Authorized: include assigned party category and body only when caller can read action.

Provenance:

- `source_table = actions`, authorized `id`, `created_by_type`, `source_table/source_id`, and payload source if safe.

Caps:

- `current`: max 10, sorted by priority/due date.
- Completed actions summarized by count and most recent date; include max 5 recent completed only in authorized mode.

### `playbook_applicability`

Purpose: bridge context to repeatable ownership work without making the LLM perform execution.

Example:

```json
{
  "name": "Winterization",
  "status": "active",
  "scope": "asset",
  "system_id": null,
  "source": {
    "table": "playbooks",
    "id": "authorized-only",
    "source_playbook_id": "authorized-only"
  },
  "step_summary": {
    "planned": 4,
    "activated": 1,
    "complete": 2
  }
}
```

Source mapping:

- `public.playbooks`
- `public.playbook_steps`
- Future reusable playbook catalogs when present
- Existing playbook RLS helpers: `keeprspace_user_can_read_playbook`, `keeprspace_user_can_manage_playbook`

Privacy:

- Public: include only generic playbook category/name and applicability if public-safe.
- Authorized: include instance status and step summary. Step details only if readable.

Provenance:

- `source_table = playbooks`, authorized `id`, `source_playbook_id`, `created_by_type`, linked system/relationship.

Caps:

- Max 10 playbooks.
- Step details omitted by default; include summarized counts.

### `knowledge_gaps`

Purpose: keep v1 generic gaps but normalize entries where possible.

Source mapping:

- `assets.extra_metadata->'knowledge_gaps'`
- `systems.metadata->'knowledge_gaps'`
- missing required fields inferred by deterministic resolver checks, not LLM guesses

Privacy:

- Public: generic missing-context labels only.
- Authorized: include related system/resource IDs and review notes if readable.

Provenance:

- `source`: `asset_metadata`, `system_metadata`, or `resolver_check`.

Caps:

- Max 20 gaps.

### `job_readiness`

Purpose: forward-compatible structure for v3 agent work. Phase 1 may return an empty array or a small deterministic set.

Example:

```json
[
  {
    "job": "winterize_boat",
    "status": "research_required",
    "missing_context": [
      "engine_model",
      "drive_model",
      "authoritative_winterization_procedure"
    ],
    "authority_status": "approval_required"
  }
]
```

Source mapping:

- Phase 1: deterministic resolver checks against system facts, resources, and playbook applicability.
- Later: approved job catalog / reusable playbook definitions.

Privacy:

- Public: high-level readiness only.
- Authorized: can include exact missing system fields if readable.

Provenance:

- `source = resolver_check` until a job catalog exists.

Caps:

- Max 8 jobs.

## Public vs Authorized Behavior

Public context is used when `p_authorized = false`, including public-safe `llm_context` calls without a bearer token.

Public projection must:

- include only public-safe URLs/descriptors;
- never include signed Supabase storage URLs;
- never include private owner identity, emails, user IDs, internal notes, private relationship metadata, or raw storage paths;
- omit serial numbers unless explicitly marked public-safe by an existing policy;
- summarize sensitive history/actions/playbooks rather than dumping raw rows.

Authorized projection may include richer data only when the authenticated caller has read access through the existing RLS/helper contract.

Authorized projection must still:

- avoid signed storage URLs in LLM context;
- preserve provenance;
- cap high-volume sections;
- avoid raw `metadata` dumps.

## Provenance Rules

Every fact or claim added in v2 should be traceable.

Facts:

- direct field values from canonical rows;
- source table named;
- source row ID included only in authorized mode unless already public-safe.

Claims:

- derived by deterministic resolver logic only;
- must include `claim_type`, `reason`, `source_table`, `confidence`, and `authority_state`;
- cannot be phrased as fact unless the underlying source establishes it.

Resources/evidence:

- carry attachment/resource/placement provenance;
- distinguish `asset`, `system`, `system_template`, and `model_template` bindings.

## Truncation and Size Budget

Default public `llm_context` should target a compact response that remains pasteable into external LLMs.

Recommended caps:

- systems: all systems
- system claims: 5 per system
- applicable resources: 60
- resource bindings: 80
- evidence placements: 40
- operational history recent records: 10
- actions current: 10
- actions completed detail: summary only public, max 5 authorized
- playbooks: 10
- knowledge gaps: 20
- job readiness: 8
- individual public text fields: 280 chars
- individual authorized text fields: 700 chars

When a section is capped, return:

```json
{
  "omitted_count": 12,
  "cap_reason": "section_limit"
}
```

## BOAT-2008-3BOZ95 Acceptance Fixture

For `BOAT-2008-3BOZ95`, v2 should prove:

- the Mercruiser manual linked through Proof Builder appears in `applicable_resources`;
- the same manual/system associations are visible in `resource_bindings` and `evidence_placements`;
- the Inboard/Outboard Motor system has richer facts where known and clear gaps where unknown;
- service history is summarized in `operational_history`;
- asset/provider relationships appear in `relationships`;
- action/playbook sections are present even if empty or summarized;
- public projection contains no signed/private storage URLs.

## Rollout Plan

Phase 1:

- `context_summary`
- richer `systems[].facts`
- `relationships`
- `operational_history`
- `resource_bindings`
- `evidence_placements`
- normalized `knowledge_gaps`

Phase 2:

- `actions`
- `playbook_applicability`

Phase 3:

- `job_readiness`
- stronger actionability/readiness claims

## Review Gate

Implementation should not begin until this contract is approved.

Implementation diff should be limited to:

- SQL migration or package file that replaces/extends `public.keeprlink_asset_context`;
- helper functions only if they already mirror existing canonical resolver/table contracts;
- tests for public vs authorized projection, caps, and no signed URL leakage.

No production apply until the implementation diff is separately reviewed and approved.
