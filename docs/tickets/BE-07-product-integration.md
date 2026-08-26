# BE-07: Integrate live runtime into the Product canvas

Status: blocked by BE-03, BE-04, BE-05, and BE-06.

## Outcome

Replace fixture-only behavior incrementally with authenticated server-backed missions, durable event streaming, real WebMCP state, scoped connectors, and visible memory while preserving the existing interaction contract for later visual polish.

## Scope

- Re-read `DESIGN.md`, `docs/PRODUCT_FLOW.md`, `docs/CANVAS_IMPLEMENTATION_HANDOFF.md`, and all landed backend handoffs.
- Preserve a clear fixture/live adapter switch for public fallback and deterministic review.
- Connect sign-in and authenticated mission loading.
- Connect centered prompt and mandate submission to BE-02 services.
- Render committed mission/node/edge/approval state from BE-01 materializations.
- Use AI SDK streaming for foreground response.
- Use Supabase Realtime for committed background events.
- Reconcile by event ID and sequence; refetch on gap.
- Connect focus, redirect, pause, resume, retry, revert, approval, and takeover controls through BE-03 actions.
- Render external companion execution through BE-04.
- Render OAuth waiting/resume through BE-05.
- Render memory propose/promote/edit/forget through BE-06.
- Preserve truthful fixture labeling whenever live capability is unavailable.
- Add loading, offline, stale version, reconnect, policy denial, quota, and provider failure states.

## Visual boundary

This ticket integrates behavior but is not the final visual redesign. It may make accessibility or state-clarity corrections required for real behavior, but Claude or another approved visual owner will perform final polish after integration.

## Exclusions

- No new art direction.
- No generated fake browser state.
- No direct provider calls from React components.
- No duplicate client-side authority or quota logic.
- No hidden model selection.

## Acceptance

- Authenticated user creates a generic mission and receives durable nodes/events.
- Refresh restores committed state without replaying side effects.
- Foreground stream and background events reconcile.
- User steers one node through WebMCP and manual UI.
- Companion tool result updates both companion and canvas.
- Missing connector pauses and resumes safely.
- Memory proposal is visible and user-controlled.
- Approval resolves once and resumes the correct node.
- Quota and policy denial remain visible and actionable.
- Public fixture demo still works when providers are disabled.
- Desktop and mobile functional states pass runtime checks.

## Stop conditions

- Any required upstream adapter is not landed or verified.
- UI would need to duplicate backend policy.
- Real capability cannot be distinguished from fixture state.
- Integration requires redesigning shared visuals before behavior works.

## Agent prompt header

```text
Implement ticket docs/tickets/BE-07-product-integration.md exactly. Integrate only landed contracts, preserve fixture fallback, and keep every live/fixture boundary truthful and visible.
```

