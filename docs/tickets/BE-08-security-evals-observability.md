# BE-08: Security, evals, quotas, and observability release gate

Status: blocked by BE-07.

## Outcome

Prove that Cardea's assembled live backend resists the expected WebMCP and agent threats, selects tools reliably, enforces approval and quota boundaries, and emits redacted end-to-end traces.

## Scope

### Prompt injection and trust

- Build direct and indirect prompt-injection fixtures across companion tools, email, calendar, memory, tool descriptions, tool results, and normal page content.
- Verify untrusted evidence never changes system instructions, policy, tool grants, origin allowlists, or data-access scope.
- Verify extraction schemas, byte limits, token limits, redirect limits, and provenance.
- Test attempts to exfiltrate secrets, cross-user data, connector tokens, hidden prompts, and protected personal data.

### Web security

- Test SSRF controls for schemes, redirects, DNS changes, internal/private IP ranges, ports, and oversized responses.
- Test CSP, frame restrictions, Permissions Policy, origin isolation, cookies, callback state, and CORS.
- Test cross-origin WebMCP exposure from allowed and denied origins.
- Test tool lifecycle, abort, stale state, and forged tool result handling.

### Authorization and action safety

- Test Supabase RLS with multiple users, guests, judge tenant, and public fixtures.
- Test Free Passage against every permanent hard stop.
- Test approval replay, double-submit, expiry, mandate-version mismatch, and cross-node reuse.
- Test idempotency after timeout, uncertain response, retry, and process crash.
- Test quota races and cost ceilings under concurrent requests.

### Tool and journey evals

- Build selection evals for all eight Cardea tools.
- Include ambiguous, overlapping, adversarial, and irrelevant prompts.
- Test capability discovery and tool selection for the companion site.
- Evaluate complete golden journeys, including replanning and refusal.
- Record deterministic pass/fail criteria and bounded probabilistic metrics.

### Observability

- Implement or complete redacted OpenTelemetry spans across API, AI SDK, Inngest, model, context compiler, policy, tool, Supabase, Realtime, OAuth, memory, and companion execution.
- Record latency, retries, model, reasoning effort, cached input, tokens, estimated cost, tool, status, and escalation reason.
- Redact before export.
- Verify no secrets, OAuth tokens, full private documents, protected data, or hidden reasoning are recorded.

## Exclusions

- No feature expansion.
- No optional Shopify work.
- No cosmetic redesign beyond security/accessibility clarity.
- No live attack against unrelated systems or accounts.

## Acceptance

- All deterministic security tests pass.
- No cross-user or cross-tenant access succeeds.
- No permanent hard stop is bypassed.
- Duplicate consequential effects are prevented.
- Prompt-injection fixtures cannot expand authority or leak protected data.
- Tool-selection eval meets the documented threshold with no critical misroutes.
- Guest/judge/provider quotas hold under concurrency.
- Traces reconstruct the golden journey without sensitive content.
- Security limitations are documented honestly.
- Full app and browser verification passes.

## Stop conditions

- A critical exploit or approval bypass is found.
- Redaction cannot be proven before export.
- Test would act on a real external account without explicit scope.
- Fix requires changing locked architecture without user review.

## Agent prompt header

```text
Implement ticket docs/tickets/BE-08-security-evals-observability.md as a fresh-context adversarial release review. Do not add features. Treat every critical finding as a blocker.
```

