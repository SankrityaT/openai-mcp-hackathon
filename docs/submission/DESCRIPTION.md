# Cardea — submission description

> Paste-ready. Roughly 650 words. Trim from the bottom if the form is tighter.

## What it is

Cardea turns a goal you type into a living mission canvas: it plans the work,
runs the branches in parallel on the real web in browsers you can watch, and
stops at every move that spends, sends, or signs so you make that call.

The whole workspace is exposed to the agent looking at it. ChatGPT drives the
same canvas you are looking at, through 13 WebMCP tools, and you watch every
call land.

## Why this use case fits WebMCP

Most agent demos are read-only: fetch something, summarize it. The interesting
problems are the ones where an agent has to *do* work across several sites and
then stop and ask a human, because the next step costs money or sends something
irreversible.

That shape needs three things at once: the agent has to see live application
state, act on it through real controls, and hand a decision back. Scraping gives
you none of that. A server-side MCP gives you the third but not the first two,
because it has no idea what is on your screen. WebMCP is the only one of the
three where the page itself hands over its own tools, so the agent's view and
the human's view are the same object.

Cardea is built specifically on that: `inspect_canvas` reports the mission the
person is looking at, and re-reads it from the server before answering so it can
never describe a stale canvas as current.

## What it lets people and agents do together that was hard before

Concretely, from a real run we recorded: you type "find me a queen bed frame
under $300 with real prices from two different stores." Cardea plans three
branches, opens IKEA and Zinus in real browsers on your canvas, reads actual
product pages, and comes back with IKEA SLATTUM at $149 as the top pick and
Zinus from $289 as the runner-up. Both under the stated budget, both with prices
it actually saw.

Before: you either do that yourself across six tabs, or you ask an agent and get
plausible prices from training data that may be a year stale.

The part we care about most is what happens when it *cannot* verify something.
In an earlier run, Walmart and Wayfair both served "Press & Hold to confirm you
are a human." Cardea refused to invent a recommendation, and now says which
sites blocked it rather than implying it found nothing. An agent that reports
"two stores refused to let me look" is more useful than one that confidently
makes up a price.

The other thing that gets easier: the human stays in the loop without babysitting.
You can walk away. Spending, sending, and signing each stop at their own approval
card with the consequence spelled out, and the agent can read those cards and
relay them to you but the decision stays yours.

## How we implemented WebMCP

13 tools registered on the browser's model context, covering the real product
surface rather than wrapping an API: `create_mission`, `inspect_canvas`,
`update_mandate`, `approve_mandate`, `focus_node`, `redirect_node`,
`set_node_state`, `resolve_approval`, `open_takeover`, `toggle_wallet_pass`,
`open_pages`, `list_missions`, `open_mission`.

Details that took real work:

- **Both API shapes.** Chrome's preview exposes `document.modelContext`; the W3C
  draft exposes `navigator.modelContext` and passes an agent handle into
  `execute`. We bind to whichever is present, because binding to one means
  registering zero tools in the other.
- **The approval gate is enforced where it can be.** Where the browser provides
  `requestUserInteraction()`, `approve_mandate` and `resolve_approval` pause on
  it and a decline returns `declined_by_user` with nothing committed. Chrome does
  not expose it yet, so there it is an instruction, and we say so rather than
  implying a gate that is not there.
- **Registration survives remounts.** A refused registration retries once the
  previous mount's abort settles. Measured against a client whose unregistration
  lags: without it, zero of thirteen tools survived.
- **Every failure is a structured envelope**, naming the offending field, because
  nothing documents how a thrown `execute()` reaches the model.
- **Verified independently.** We drove the deployed site with `agent-browser`, a
  third-party WebMCP client in real Chrome: all 13 tools discovered, parameterized
  invocation working, full create → update → approve journey persisted.

Also wired and load-bearing, not decorative: Shopify's published agent protocol
for real carts, Cloudflare Browser Rendering for the live browser tiles, Supabase
for an append-only mission log, Inngest for durable orchestration.
