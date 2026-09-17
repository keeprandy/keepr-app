# Asset Smart Data Operating Model

Keepr should be understood as three durable layers:

1. Evidence
   Manuals, warranties, invoices, registrations, photos, links, service records, and other source artifacts.

2. Smart Data
   Interpreted claims, rules, dates, intervals, coverage, applicability, requirements, provenance, and confidence derived from Evidence.

3. Operations
   Existing Actions/reminders, watches, warnings, and recommendations derived from Smart Data.

The product goal is to let an owner enable a Keepr Agent they can trust.

A Keepr Agent is not a separate data model or a private chatbot. It is an authorized operating role that can understand the asset from governed Keepr context, reason over Smart Data, propose or maintain Actions, request evidence, and write back completion state without silently overwriting authoritative facts.

Trust comes from four constraints:

- the agent sees eligible ownership context by default;
- explicit exclusions and privacy rules are preserved;
- claims, rules, and recommendations retain evidence, provenance, applicability, and confidence;
- operational writes land in existing Actions/reminders with auditable evidence references.

The bridge is Proof Builder:

`Evidence -> identify -> associate -> extract -> verify -> operationalize`

## Context Inclusion

Keepr uses an "all, then peel back" model.

Everything that legitimately belongs to MY Context should be eligible for authorized AI Context by default. The owner should not have to manually select every manual, warranty, invoice, link, photo, registration, service record, or attachment before an authorized agent can reason over it.

Peel back only by explicit controls:

- Excluded from AI: do not project to AI Context.
- Private/internal privacy: suppress from public or unauthorized projections.
- Task relevance and caps: summarize or limit volume without changing the underlying MY Context.
- Authority semantics: classify how a source should be used rather than hiding it.

Showcase is a separate human-facing axis. It must not determine AI visibility.

## Core Relationship

The generic relationship is:

`Evidence -> interpreted claim/rule -> applies-to relationship -> operational consequence`

Actions and reminders remain Keepr's operational primitive. Do not build a parallel task/reminder system.

Actions should reference the Smart Data and Evidence that caused them. They may carry owner-facing title, due date, status, responsible party, and a short reason, but they should not duplicate the full interpreted intelligence.

## Generic Examples

Warranty:

- Evidence: tire warranty document
- Smart Data: coverage terms, covered tire/system relationship, expiration, exclusions, proof required for claim, authority/provenance/confidence
- Operation: if tire damage occurs inside coverage, warn owner to review claim requirements before paying out of pocket

Manual:

- Evidence: owner manual or service manual
- Smart Data: service intervals, fluid specs, storage requirements, inspection intervals, authority/provenance/confidence
- Operation: create or update reminders only when a rule applies to this exact asset/system

Invoice:

- Evidence: invoice, receipt, work order, service record proof
- Smart Data: what work occurred, affected system, date, mileage/hours, provider, proof relationship, confidence
- Operation: satisfy an existing Action or reset a future obligation after verification

## Acceptance Test

Keepr passes when it can ingest a manual, warranty, or invoice, turn it into meaningful asset-specific Smart Data, project that context through `/ai` and MCP, and let ChatGPT/KAI correctly determine what the owner needs to do next and why.

This must stay generic. Porsche, Alfa, boat, generator, pool, and HVAC behavior should use the same Evidence -> Smart Data -> Operations architecture, with asset-specific meaning represented as data, not new asset-type-specific systems.
