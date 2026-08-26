# BE-05: Scoped Composio connector adapter

Status: blocked by BE-02.

## Outcome

Implement a generic Composio capability adapter with managed OAuth, mission-scoped sessions, exact-tool restrictions, pause/resume, and one verified Gmail/Calendar path using an isolated demo account.

## Scope

- Read current official Composio sessions, auth configs, connected accounts, tool restriction, OpenAI/AI SDK, triggers, and pricing docs.
- Verify current Node and package compatibility.
- Request approval for exact dependency additions.
- Implement server-only Composio client and generic adapter.
- Map stable Cardea user identity to Composio user/session identity.
- Create mission-scoped sessions restricted to exact required toolkits and tools.
- Use managed OAuth or hosted Connect Links.
- Persist only safe connection references and session IDs, never credentials.
- Pause a node when connection is missing.
- Resume through signed OAuth-completion event after ownership and state validation.
- Convert connector outputs into bounded untrusted evidence with provenance.
- Route every send/write through deterministic policy and approval.
- Add provider timeout, retry, circuit-breaker, quota, and redacted error handling.

## MVP tool scope

Keep a deliberately small set such as:

- read calendar availability;
- inspect one selected calendar window;
- search a dedicated demo mailbox for a user-authorized message;
- read a selected message or attachment metadata;
- prepare, but do not send, a draft.

Exact tools must be confirmed from the current Composio catalogue. Do not grant full Gmail or Calendar access by default.

## Exclusions

- No Slack, Notion, GitHub, or broad toolkit access in the MVP.
- No Shopify through Composio.
- No real message sending without explicit separate approval and demo need.
- No personal production account data in automated tests.

## Acceptance

- Missing connection produces a durable waiting node and visible OAuth request.
- OAuth callback resumes the exact mission/node once.
- Session contains only the approved tool set.
- Cross-user session use is rejected.
- Connector output is bounded, redacted, provenance-tagged, and marked untrusted.
- Draft creation cannot send.
- Rate-limit and provider failures become visible recoverable events.
- Dedicated test account path is verified end to end.
- Full app verification passes.

## Stop conditions

- Managed OAuth cannot support the selected demo safely.
- Required scope is broader than the visible user value.
- Provider pricing or limits threaten the demo.
- BE-02 capability adapter contract is not landed.

## Agent prompt header

```text
Implement ticket docs/tickets/BE-05-composio.md exactly. Use least privilege, an isolated demo account, and a tiny verified tool set. Do not broaden integrations for completeness.
```

