# BE-02: Durable mission harness and model router

Status: blocked by BE-01.

## Outcome

Implement Cardea's generic durable mission orchestrator with Vercel AI SDK 6, Inngest, Terra/Sol routing, structured context compilation, bounded specialist workers, capability discovery, and committed mission events.

## Scope

- Verify current official AI SDK, OpenAI, and Inngest versions and security advisories.
- Request approval for exact dependency additions before installation.
- Implement a provider-neutral model gateway through AI SDK.
- Default to `gpt-5.6-terra`; escalate to `gpt-5.6-sol` only through a deterministic router.
- Implement the structured context compiler defined in `ARCHITECTURE.md`.
- Add prompt-cache version hashes and per-call token/cost estimates.
- Implement a generic capability registry and adapter interface.
- Implement one internal read-only fixture capability for the walking skeleton.
- Implement one lightweight mission orchestrator and bounded node workers.
- Use Inngest durable steps, `step.invoke` for independent workers, and `step.waitForEvent` for approval.
- Cap active durable steps at five.
- Commit every durable state transition through BE-01 repositories.
- Produce concise user-visible action summaries and evidence references, never raw hidden reasoning.
- Expose typed foreground AI SDK streaming and committed background event flow.

## Owned areas

- Mission runtime, model gateway, router, context compiler, capability registry, Inngest functions, and runtime tests.
- No UI ownership beyond typed stream contracts or minimal test endpoints.

## Exclusions

- No WebMCP registration.
- No Composio, Supermemory, Shopify, or browser automation.
- No domain-specific planner branches.
- No direct database writes outside landed repositories.

## Harness budgets

- Maximum model calls per mission and node.
- Maximum input/output tokens and estimated cost.
- Maximum tool calls and retries.
- Maximum mission duration and concurrent workers.
- Maximum untrusted evidence bytes.
- Hard stop with visible event when a budget exhausts.

## Acceptance

- A generic prompt produces a validated mandate and capability-driven node graph.
- Independent nodes execute durably in parallel without exceeding five steps.
- A failed step resumes without repaying completed model/tool work.
- A human approval suspends and resumes without an open process.
- Terra is used by default and Sol escalation is observable and justified.
- Context compiler excludes irrelevant transcript and stays within configured budgets.
- Duplicate events and side effects are prevented.
- Foreground and background streams reconcile against committed state.
- Full app verification passes.

## Stop conditions

- BE-01 repositories or schemas are not landed.
- Dependency approval missing.
- A design would require two top-level orchestrators.
- Model output is being treated as authorization.

## Agent prompt header

```text
Implement ticket docs/tickets/BE-02-mission-harness.md exactly. Read ARCHITECTURE.md and landed Core/Supabase handoffs. Keep the harness domain-agnostic and prove the walking skeleton before adding providers.
```

