# BE-01: Supabase runtime, authentication, and deployed data verification

Status: ready. BE-00 is merged at `c9e645e`.

## Outcome

Connect Cardea to the confirmed Supabase project through server-only adapters, apply reviewed migrations with explicit approval, implement SSR authentication boundaries, and prove RLS isolation with real database tests.

## Scope

- Confirm the exact Cardea Supabase project reference without exposing credentials.
- Re-read current official Supabase SSR, Auth, migration, type generation, RLS, Realtime, and testing docs.
- Implement browser and server Supabase clients using the approved current packages.
- Keep service-role access in server-only modules.
- Implement email magic-link auth callbacks and protected server routes required by later work.
- Implement the concrete `MissionRepository` through reviewed database RPCs.
- Add a runtime data-mode boundary so Product can remain on fixtures until live mode is enabled.
- Run migration dry run against the exact Cardea project.
- Request explicit approval, then apply migrations.
- Regenerate database types and reconcile any mismatch.
- Test two isolated users, public fixture reads, anonymous write denial, guest quota, judge quota, approval settlement, event append, checkpoint, and idempotency.
- Configure authorized Realtime subscription behavior for committed mission events.

## Owned areas

- Supabase runtime modules and auth route handlers.
- Supabase migrations and generated types when correction is required.
- Concrete mission repository implementation.
- Database integration tests and setup documentation.

## Exclusions

- No model calls, orchestration, WebMCP, connectors, memory, or visual UI.
- No custom OAuth provider beyond approved magic-link scope.
- No unrelated Supabase project access.

## Contracts

- Must implement the interfaces landed by BE-00.
- Must preserve append-only events and atomic materialization.
- Must never allow browser access to service-role credentials.
- Must emit redacted errors and correlation IDs.

## Acceptance

- Authenticated users can access only their tenant.
- Anonymous users can read only immutable public fixtures.
- All direct protected-table writes fail from untrusted roles.
- Mission create/read/event/approval/checkpoint/usage RPC paths pass against real Postgres.
- Realtime event sequence reconciles and recovers from a simulated gap.
- Deployment and local environment variable names documented without values.
- Full app verification passes.

## Stop conditions

- Exact project target cannot be verified.
- Migration dry run shows destructive or unrelated changes.
- Provider setup requires billing or a new auth scope.
- RLS tests cannot prove tenant isolation.

## Agent prompt header

```text
Implement ticket docs/tickets/BE-01-supabase-runtime.md exactly. Read all prerequisite documents and the landed BE-00 contracts. Do not begin if BE-00 is not on origin/main.
```
