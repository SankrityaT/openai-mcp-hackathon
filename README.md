# cardea

**your canvas beyond the prompt** · [cardea-two.vercel.app](https://cardea-two.vercel.app)

you type a goal. cardea opens a canvas, plans it, runs the branches in parallel on the actual web, and stops at every move that spends, sends, or signs so you make that call yourself.

not a chatbot. not a wrapper. a workspace you can watch.

> **judging this?** live at [cardea-two.vercel.app](https://cardea-two.vercel.app).
> it needs a session: use the access code from our submission form for 10 runs,
> or continue as guest for 1. full instructions in
> [for judges: how to get in](#for-judges-how-to-get-in).

## the loop

```
you type it -> cardea plans it -> branches browse the real web in parallel
-> it stops and asks when only you can answer -> you approve -> it's done
```

and the whole thing is drivable by chatgpt, because the canvas exposes itself as webmcp tools.

## webmcp is the whole point

this is the part we're most hyped about. **webmcp** lets a page hand its own tools straight to the agent looking at it. no server, no connector, no scraping, no guessing which button is the button.

cardea registers **13 tools** on the browser's model context, so chatgpt drives the exact workspace you're looking at:

| tool | what you see happen |
|---|---|
| `create_mission` | a draft mandate opens |
| `inspect_canvas` | reads the mission, nodes, wallet, and any question waiting on you |
| `update_mandate` | proposes a change to the mandate |
| `approve_mandate` | approves the visible mandate so planning starts |
| `focus_node` | focuses one node |
| `redirect_node` | opens the composer scoped to a node |
| `set_node_state` | pause, resume, retry, revert |
| `resolve_approval` | accept, modify, or reject an approval, by id |
| `open_takeover` | opens the human takeover view |
| `toggle_wallet_pass` | selects which context wallet pass the next mission draws on |
| `open_pages` | opens live pages as tiles on your canvas |
| `list_missions` | lists your workspaces |
| `open_mission` | switches to another workspace |

every one of these is an action you could have taken yourself, in the interface you are looking at, and you watch each one land. that is the point: the agent works the same surface you do, not a hidden API behind it.

being straight about the boundary, since it is the interesting part. `approve_mandate` and `resolve_approval` are real tools, and the agent is told to get your explicit yes before calling either.

we tried to *enforce* that rather than just ask for it, and we backed it out, which is worth being honest about. the w3c draft passes an agent handle into `execute` carrying `requestUserInteraction()`, so we routed both tools through it with a `window.confirm`. in the chatgpt browser that primitive exists but the dialog is suppressed, and a suppressed `confirm()` returns false, which is indistinguishable from a real "no". every approval came back `declined_by_user` and nothing could ever be approved. a gate that cannot tell refusal from silence is worse than no gate, so it is gone.

so today this is an instruction to the agent, not a lock, and we would rather say that than imply a gate that isn't there. a page's tools run in your own signed-in browser, which is the same trust position as any extension you install. the honest version of enforcement here is to route that primitive to cardea's own visible approve button rather than a native dialog, which is real work and is parked, not shipped.

what *is* enforced everywhere is the shape of the authority. approving a mandate authorizes planning, and nothing else. every move that spends, sends, or signs stops at its own approval card with its own consequence spelled out, and a mandate carries `freePassage: false`, zero autonomous spend, and low-risk-only capabilities unless you change that yourself on the visible sheet.

we register on whichever entry point the browser exposes, `document.modelContext` (chrome's preview) or `navigator.modelContext` (the w3c draft), because the two shapes have diverged and binding to one would mean registering nothing at all in the other.

## the stack (all of it actually wired)

**[openai](https://openai.com/)**: gpt-5.6 does the planning and the writing, and chatgpt's built-in browser is what drives cardea through webmcp. the reason this project exists.

**[chrome / webmcp](https://developer.chrome.com/docs/ai/webmcp)**: the standard that lets a page expose real tools to an agent instead of getting scraped. genuinely think this changes how apps get built.

**[cloudflare](https://developers.cloudflare.com/browser-rendering/)**: browser rendering runs every live session. when cardea "browses," it's a real headless chrome on cloudflare, streamed onto your canvas. you can watch it and take over mid-run.

**[vercel](https://vercel.com/)**: hosts it, ships it in seconds, and the whole thing runs on fluid compute.

**[supabase](https://supabase.com/)**: auth, postgres, row-level security, and realtime. every mission event lands in an append-only log, so the canvas is just the log rendered.

**[inngest](https://www.inngest.com/)**: durable orchestration. missions run in dependency waves, survive restarts, and resume exactly where a paused approval left them.

**[composio](https://composio.dev/)**: gmail and calendar through real oauth, scoped to drafts and events only.

**[supermemory](https://supermemory.ai/)**: long-term memory. it remembers your taste across missions, but only what you actually told it to keep.

**[shopify](https://shopify.dev/)**: storefront mcp and cart permalinks, so a buying mission ends on a real cart you just have to confirm.

## shopify: their real agent protocol, live and load-bearing

this isn't a demo integration bolted on for the sponsor track. it's shopify's own published agent protocol ([shopify.dev/docs/agents](https://shopify.dev/docs/agents)), the actual thing they built for agents to transact with any shopify store, called server to server, not a mockup.

| capability | what it does |
|---|---|
| `catalog_search` | searches a real storefront's live catalog |
| `product_details` | reads one product, including variants |
| `cart_prepare` | creates a real cart from chosen variants |
| `cart_update` | adjusts quantities on that cart |
| `cart_read` | reads the cart back, including the checkout handoff url |

verified live, not assumed: search "bed frame" on thuma.co returns a real classic bed frame at $895.00, prepares a real cart, and hands back a real checkout url cardea never follows. the store isn't hardcoded either. the same adapter, same call, targeted a completely different real store (allbirds.com) and returned a real product from their catalog instead, proven in one process, both real stores answering.

no checkout, ever, enforced three separate ways: an allowlist of exactly five tool names, a denylist that refuses checkout/payment/order tools by name before any network call, and cardea's own agent profile only declaring cart and catalog capabilities to shopify's server, so checkout is excluded on shopify's side before cardea's code ever runs. also already migrated to their newer ucp surface ahead of the old one's august 31 shutdown, so this keeps working past the hackathon deadline without anyone touching it.

## the safety thing

cardea prepares freely and commits nothing.

- research, reading, comparing: runs on its own
- carts, drafts, calendar events: waits for you
- spending, sending, signing: never on its own, ever

every approval is a visible card on the canvas with the question, the options, and the consequence. agents can read them and relay them. resolving one is asked for in the tool contract rather than locked in code today (see the boundary note above), and what is genuinely enforced is that approving a mandate authorizes planning and nothing else.

## run it

```bash
pnpm install
cp .env.example .env.local   # fill in what you have
pnpm dev
```

opens on `/app`. works with zero credentials in fixture mode.

## for judges: how to get in

**live:** [cardea-two.vercel.app](https://cardea-two.vercel.app) → **Enter Cardea**.

Cardea needs a session, because a mission is a real persisted thing with a real
spending boundary attached. Three ways in, in the order we'd suggest:

| door | what you get | where |
|---|---|---|
| **access code** | 10 full mission runs | `/signin`, bottom section, paste the code from our submission form |
| guest | 1 mission run, no account | `/signin` → continue as guest |
| google / email | your own account, unlimited by quota | `/signin` |

Use the **access code** if you want to try more than one thing: guest is capped
at a single mission on purpose, so the second run will refuse rather than
silently do nothing. The code is in the submission form, not in this repo,
because it is hashed in our environment and never committed.

A mission takes roughly two to four minutes end to end, because it is genuinely
browsing real websites, not replaying a fixture. The mandate opens in seconds,
nodes appear about a minute after you approve, and the closing recommendation
lands after that.

## try the webmcp part

**chatgpt** (easiest): open the built-in browser in the chatgpt desktop app, turn on site tools in settings > browser > permissions, pick gpt-5.6 sol or terra, sign in, go to `/app`, then click site tools in the address bar. all 13 show up.

then **tell it to use cardea.** chatgpt has its own search and browser and will happily do the shopping itself if you just type a goal. say something like: *"use cardea for this, don't research it yourself. create a cardea mission on the canvas for: I want a solid wood queen bed frame around $900 to $1200, find a good one and get it ready for me to buy. read the mandate back to me and wait for my approval."* that budget matters: the configured store sells in that range, so the mission ends on a real cart. under $300 it correctly won't.

**chrome**: enable `chrome://flags/#enable-webmcp-testing`, restart, open `/app`, then in devtools run `await (document.modelContext ?? navigator.modelContext).getTools()`.

## for agents

- [`/llms.txt`](https://cardea-two.vercel.app/llms.txt): what cardea is for, when to use it, when not to
- `Accept: text/markdown` on any page: you get markdown, not html soup
- [`/sitemap.xml`](https://cardea-two.vercel.app/sitemap.xml): every public url

## stack details

next.js 16 · react 19 · typescript · tailwind 4 · pnpm

`src/app` the product · `src/core` contracts and pure logic · `src/harness` planner, adapters, orchestration · `src/webmcp` the tool surface

890 tests across the core, harness, and webmcp suites.

## license

mit, see [`LICENSE`](LICENSE).
