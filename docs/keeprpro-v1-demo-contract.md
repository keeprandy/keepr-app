# KeeprPro V1 Demo Contract

## Baseline

- Branch point: `2c44572fa5884f83cc31e0d0cb7564f1be09a308`
- V1 branch: `feature/keeprpro-v1-engagement-loop`
- Scope: partner-believable engagement loops using existing Keepr storage.

## Product Principle

KeeprPro V1 demonstrates relationship-aware ownership coordination without
turning provider metadata into authorization.

## Gate 2: GenPro Private Loop

Status: ready for manual acceptance after reopened implementation gap.

Source node:

- Type: `keepr_pro`
- Label: `GenPro Technician`

Target node:

- Type: `system`
- Label: `Whole House Generator`

Context asset:

- Label: `Brighton Home`

Connector:

- Type: `services_system`
- Capabilities: `organization`, `operational`, `action`
- Storage source: `systems.metadata.standard.relationships.keepr_pro_ids`

Required preserved fields:

- `asset_id`
- `system_id`
- `keepr_pro_id`
- `assignment_scope=system`
- `extra_metadata.provider_target`
- `extra_metadata.keeprpro_connector`
- `service_records.keepr_pro_id`
- `story_events.metadata.keepr_pro_id`

System story destination:

- Authenticated route: `SystemStoryPrint`
- Internal URL shape: `/SystemStoryPrint?systemId=<system-id>`
- Public Service Ready route remains token based: `/SystemStoryPrint?token=<public-link-token>`

## Demo Success

1. Open Brighton Home -> Whole House Generator.
2. GenPro is visible as a system-scoped KeeprPro.
3. Request Service opens a private KeeprPro request context.
4. Create Action opens canonical Action creation with Whole House Generator as
   the visible subject and Brighton Home as parent context.
5. Inbox shows the Action with generator and provider labels.
6. Completion can create or link service history.
7. Created service record includes asset, system, and GenPro attribution.
8. Repeated completion reuses existing completion service record.
9. Provider metadata grants no additional access.

## Out Of Scope

- Provider organization accounts
- Provider administration
- Customer portfolios
- Staff queues
- Analytics
- Billing or commissions
- Universal relationship graph rewrite
- Public unauthenticated Request Service hardening
