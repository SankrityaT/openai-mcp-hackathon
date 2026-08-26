# BE-06: Explicit visible Supermemory integration

Status: blocked by BE-02.

## Outcome

Implement user-scoped Supermemory retrieval and explicit propose/promote/edit/forget flows that power Cardea's visible sticky-note memory UI without silent capture.

## Scope

- Read current official Supermemory quickstart, auth, user profiles, AI SDK integration, search, update/version, list/filter, expiration, deletion, and pricing docs.
- Verify current package and runtime compatibility.
- Request approval for exact dependency additions.
- Implement a server-only Supermemory adapter behind the generic memory contract.
- Use one stable container scope per Cardea user.
- Add metadata for context-card, mission, source, consent, and visibility scope.
- Disable or avoid default automatic memory saving.
- Retrieve only relevant memory selected by the context compiler and confirmed context cards.
- Propose memory with source, influence, and proposed text.
- Promote only after explicit user action.
- Implement edit/version and forget/delete as durable idempotent operations.
- Synchronize safe memory references and consent state in Supabase.
- Prevent cross-user and cross-card retrieval.

## Exclusions

- No bulk ingestion of email, calendar, files, or personal accounts.
- No automatic background profile building.
- No replacement of Supabase mission state.
- No hidden memory influence without a visible reference.

## Acceptance

- User can propose, save, retrieve, edit, and forget one memory.
- Retrieved memory displays source and where it influenced a node.
- Unselected context-card memory is excluded.
- Cross-user retrieval fails.
- Forget removes future retrieval and updates Supabase reference state.
- Provider failure never blocks the whole mission; it degrades visibly.
- Token and result limits are enforced.
- Full app verification passes.

## Stop conditions

- Current SDK cannot guarantee user isolation and deletion behavior.
- Integration defaults to silent saving and cannot be disabled safely.
- BE-02 context compiler contract is not landed.

## Agent prompt header

```text
Implement ticket docs/tickets/BE-06-supermemory.md exactly. Memory must remain explicit, visible, user-controlled, scoped, and removable.
```

