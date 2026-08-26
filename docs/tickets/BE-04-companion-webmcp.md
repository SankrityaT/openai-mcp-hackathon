# BE-04: Companion site and outbound cross-origin WebMCP

Status: blocked by BE-03 contract.

## Outcome

Build and deploy a small independent Netlify companion site whose explicitly trusted WebMCP tools can be discovered and executed by Cardea inside a cross-origin iframe, completing the real two-way WebMCP loop.

## Why

The golden judge story must show more than WebMCP added to Cardea. It should show:

`browser agent -> Cardea WebMCP -> visible mission -> companion WebMCP -> structured result -> visible Cardea update`

## Scope

- Choose the smallest maintainable companion application structure after reviewing repository conventions.
- Request approval for any new dependencies or workspace changes.
- Host the companion on a distinct HTTPS Netlify origin.
- Provide generic fixture capabilities with sample catalog content:
  - search catalog;
  - inspect item;
  - compare items;
  - prepare/update simulated cart;
  - read policies.
- Register tools with exact Cardea production and approved preview origins in `exposedTo`.
- Embed the companion in Cardea using `<iframe allow="tools">`.
- Discover with `getTools({ fromOrigins: [...] })` and execute returned registered handles.
- Preserve tool origin, annotations, schema, risk, and trust in the capability registry.
- Return structured results into durable mission events.
- Configure CSP, `frame-ancestors`, `frame-src`, Permissions Policy, and origin isolation.
- Add a visible normal UI to the companion so human and agent share state.

## Domain boundary

The companion is a generic capability fixture. Sample products may support the relocation demo, but neither Cardea core nor the adapter can assume furniture, shopping, or catalog domains. Capability discovery supplies behavior dynamically.

## Exclusions

- No payment, real purchase, customer accounts, credentials, or personal data.
- No wildcard production origin exposure.
- No Cloudflare Browser Run or arbitrary external-site automation.
- No Shopify dependency.

## Acceptance

- Companion deploys on a separate verified Netlify origin.
- Cardea discovers only explicitly exposed companion tools.
- An unlisted origin cannot discover or execute them.
- Cardea executes at least one read tool and one reversible write tool.
- Companion UI and Cardea canvas both reflect the same tool result.
- Result becomes a committed mission event with provenance.
- Refresh/reconnect preserves or reconstructs the visible state.
- CSP and Permissions Policy tests pass in production.
- Compatible Chrome and ChatGPT paths are documented and verified.

## Stop conditions

- Cross-origin tool access cannot be proven with current official APIs.
- A proposed shortcut uses wildcard origin access.
- Netlify setup requires unexpected billing.
- Companion implementation threatens the Cardea critical path.

## Agent prompt header

```text
Implement ticket docs/tickets/BE-04-companion-webmcp.md exactly. Keep the companion small, generic, reversible, and visibly shared between human and agent. Prove the cross-origin security contract in production.
```

