# Keepr Passport Domain Model

Status: conceptual architecture, no implementation authorized

## Foundational Definition

A Keepr Passport is the persistent, governed digital continuity of a physical
asset, rooted in its manufacture and carried throughout its lifecycle.

The Asset is the durable entity. Manufacturers, dealers, suppliers, service
providers, owners, environments, software systems, and intelligence models may
change around it. The Passport preserves the identity, state, knowledge,
relationships, evidence, requirements, history, and operational consequences
that remain connected to the Asset over time.

The Passport is not another Space, screen, chat system, or parallel database.
It is the governed domain aggregate behind an Asset. Product surfaces and
external clients receive projections of that aggregate according to
relationship, authority, purpose, and time.

## Core Constructs

### KAC

Question: Which exact physical thing?

The KAC is Keepr's stable identity and address for one physical Asset. It must
survive changes in owner, location, service provider, operational state, and
presentation.

The KAC identifies the root of a Passport. It does not by itself grant access
to the Passport.

### Passport

Question: What does Keepr govern and remember about this thing throughout its
life?

The Passport is the complete governed continuity surrounding the Asset. It can
contain:

- exact identity and identifiers;
- model and manufacturing lineage;
- as-designed, as-built, delivered, and current configuration;
- installed Systems and components;
- facts, claims, rules, requirements, and coverage;
- resources and evidence;
- participant and provider relationships;
- Jobs, Playbooks, Actions, and responsibilities;
- operational history and outcomes;
- unresolved questions, exceptions, and knowledge gaps;
- lifecycle transitions, replacements, transfers, and retired state;
- provenance, authority, confidence, privacy, and applicability.

The Passport is more than a knowledge base. It is the Asset's persistent
digital organism: identity, memory, state, relationships, and continuity.

### Passport Graph

Question: How is everything known about the Asset connected?

The Passport Graph is the structured topology inside the Passport. It is the
Asset's memory and central nervous system.

Representative node classes:

- Asset instance;
- model, option, and configuration;
- System and component instance;
- fact, claim, rule, requirement, and coverage;
- resource and evidence;
- organization, person, and relationship;
- Job, Playbook, Action, and responsibility;
- event, outcome, and lifecycle state;
- exception and knowledge gap.

Representative edge semantics:

- `instance_of` and `inherits_from`;
- `configured_with` and `installed_on`;
- `applies_to` and `requires`;
- `documented_by` and `evidenced_by`;
- `manufactured_by`, `supplied_by`, and `serviced_by`;
- `authorized_for` and `capable_of`;
- `contributed_by` and `verified_by`;
- `caused`, `completed_by`, and `satisfied_by`;
- `replaces`, `supersedes`, and `transferred_to`.

The graph is canonical underneath. Projections select from it; they do not
create participant-specific copies of the Asset.

### Job

Question: What are we trying to accomplish now?

A Job supplies purpose. Examples include delivery, winterization, annual
service, diagnosing a failure, evaluating a quote, making a warranty claim,
upgrading a System, selling, or transferring the Asset.

The Job determines relevance. Without a Job or other explicit intent,
authorized data is merely reachable; it is not automatically relevant.

### Contextual Aperture

Question: Which authorized portion of the Passport Graph is necessary to
advance the Job?

Context is an authorized, Job-specific projection of the Passport Graph.

Formally:

```text
Context = project(Passport Graph, participant, authority, Job, time)
```

The projection should provide minimum sufficient relevant context. It should
not dump the Passport or equate authorization with relevance.

Every aperture should be able to explain:

- what was included;
- why it was relevant;
- what was summarized;
- what was excluded as irrelevant;
- what was withheld by authority or privacy;
- what remains unknown.

### Asset Lifecycle Intelligence

Asset Lifecycle Intelligence is Keepr's ability to resolve the exact Asset,
traverse its governed Passport Graph, select the correct contextual aperture,
reason about what the connections mean, and help participants advance the
current Job while preserving evidence and continuity.

It is not a separate chatbot and does not own a parallel truth model.

## Domain Equation

```text
KAC
  -> Passport
     -> Passport Graph
        -> Job
           -> Contextual Aperture
              -> Intelligence
                 -> Proposal
                    -> Authority
                       -> Action
                          -> Evidence
                             -> Outcome
                                -> Continuity
```

## Projection Model

A projection is a governed view of the same Passport:

```text
KAC
+ participant relationship
+ authority
+ purpose or Job
+ lifecycle time
= Passport projection
```

### OEM Projection

An OEM projection may include model knowledge, as-designed and as-built
configuration, OEM resources, product requirements, factory exceptions,
applicable campaigns, and authorized field signals. It does not imply access
to private owner conversations or unrelated operational history.

### Dealer Projection

A dealer projection may include assigned inventory, exact configuration,
delivery and commissioning readiness, dealer evidence, handoff state,
applicable Playbooks, and authorized service history.

### Supplier Projection

A supplier projection should normally be branch-scoped. A component supplier
may receive the identity, installation, resources, warranty, history, and
current Job for its component without receiving unrelated Systems or owner
context.

### Service Projection

A service projection may include the authorized System, exact configuration,
current symptoms or Job, applicable procedures, prior service, evidence,
responsibility, and Actions the provider may perform or complete.

### Owner Projection

The owner projection should answer what the Asset contains, what Keepr knows,
what needs attention, where knowledge came from, who can help, what happened,
and what remains unknown. It should not require the owner to consume the raw
internal graph.

### Public and Transfer Projections

Public and transfer projections expose only the identity, facts, resources,
history, and relationships permitted for that purpose. A transfer projection
may preserve continuity without transferring private conversations or
participant-specific permissions.

### Intelligence Projection

ChatGPT, KAI, or another authorized intelligence client receives a
Job-specific subgraph. The intelligence provider is replaceable; the Passport
retains memory and continuity.

## Existing Keepr Primitive Map

| Passport concern | Existing Keepr primitive | Current architectural role |
| --- | --- | --- |
| Exact Asset identity | `assets`, KAC/KeeprLINK | Passport root and stable address |
| Model lineage | `asset_model_templates` | Reusable manufacturer/model knowledge |
| Reusable model structure | `asset_model_template_items` | Model Systems, components, specs, resources, intervals, knowledge, and Playbooks |
| Exact build binding | `asset_template_bindings` | Connects an Asset instance to applicable reusable model knowledge |
| Governed facts | `asset_facts` | Exact-asset facts with authority, provenance, confidence, and supersession |
| Installed topology | `systems` and system metadata | Current exact-asset operational structure |
| Resources | `asset_resources` | Typed resources with authority, rights, source, and applicability |
| Evidence | `attachments`, `attachment_placements` | Durable artifacts and their Asset/System/thread/message associations |
| Relationships | `asset_relationships`, `asset_provider_stewardships`, organizations, KeeprPros | Participant role, scope, status, and operational connection to a KAC |
| Spaces | Keepr owner workspace and KeeprSpace | Participant-facing projections and workflows |
| Projection semantics | `assetProjectionSemantics` | Owner, inventory, delivery, service, and workspace behavior by relationship |
| Operational history | `service_records`, `story_events`, timeline surfaces | Events and outcomes preserved against the Asset and Systems |
| Work | `playbooks`, `playbook_steps`, Actions/reminders | Requirements become executable ownership work |
| Communication | Asset/System threads, messages, message placements | Working context and participant coordination |
| Evidence interpretation | Proof Builder and Smart Data contract | Evidence becomes claims, rules, requirements, coverage, and operational consequences |
| Public projection | KeeprLINK/Public Story | Governed public-safe Asset representation |
| AI-readable projection | KeeprLINK `llm_context`, Context v2 design | Bounded machine-readable Passport projection |
| Context selection | Contextual Aperture contract | Job-specific relevance and traceability |
| External intelligence bridge | `get_context`, `contribute_context` | Read a governed projection and return reviewable continuity |
| Enablement/readiness | Asset enablement projection | Summarizes what is known, missing, active, and ready for the next ownership step |

## What Is Already Architecturally Aligned

Keepr already establishes several important Passport invariants:

1. The KAC, not an organization or AI provider, identifies the enduring Asset.
2. Model knowledge can be inherited without being confused with exact installed
   truth.
3. Exact facts can retain authority, provenance, confidence, and supersession.
4. Evidence may be placed against the Asset, System, conversation, event, or
   other context without duplicating the underlying artifact.
5. Relationships grant projections and participation rather than ownership of
   separate Asset records.
6. Playbooks organize requirements while Actions remain the operational work
   primitive.
7. RLS and relationship semantics remain the authority boundary.
8. AI context is a projection, not a second ownership model.
9. Contributions from external intelligence do not silently become canonical
   truth.

## Remaining Conceptual Gaps

### Canonical Passport Assembly

Keepr does not yet expose one versioned, production-backed contract that
assembles all eligible identity, topology, facts, resources, relationships,
history, work, evidence, and gaps for a KAC.

The proposed KeeprLINK Asset Context v2 contract is close to this boundary, but
it is currently documented as proposed rather than implemented.

### Unified Exact-Asset Graph

Template items, exact Systems, facts, resources, relationships, history, and
Actions exist in different structures. Keepr needs a consistent graph identity
and typed relationship model for traversing them as one Passport without
forcing all storage into one table.

### Model Knowledge Versus Instance Truth

The architecture can represent both, but every projection must consistently
distinguish:

- model expected;
- OEM published;
- OEM as-built;
- dealer reported;
- owner confirmed;
- evidence verified;
- service verified;
- inferred or proposed;
- disputed or superseded;
- unknown.

### Contribution and Promotion

OEMs, dealers, suppliers, owners, providers, and intelligence clients need one
governed contribution pattern. A contribution should identify its proposed
scope, source, provenance, authority, and intended effect. Promotion into
canonical Passport state remains a separate governed decision.

### Temporal Graph

The Passport must represent what was true at a point in time as well as what is
currently true. Replacements, upgrades, transfers, revoked relationships, and
superseded facts must preserve history rather than disappear.

### Projection Registry

Projection behavior exists in several screens, APIs, and policy contracts. The
domain needs a consistent vocabulary for actor, relationship, purpose, fields,
node/edge eligibility, operations, privacy, and traceability.

## Product Rationalization

The existing product can be explained as follows:

- The KAC locates the Passport.
- The Passport governs and remembers the Asset throughout its lifecycle.
- The Graph connects everything known or required.
- Spaces identify who is participating.
- Relationships and permissions determine authority.
- Jobs establish current purpose.
- Contextual Aperture establishes relevance.
- Intelligence reasons over the resulting projection.
- Playbooks and Actions organize and execute work.
- Evidence verifies outcomes.
- Timeline and Passport state preserve continuity.

OEM Space, Dealer Space, Supplier participation, Owner Keepr, KeeprLINK, KAI,
and ChatGPT are therefore not competing representations of the Asset. They are
authorized interfaces to one persistent Passport.

## Non-Goals At This Stage

This domain model does not authorize:

- a new Passport table or schema migration;
- replacement of existing Assets, Systems, Actions, relationships, or history;
- a universal graph database migration;
- a new AI truth store;
- broader participant access;
- automatic promotion of inferred claims;
- a new Passport UI;
- changes to MCP or external authentication.

The immediate purpose is conceptual alignment: make the architecture already
present in Keepr legible as one Asset-centered platform.

## Governing Principle

Every Keepr Enabled Asset has one Passport and one evolving governed graph.
Participants and Jobs receive the projection needed to fulfill their
responsibility without duplicating the Asset or exposing the entire record.

Keepr does not require intelligence to reconstruct reality for every
interaction. Keepr assembles and preserves reality so replaceable intelligence
can reason from the correct authorized context.
