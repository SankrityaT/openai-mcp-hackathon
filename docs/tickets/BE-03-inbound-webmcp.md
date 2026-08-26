# BE-03: Cardea inbound WebMCP tool surface

Status: blocked by BE-02.

## Outcome

Expose the approved eight narrow Cardea tools through current `document.modelContext` so ChatGPT or another WebMCP-aware browser agent can create, inspect, focus, steer, approve, and open the same live canvas visible to the user.

## Tool set

1. `create_mission`
2. `inspect_canvas`
3. `update_mandate`
4. `focus_node`
5. `redirect_node`
6. `set_node_state`
7. `resolve_approval`
8. `open_takeover`

## Scope

- Re-read current WebMCP specification, Chrome imperative API, OpenAI guide, best practices, and security docs.
- Use feature detection and graceful normal-UI fallback.
- Register tools only while the relevant application state is mounted and authenticated.
- Build narrow non-overlapping schemas with explicit bounds.
- Route every action through BE-02 mission services and deterministic policy.
- Add correct read-only and untrusted-content annotations.
- Support abort and unregister lifecycle.
- Return bounded deterministic results with IDs, state versions, and visible effects.
- Synchronize focus and takeover tools with the actual canvas.
- Add browser discovery, execution, cancellation, lifecycle, auth, ownership, and schema tests.
- Add tool-selection evals for ambiguous user requests.

## Exclusions

- No cross-origin companion implementation.
- No backend database imports in browser registration code.
- No fake success when a route is fixture-only.
- No raw transcripts, secrets, provider payloads, or hidden reasoning in outputs.

## Acceptance

- All eight tools are discoverable in compatible Chrome and ChatGPT built-in browser.
- `inspect_canvas` is read-only and bounded.
- Stateful tools reject unauthorized, stale, cross-user, invalid, or policy-denied requests.
- `resolve_approval` cannot bypass hard stops or settle twice.
- `open_takeover` opens truthful UI and never claims a live browser when none exists.
- Tool cancellation produces a consistent visible state.
- Existing manual UI remains fully functional without WebMCP.
- Full app verification passes.

## Stop conditions

- Current browser API differs from `ARCHITECTURE.md` assumptions.
- BE-02 service path is not landed.
- Tool descriptions overlap enough to make selection ambiguous.
- Compatible browser verification is unavailable.

## Agent prompt header

```text
Implement ticket docs/tickets/BE-03-inbound-webmcp.md exactly. WebMCP is the hackathon centerpiece. Use current official APIs, route through landed services, and prove discovery plus visible execution in a compatible browser.
```

