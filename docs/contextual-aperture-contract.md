# Keepr Contextual Aperture Contract

## Gate 2: Understand

The goal of Contextual Intelligence is not maximum context. It is minimum
sufficient relevant context.

KAI begins with the conversation's explicit scope and intent. It may expand
outward through authorized Keepr context only when additional context is
materially relevant to understanding or advancing the current Job.

Authorized does not mean relevant.

## Context Hierarchy

Every intelligence event must establish the contextual aperture before invoking
reasoning:

- Account: who is acting.
- Asset: which persistent thing is involved.
- System: which operational area is involved, when scoped.
- Thread: which situation or conversation is active.
- Message/Event: what just happened.
- Resource: what was supplied, if anything.
- Participants: who is engaged.
- Authority: what context KAI may access.

The conversation is neither isolated nor global. It establishes the primary
scope and intent. The ownership graph supplies reachable authorized context.
KAI determines what is relevant.

## Aperture Levels

- Portfolio Agent: wide aperture across the authorized portfolio.
- Asset Agent: asset aperture.
- System Agent: system aperture.
- Job/thread Agent: purpose aperture.

KAI may widen the aperture only when the current Job gives it a reason.

## Traceability

Context expansion should be reasoned and traceable. An intelligence run should
record the context it used and why, even if that trace is not always shown to
the owner.

Example trace:

- context_used: Pool restoration quote
- context_used: Pool open Action
- context_used: prior seasonal closing history
- context_used: Amazing Pool relationship
- reason: restoration timing may affect seasonal closing

This gives Keepr observability when KAI makes a poor recommendation: we can
see what context caused it.

## Narrowing

KAI must also recognize when a user changes intent or moves to a different
system. If the Pool Restoration thread drifts into Generator work, KAI should
not contaminate the Pool Job with Generator context. It should identify the
new intent and move or propose moving to the correct aperture.

Example:

> That's separate from the Pool Restoration situation. I'll handle it in the
> Generator context.

## Brighton Pool Fixture

Primary aperture:

- Brighton Home
- Pool
- Pool Restoration thread
- Andy shared a quote

First expansion:

- Pool Actions
- Pool history
- Pool providers
- Related Pool resources

Second expansion, only if relevance is discovered:

- Brighton seasonal context
- Normal pool closing or winterization

This expansion is justified only if restoration timing affects the seasonal
closing or winterization Job.

Irrelevant context for this fixture:

- Brighton refrigerator
- Brighton generator
- Porsche
- Kayot
- Tiara strategy

## Acceptance Test

Given:

- Brighton Home -> Pool -> Restoration conversation
- `Drake_Quote_.docx` supplied in that conversation

Prompt:

> What does this mean for me?

Pass:

KAI identifies the contractor proposal, scope/options/pricing, Pool
applicability, current restoration situation, relevant provider context,
seasonal/winterization dependency, important unknowns, and proposed next steps.

Fail: isolation

KAI only says this is a pool renovation quote with several options. It failed
to traverse outward and discover the existing ownership situation.

Fail: pollution

KAI talks about unrelated authorized context, such as Porsche annual service or
Kayot winterization. It widened without relevance.

## Gate Sequence

- Gate 1: Remember. Conversation durably retains what happened.
- Gate 2: Understand. KAI applies the correct contextual aperture and
  determines what matters.
- Gate 3: Propose. KAI translates understanding into reviewable ownership
  changes or next steps.
- Gate 4: Authorize. Owner or provider grants the authority required.
- Gate 5: Act. Keepr or a participant performs the Job.
- Gate 6: Verify. Evidence establishes what actually happened.
- Gate 7: Continue. Outcome enriches persistent context and changes what the
  Agent knows next time.

