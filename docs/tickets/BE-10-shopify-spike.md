# BE-10: Optional one-day Shopify search and cart spike

Status: optional, blocked until BE-07 is stable.

## Time box

One working day maximum, including setup, implementation, verification, and removal decision.

## Outcome

Determine whether Shopify adds one reliable real commerce capability without weakening the core two-way WebMCP demo.

## Scope

- Read current official Shopify WebMCP, Storefront MCP, Global Catalog, cart/checkout, auth, rate-limit, and caching rules.
- Select the smallest supported search and cart path.
- Request approval for exact dependencies, account setup, and credentials.
- Implement through the generic capability adapter.
- Support catalog search, item/variant comparison, and cart preparation only.
- Hand final checkout to the user.
- Keep provenance and Shopify restrictions visible.
- Use dedicated demo-safe data and no real purchase.

## Keep criteria

Keep the integration only if all are true:

- Real search is reliable.
- Variant comparison is structured and useful.
- Cart preparation works without trusted-agent checkout privileges.
- No overlap with Composio commerce tools.
- No meaningful golden-journey latency or instability.
- Demo can be repeated from a clean session.
- Official caching and imagery restrictions are respected.

## Cut criteria

Remove the integration and all public claims if any are true:

- Setup or auth exceeds the time box.
- Checkout trust or protected data is required.
- Search/cart behavior is intermittent.
- It distracts from companion WebMCP.
- It requires special judge credentials not supported by the submission.
- It threatens release hardening.

## Acceptance

- One isolated demo flow passes.
- No purchase occurs.
- Failure cleanly falls back to companion capabilities or user takeover.
- Removing the adapter does not change core contracts.
- Explicit keep/cut decision is recorded before the ticket closes.

## Agent prompt header

```text
Run ticket docs/tickets/BE-10-shopify-spike.md only after the core product is stable. Respect the one-day time box and remove the integration if every keep criterion is not met.
```

