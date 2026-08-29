# cardea

**your canvas beyond the prompt** · [cardea-two.vercel.app](https://cardea-two.vercel.app)

you type a goal. cardea opens a canvas, plans it, runs the branches in parallel on the actual web, and stops at every move that spends, sends, or signs so you make that call yourself.

not a chatbot. not a wrapper. a workspace you can watch.

## the loop

```
you type it -> cardea plans it -> branches browse the real web in parallel
-> it stops and asks when only you can answer -> you approve -> it's done
```

and the whole thing is drivable by chatgpt, because the canvas exposes itself as webmcp tools.

## webmcp is the whole point

this is the part we're most hyped about. **webmcp** lets a page hand its own tools straight to the agent looking at it. no server, no connector, no scraping, no guessing which button is the button.

cardea registers **12 tools** on `document.modelContext`, so chatgpt drives the exact workspace you're looking at:

| tool | what you see happen |
|---|---|
| `create_mission` | a draft mandate opens |
| `inspect_canvas` | reads the mission, nodes, and any question waiting on you |
| `update_mandate` | proposes a change to the mandate |
| `approve_mandate` | approves the visible mandate so planning starts |
| `focus_node` | focuses one node |
| `redirect_node` | opens the composer scoped to a node |
| `set_node_state` | pause, resume, retry, revert |
| `resolve_approval` | accept, modify, or reject an approval, by id |
| `open_takeover` | opens the human takeover view |
| `open_pages` | opens live pages as tiles on your canvas |
| `list_missions` | lists your workspaces |
| `open_mission` | switches to another workspace |

the agent can do everything except the one thing that matters. it can't approve for you. that's the whole product.

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

## the safety thing

cardea prepares freely and commits nothing.

- research, reading, comparing: runs on its own
- carts, drafts, calendar events: waits for you
- spending, sending, signing: never on its own, ever

every approval is a visible card on the canvas with the question, the options, and the consequence. agents can read them and relay them. agents cannot resolve them without you saying yes.

## run it

```bash
pnpm install
cp .env.example .env.local   # fill in what you have
pnpm dev
```

opens on `/app`. works with zero credentials in fixture mode.

## try the webmcp part

**chatgpt** (easiest): open the built-in browser in the chatgpt desktop app, turn on site tools in settings > browser > permissions, pick gpt-5.6 sol or terra, go to `/app`, then click site tools in the address bar. all 12 show up. ask it to start a mission.

**chrome**: enable `chrome://flags/#enable-webmcp-testing`, restart, open `/app`, then in devtools run `await document.modelContext.getTools()`.

## for agents

- [`/llms.txt`](https://cardea-two.vercel.app/llms.txt): what cardea is for, when to use it, when not to
- `Accept: text/markdown` on any page: you get markdown, not html soup
- [`/sitemap.xml`](https://cardea-two.vercel.app/sitemap.xml): every public url

## stack details

next.js 16 · react 19 · typescript · tailwind 4 · pnpm

`src/app` the product · `src/core` contracts and pure logic · `src/harness` planner, adapters, orchestration · `src/webmcp` the tool surface

818 tests across the core, harness, and webmcp suites.

## license

mit, see [`LICENSE`](LICENSE).
