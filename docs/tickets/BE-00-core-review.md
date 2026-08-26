# BE-00: Finish, review, and land Core Data and Policy

Status: in progress.

## Outcome

Produce one clean, current-main, independently reviewed Core Data and Policy branch containing generic contracts, Supabase migrations, RLS, append-only mission events, materialization, approvals, checkpoints, quotas, idempotency, repositories, and deterministic policy.

## Why

Every later backend agent depends on these contracts. Landing provisional contracts without review would multiply schema, security, and merge failures across all other workspaces.

## Existing work

- Foundation commit: `a6813ce`.
- Workspace branch: `SankrityaT/configure-api-credentials`.
- Later uncommitted work may include approved Supabase SDK packages and a server adapter.
- Current `origin/main` includes newer Node 22 and landing-to-canvas changes that must be preserved.

## Scope

- Finish the server-only Supabase SSR/data adapter if its dependencies were approved.
- Sync latest `origin/main` and preserve both Node `22.x` and `test:core`.
- Review all TypeScript contracts, policies, reducers, repositories, migrations, RPCs, grants, RLS, and pgTAP tests.
- Verify no domain-specific enums or fixture assumptions entered the core.
- Keep remote migrations unapplied until exact project and explicit approval are confirmed.

## Exclusions

- No AI SDK, OpenAI, Inngest, WebMCP, Composio, Supermemory, Shopify, or UI implementation.
- No remote database mutation without approval.
- No redesign.

## Acceptance

- Branch clean and synchronized with current main.
- Core tests pass.
- Typegen, TypeScript, lint, build, and diff checks pass.
- SQL migrations have deterministic ordering and reviewed privileges.
- RLS denies cross-tenant access and anonymous writes.
- Approval cannot settle twice.
- Event replay rejects gaps and duplicates.
- Idempotency prevents duplicate side effects.
- Guest defaults to one mission; judge access supports ten runs.
- Full review findings resolved.

## Stop conditions

- Unknown or unrelated Supabase target.
- Required dependency lacks approval.
- Remote migration requested without dry run and user approval.
- Core contract change contradicts `ARCHITECTURE.md`.

## Handoff

Follow the queue landing gate in `README.md`, then recommend whether BE-01 can begin.

