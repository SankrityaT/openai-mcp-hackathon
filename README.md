# Cardea

**Your Canvas Beyond the Prompt**

Cardea is a WebMCP-native spatial workspace where a person and an agent can see, steer, and approve complex work together. A prompt becomes a living canvas of dependent work, visible evidence, browser surfaces, approvals, and human takeover.

## Why WebMCP

Chat is effective for expressing intent, but it hides the structure of long-running work. Cardea exposes its live canvas as narrow browser tools, so ChatGPT can operate the same workspace the user sees instead of guessing at buttons or manipulating an invisible backend.

The intended loop is:

`human -> ChatGPT browser -> Cardea WebMCP tools -> visible canvas update -> human judgment`

Cardea also includes a small separate-origin companion site that exposes reversible WebMCP tools, demonstrating the outbound loop without browser automation or payment.

## Verified WebMCP tools

Cardea registers eleven tools through `document.modelContext`:

| Tool | Visible effect |
|---|---|
| `create_mission` | Opens a draft mandate from a bounded goal |
| `inspect_canvas` | Returns a bounded read-only mission summary, including any pending approval's question, options, and consequence |
| `update_mandate` | Opens a proposed mandate change |
| `approve_mandate` | Approves the visible mandate so planning can begin; grants no spending or sending |
| `focus_node` | Focuses one visible work node |
| `redirect_node` | Opens the composer scoped to a selected node |
| `set_node_state` | Pauses, resumes, retries, or reverts a node |
| `resolve_approval` | Accepts, modifies, or rejects a visible approval, by id when several are pending |
| `open_takeover` | Opens the visible human takeover surface |
| `list_missions` | Lists the person's recent missions as workspace tabs |
| `open_mission` | Switches the visible workspace to another existing mission |

Local Chrome 151 verification confirms that all eleven tools are discoverable. Executing `create_mission` changes the same page from the empty canvas to mandate planning, and `inspect_canvas` returns bounded state without an OpenAI API call.

## Product status

- Landing page and `/app` are implemented. `/canvas` is a retired fixture-only prototype, unlinked from navigation.
- Eleven Cardea WebMCP tools are registered and locally browser-verified.
- The canvas has fixture-backed states for deterministic review and a server adapter boundary for live missions.
- Supabase schema, RLS, event sourcing, approvals, checkpoints, quotas, and policy contracts are implemented, but remote migrations require operator credentials before deployment.
- The optional AI SDK/Inngest harness, Composio adapter, and Supermemory adapter are present behind server boundaries. They are enhancements, not requirements for ChatGPT to use the WebMCP interface.
- The companion site is in `apps/companion` and requires a separate Netlify deployment to prove cross-origin WebMCP in production.

## Run locally

Requirements:

- Node.js 22.x
- pnpm 10.32.1
- Chrome 149 or newer with WebMCP testing enabled, or ChatGPT's in-app browser

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:3000/app](http://localhost:3000/app).

The public fixture canvas does not require provider credentials. Live persistence and optional integrations use the environment variables listed in `.env.example` or `ARCHITECTURE.md`; never commit their values.

## Access and sign-in

Cardea has four ways in, ranked at `/signin`. Every one of them returns to `/app`:

| Route in | What it grants | Account needed |
|---|---|---|
| Continue with Google | Full personal usage | Yes, via Google |
| Email sign-in link | Full personal usage | Yes, via email |
| Guest | One server-authorized mission | No |
| Hackathon judge code | Ten mission runs | No |

Guest access is automatic: a first visitor receives a server-issued guest
session with a one-mission allowance. Signing in with either method upgrades
them to personal authenticated usage. Judge access is a separate tenant from
both guest and personal usage, is redeemed only through `POST
/api/judge/redeem`, and never requires Google or email. The judge code is
compared in constant time against `CARDEA_JUDGE_CODE_HASH`; the plaintext code
is never stored, logged, or returned, and an invalid code receives a generic,
rate-limited failure.

Both sign-in methods return through `/auth/callback`, which exchanges the PKCE
code for a session cookie and redirects to a `next` path validated to be
same-origin.

### External configuration

These live in the Supabase and Google consoles, not in this repository. No
client secret is ever added to the browser bundle or committed.

1. **Google Cloud Console** — create an OAuth 2.0 Web application client. Set
   the authorized redirect URI to
   `https://<project-ref>.supabase.co/auth/v1/callback`.
2. **Supabase Dashboard → Authentication → Providers → Google** — enable the
   provider and paste the client ID and client secret from step 1.
3. **Supabase Dashboard → Authentication → URL Configuration** — set the Site
   URL, and add `http://localhost:3000/auth/callback` plus the deployed
   `https://<host>/auth/callback` to the redirect allow list.

Verify the provider is live by checking that `google` is `true` in
`https://<project-ref>.supabase.co/auth/v1/settings`. Until it is, the Google
button reports that the provider is not enabled and the email link remains
available.

## Test WebMCP in Chrome

1. Open `chrome://flags/#enable-webmcp-testing` in Chrome 149+.
2. Enable WebMCP testing and restart Chrome.
3. Open the deployed Cardea `/app` URL.
4. Use Chrome's WebMCP inspector or a compatible browser agent to list page tools.
5. Confirm the eleven names above.
6. Execute `inspect_canvas` with `{}`.
7. Execute `create_mission` with:

```json
{ "goal": "Prepare a launch without publishing anything" }
```

8. Confirm the visible page opens the mandate state.

## Test in ChatGPT

1. Open the deployed Cardea URL in ChatGPT's built-in browser.
2. Ask: `List the tools this page exposes.`
3. Ask: `Create a mission to prepare a launch, but do not publish or spend anything.`
4. Confirm ChatGPT invokes Cardea's site tool and the visible canvas changes.
5. Ask ChatGPT to inspect, focus, redirect, or pause one node and confirm the same canvas responds.

ChatGPT provides the agent for this workflow. An OpenAI API key is needed only when enabling Cardea's optional autonomous backend harness.

## Architecture

```mermaid
flowchart LR
  Human[Human] <-->|shared canvas| Cardea[Cardea Next.js UI]
  ChatGPT[ChatGPT browser] -->|11 WebMCP tools| Cardea
  Cardea -->|optional persistence| Supabase[(Supabase)]
  Cardea -->|trusted cross-origin WebMCP| Companion[Netlify companion]
  Cardea -. optional autonomous runtime .-> Harness[AI SDK + Inngest]
  Harness -. optional connectors .-> Composio[Composio]
  Harness -. optional memory .-> Supermemory[Supermemory]
```

The detailed contracts, security model, event schema, and deferred infrastructure are documented in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Safety model

- The model can recommend an action but cannot authorize it.
- Payments, purchases, signatures, account changes, sensitive messages, destructive deletion, and protected-data disclosure remain hard stops.
- External content is treated as untrusted evidence, not instructions.
- Stateful requests use bounded schemas, ownership checks, policy, quota, and idempotency gates.
- WebMCP outputs never include secrets, raw provider payloads, full transcripts, or hidden reasoning.
- The public fixture never claims a real website, booking, purchase, message, or connector action.

## Verification

```bash
pnpm test:core
pnpm test:harness
pnpm exec next typegen
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

The current suite covers policy hard stops, quota, idempotency, event replay, approval double settlement, model routing, context budgets, and capability registry behavior.

## Repository map

- `src/app/app`: Cardea product experience (workspace tabs, board, WebMCP registration)
- `src/app/canvas`: retired fixture-only prototype, unlinked from navigation
- `src/webmcp`: browser tool registration
- `src/core`: event, policy, repository, and Supabase contracts
- `src/harness`: optional AI SDK/Inngest, connector, and memory adapters
- `apps/companion`: separate-origin WebMCP companion site
- `supabase`: migrations and database tests
- `docs`: design, product, architecture, and implementation handoffs

## License

MIT, see [`LICENSE`](LICENSE).
