# BE-09: Deployment, judge path, and submission hardening

Status: blocked by BE-08.

## Outcome

Deliver a reliable public Cardea deployment, companion Netlify deployment, reproducible public repository, compatible-browser WebMCP verification, and complete submission evidence.

## Scope

### Deployment

- Verify Vercel tracks `main` and uses Node `22.x`.
- Verify all required environment variables are present in correct scopes without exposing values.
- Verify Supabase, Inngest, Composio, Supermemory, and OpenAI connectivity.
- Verify Netlify companion production origin and Cardea allowlist.
- Verify production security headers and callbacks.
- Verify provider free tiers, quotas, and circuit breakers.

### Public and judge access

- Public relocation fixture is accessible without authentication.
- Personal missions require auth.
- Signed guest receives one mission.
- Judge code receives up to ten runs.
- Judge code is hashed and validated server-side.
- Quota exhaustion has a clear non-destructive UI.
- Use dedicated demo accounts with no personal data.

### WebMCP

- Verify Cardea's eight tools in ChatGPT built-in browser.
- Verify them in supported Chrome with WebMCP enabled.
- Verify companion cross-origin discovery and execution.
- Verify normal UI fallback without WebMCP.
- Capture implementation evidence without exposing secrets or internal IDs.

### Repository and submission

- Add an approved open-source license visible at repository root.
- Write clean-clone setup and architecture documentation.
- Include a Mermaid architecture diagram and registered-tool map.
- Include exact WebMCP implementation locations and current `document.modelContext` example.
- Document environment variable names only.
- Verify no secrets, private fixtures, unrelated data, or generated build output are committed.
- Prepare submission description answering WebMCP fit, UX improvement, new human-agent capability, and implementation.
- Record a public video under three minutes with audio.
- Rehearse the exact judge path from a clean session.

## Exclusions

- No new architecture, providers, or optional integrations.
- No late visual direction changes outside approved final polish.
- No billing upgrades without user approval.

## Acceptance

- Live Cardea and companion URLs work from clean supported sessions.
- Golden journey passes repeatedly without developer-only state.
- WebMCP discovery and execution are visible and reliable.
- Auth, OAuth, approval, failure, reconnect, quota, and completion states work.
- Clean clone installs, builds, and runs from documentation.
- License, README, architecture, and tool evidence are complete.
- Three-minute video and submission links are public and verified.
- Final smoke test passes immediately before submission.

## Stop conditions

- Live URL or WebMCP tools are intermittent.
- A critical security or quota test is unresolved.
- Submission claims exceed verified behavior.
- Deadline risk requires cutting optional scope.

## Agent prompt header

```text
Implement ticket docs/tickets/BE-09-deployment-submission.md as the final release workspace. Freeze scope, verify from clean judge sessions, and reject any claim not backed by the live product.
```

