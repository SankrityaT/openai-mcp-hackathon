# Cardea authoritative decision log

This file records the decisions made through the full Cardea product-definition conversation. It exists so future agents do not repeat the questions, reinterpret answers, or treat the current implementation as the intended product.

Precedence:

1. New direct user instruction.
2. This decision log.
3. `DESIGN.md`, `docs/PRODUCT_FLOW.md`, `ARCHITECTURE.md`, and task briefs.
4. Current implementation, which may be provisional or rejected visually.

## Product and positioning

| Question or decision | Locked answer |
|---|---|
| What are we building? | A user-owned, WebMCP-native spatial workspace where people watch, steer, and approve agents executing complex missions across the web. |
| What is the core wedge? | The visible living mission canvas and human-agent collaboration, not chat, memory, integrations, or browser automation by themselves. |
| Is Cardea an AI browser? | No. Browser surfaces are nodes inside a mission operating environment. |
| Does the agent represent a business or the user? | The user. This is the inversion from enterprise concierge products such as Decagon. |
| Is chat removed? | No. Chat captures intent and remains as a persistent composer. The canvas explains and steers the work. |
| Product name | Cardea. |
| Descriptor | Your Canvas Beyond the Prompt. |
| Hero headline | Turn Any Goal Into A Living Workspace. |
| Hero subhead | Cardea plans, browses, researches, and acts across the web while you watch, steer, and approve the work in real time. |
| Mascot/guide | Cardea herself. No secondary mascot, companion, or cast of agent personas. |
| Why Cardea? | Roman goddess of hinges and thresholds plus a near-Earth quasi-moon, expressing transition, guardianship, orbit, and passage between user intent and the web. |

## Competitive decisions

| Reference | Cardea distinction |
|---|---|
| Decagon | Business-owned customer agent versus user-owned agent across the web; chat/voice/email versus spatial work. |
| Poke | Messaging-first user tasks versus visible mission workspace. |
| Comet/Dia | Browser plus chat versus inspectable multi-branch mission canvas. |
| Grok computer agent | General computer use versus structured WebMCP actions, dependencies, mandate, evidence, and approval boundaries. |
| ChatGPT browser/Sites | Runtime and distribution surface, not the Cardea product wedge. |
| WebMCP | Enabling protocol, not differentiation by itself. |
| Composio, Supermemory, Vercel AI SDK | Supporting infrastructure, never headline differentiation. |

## Hackathon and submission

| Question or decision | Locked answer |
|---|---|
| Is Cardea in scope? | Yes. It is an actual web product where humans and agents interact in the same live interface through WebMCP. |
| Deadline used | September 3, 2026 at 1:00 PM PT. |
| Required deliverables | Working hosted app, description, public repository, visible open-source license, and sub-three-minute public demo video with audio. |
| Compatible testing | ChatGPT in-app browser or Chrome 149+ with WebMCP testing enabled. |
| Is an OpenAI API key required for WebMCP? | No. ChatGPT supplies the agent in its browser. An OpenAI API key is only required for Cardea's optional autonomous backend. |
| Is an interface required? | Yes. The human-agent shared web interface is the product and challenge submission. |
| Primary priority | Polished canvas plus verified WebMCP tools first. Persistence second. Autonomous backend, connectors, and memory only when they improve the verified experience. |
| Public repository | Required, with a visible open-source license. MIT was selected and added. |
| Technical proof location | README and repository architecture/tool map, not a decorative architecture panel on the landing page. |

## Flagship demonstration

| Question or decision | Locked answer |
|---|---|
| Flagship mission | Relocate from Phoenix to San Francisco for a new job in 10 days. |
| Why this mission? | It creates real dependencies among housing, travel, moving, home, utilities, admin, calendar, budget, and approvals. It is not a simple trip planner. |
| Budget behavior | The budget is a planning constraint, not money Cardea spends. Purchases, bookings, signing, and sends stop for approval. |
| Killer demo event | The leading apartment becomes unavailable, and housing, travel, delivery, utilities, and budget visibly reroute together. |
| Human moment | Cardea coordinates the work; the human chooses among consequential options. |
| Product generality | Relocation is fixture/demo data only. Cardea's runtime is domain-agnostic and capability-driven. |

## Brand identity

| Question or decision | Locked answer |
|---|---|
| Logo concept | Cardea profile plus open threshold plus orbital braid plus coral hinge inside a circular blue mark. |
| Logo usage | Rich version for illustration/motion; simplified precise SVG for production and favicon. |
| Cardea figure | Textured classical editorial figure with subtle living motion and animated orbital braid. |
| Cardea canvas presence | Small ambient orbital presence that expands only for meaningful moments. |
| Core palette | Warm Bone `#F4F0E8`, Orbital Black `#11110F`, Cardea Blue `#445CFF`, Hinge Coral `#FF6B4A`. |
| Domain colors | Only inside wallet-card artwork and tiny identifiers. The product interface remains Cardea blue/coral/bone/black. |
| Light and dark | One system with two materials: warm-bone micro-grid light mode and constellation-black dark mode. |
| Theme default | Follow system, provide quick toggle with Cardea portal transition. |

## Typography

| Role | Locked typeface |
|---|---|
| Editorial display | Newsreader. |
| Product UI and body | Geist. |
| Agent activity and telemetry | Geist Pixel, used sparingly. |
| Model picker | Hidden in MVP so Cardea feels like one coherent intelligence. |
| Product typography principle | Serif is reserved for rare major moments, not every card or control. Product text must remain legible and non-miniature. |

## Landing page

| Question or decision | Locked answer |
|---|---|
| Primary composition | Classical editorial landing with real Cardea product occupying roughly 60% of the hero and revealing more through scroll. |
| Reference role | Aegis/Civor references provide restrained type/image relationship, grain, and classical scale, not exact layout or green tint. |
| Navbar left | Cardea mark plus Cardea. |
| Navbar center | Canvas, Use cases, How it works. |
| Navbar right | Watch demo, Start a Canvas. |
| Footer | About belongs here rather than crowding the hackathon nav. |
| Primary hero action | Enter Cardea. |
| Secondary hero action | Start a Mission. |
| Narrative | Product-first hero, mission expansion, human control, memory/context, live web work, partner credibility, use cases, final CTA. |
| Company logos | Show the locked working-stack set: OpenAI, Chrome, Vercel, Supabase, Inngest, Composio, and Supermemory, with roles. Label Cloudflare and Shopify as extensions until live. Never imply a commercial partnership. |
| Architecture proof | Public repo and submission materials, not landing decoration. |
| Generated assets | Cohesive classical-celestial image family for hero, mechanism, memory, authority, and closing. Never generate fake product screenshots. |
| Rejected landing pattern | Giant centered serif headline, eyebrow, two equal CTAs, floating dashboard, repetitive huge section headings, and excessive empty space. |

## Canvas foundation

| Question or decision | Locked answer |
|---|---|
| App entry | Open directly onto the canvas, not a dashboard or constellation home. |
| Product surface | `/app`. Every entry point and callback returns there; the `/canvas` prototype is retired and unlinked. |
| Copy rule | No em dashes in user-facing strings. Geist Pixel is telemetry only, never headings, labels, or buttons. No decorative microcopy, and no guarantee stated as a badge. |
| Empty state | Calm centered prompt composer, Cardea ambient presence, no developer fixture selector. |
| Information density | Adaptive: spacious at mission level, denser only when zooming into branches and nodes. |
| Active viewport | Two or three substantial work/browser windows, with other nodes beyond the viewport and in the minimap. |
| Layout | Cardea auto-arranges; user can drag, pin, group, and collapse. |
| Navigation | Subtle minimap plus Mission -> Branch -> Node breadcrumbs when drilled in. |
| Toolbar | Minimal left toolbar; contextual controls only after selection. |
| Canvas surface | Warm-bone micro-grid light mode; constellation-black grid dark mode. |
| Root mission | Understated spatial anchor, not another competing card. |
| Connectors | Calm curved lines at rest, traveling energy while active, visible reroute on dependency change. |
| Connector selection | Option 3 selected: stateful calm/pulse/reroute behavior, not simple lines or braided decoration. |

## Browser/work nodes

| Question or decision | Locked answer |
|---|---|
| Default node | Large inspectable 16:9 preview with domain/source, codename plus role, state, and one concise Cardea sentence. |
| Node names | Dynamically assigned from a curated Greek/celestial pool with a clear role label, for example `Lyra · Housing`. |
| Preview fidelity | Each site has distinct credible anatomy; do not repeat a generic thumbnail. |
| Expand behavior | Expand in place first, optional full screen second. |
| Takeover | Dimmed canvas with resizable 70/30 default split, browser/work left and Cardea activity right. |
| Takeover controls | Pause, Resume, Redirect, Retry, Revert, Take Over/Return. |
| Human control state | Explicit `You are controlling`; Cardea input pauses. |
| Commentary | One live sentence beneath/with the node; full activity in expandable rail. |
| Reasoning | Show concise reasoning summary, plan, actions, tools, sources, and evidence, never raw private chain-of-thought. |

## Activity and approvals

| Question or decision | Locked answer |
|---|---|
| Activity structure | One chronological stream with filter chips for Plan, Actions, Evidence, Decisions, Errors, Approvals. |
| Loader | Cardea-specific circular/orbital activity loader, not generic spinner. |
| Needs You location | Floating orbital capsule at top-center. |
| Approval placement | Mirrored at affected node and central Needs You queue, without overlapping duplicates. |
| Approval anatomy | Recommendation, evidence, alternatives, consequence, Accept and Modify. |
| State colors | Blue shimmer active, red error, blue/coral Needs You, green complete, neutral paused, always with icon/text. |
| Error behavior | Safe bounded retry/fallback first, then visible red node with explanation and Retry, Redirect, Take Over. |
| Revisions | Per-node history plus mission-wide checkpoints before consequential changes. |

## Focus and scoped prompting

| Question or decision | Locked answer |
|---|---|
| Select tool | Dedicated Focus tool. |
| Node click in Focus | Automatically inserts `@NodeName` into composer. |
| Scoped actions | Pause, redirect, retry, revert, compare, summarize, take over. |
| Composer persistence | Remains at bottom-center throughout mission. |
| Minimized state | Soft compact pill. |
| Expanded state | Multiline composer with files, sources, commands, voice, wallet, and node chips. |
| Drag/drop | Composer becomes a visible drop surface. |
| Voice | Listening and transcript states. |
| Running | Send becomes Stop. |

## Context wallet

| Question or decision | Locked answer |
|---|---|
| Purpose | A stacked context/authority deck, not agent identity cards or payment cards. |
| Selection behavior | Cardea suggests relevant passes from the prompt; user confirms or swaps. |
| Structure | Starter passes plus user-created custom passes. |
| Starter passes | Personal, Work, Home, Shopping, Travel. |
| Visible data | Memory scope, connected apps, permissions/authority, limits, optional spending boundary. |
| Artwork | Mix classical mythological scenes with recognizable everyday domain objects. |
| Material | Printed transit-card artwork sealed inside dimensional enamel-edged cards. |
| Motion | Real gyroscopic tilt, restrained glare/foil, tactile selection, touch/reduced-motion fallback. |
| Canvas state | Compact physical stack. |
| Open state | Focused wallet surface above dimmed canvas. |
| Activation | A selected pass can unfold into a portal/work surface when Cardea uses it. |
| Agent Cards/A2A | Not used for wallet. A2A Agent Cards were explicitly rejected as unnecessary MVP complexity. |

## Memory

| Question or decision | Locked answer |
|---|---|
| Canvas form | Restrained clustered sticky-note-like object at canvas edge or affected node. |
| Avoid | Childish bright Post-it styling or covering active work. |
| Note controls | Source, where it influenced work, Edit, Forget, and Save for proposals. |
| Canonical library | Full memory library in Settings. |
| Capture | Cardea suggests a memory; user explicitly promotes it. |
| Provider | Supermemory is the chosen optional memory backend. |
| Provider rule | Disable silent automatic saving. Memory remains visible and removable. |

## Mandate and autonomy

| Question or decision | Locked answer |
|---|---|
| Complex mission start | Prompt unfolds into an editable mandate, then collapses into root node. |
| Mandate contains | Goal, constraints, branches, selected passes, connections, budget, authority, approval boundaries. |
| Simple tasks | May begin immediately when low risk. |
| Autonomy name | Free Passage. |
| UI | Off-by-default toggle in mandate and Settings. |
| Meaning | Automatic action only inside explicit visible limits. Permanent hard stops remain. |
| Friction principle | Reduce unnecessary approval while never silently crossing consequential boundaries. |

## Settings, auth, onboarding, and notifications

| Question or decision | Locked answer |
|---|---|
| Authentication | Normal Cardea sign-in. Supabase Auth selected. |
| Sign-in surface | A dedicated `/signin` page, not a modal, so there is one auth surface. `?next=` is bounded to same-origin paths. |
| Primary method | Continue with Google via `signInWithOAuth`, returning through `/auth/callback` under PKCE. |
| Fallback method | Email magic link via `signInWithOtp`, same callback. |
| Guest access | Automatic, one server-authorized mission per guest session. Signing in upgrades to personal usage. |
| Judge access | Submission code POSTed only to `/api/judge/redeem`; grants ten runs with no account, no Google, and no email. |
| Judge code handling | Compared in constant time against a stored hash, never logged, stored, echoed, or explained on failure. |
| Integration management | Quick Settings slide-over plus full management page. |
| Connector provider | Composio selected for Gmail, Calendar, and similar user apps. |
| Missing connection | Pause node, open official OAuth, resume same node after verified callback. |
| First-run onboarding | Short skippable centered Cardea dialog on canvas. |
| Tour | Two illustrated moments plus one real Focus/node-selection interaction. |
| Notifications | Needs You capsule plus optional browser/mobile/email alerts per mission. |
| Mobile scope | Monitoring, approvals, notifications, and quick replies, not a squeezed full desktop canvas. |

## Mission completion and history

| Question or decision | Locked answer |
|---|---|
| Completion | Canvas becomes a replayable mission artifact. |
| Artifact shows | Decisions, evidence, planned/approved spend, actions completed, remaining actions, risks. |
| Home/history | App still opens directly to canvas; recent missions live in a compact history control. |

## Public and judge experience

| Question or decision | Locked answer |
|---|---|
| Public entry | Explore preloaded Phoenix -> San Francisco mission without auth. |
| Personal mission | Requires sign-in. |
| Guest quota | One mission per signed guest session, with IP only as abuse signal. |
| Judge access | Separate judge code with up to ten runs. |
| Quota enforcement | Server-side, never local storage only. |

## WebMCP decisions

| Question or decision | Locked answer |
|---|---|
| Inbound Cardea tools | Eight narrow tools: create, inspect, update mandate, focus, redirect, set state, resolve approval, open takeover. |
| Broad single tool | Rejected. |
| Expose every UI action | Rejected. |
| API used | Current `document.modelContext`, not deprecated `navigator.modelContext`. |
| Manual fallback | Normal UI remains functional when WebMCP is unavailable. |
| Live verification | Chrome 151 production page discovers all eight tools. |
| API-key requirement | None for ChatGPT browser agent. |
| Two-way demo | Separate-origin companion WebMCP site, explicitly trusted. |
| Cloudflare Browser Run | Deferred, not MVP critical path. |
| Cloudflare edge WebMCP | Acknowledged real, explicitly deferred. |
| Shopify | Optional one-day spike only after core stability; not critical path. |

## Backend choices

| Concern | Locked answer |
|---|---|
| Primary orchestrator | Vercel AI SDK 6 for optional Cardea autonomous runtime. |
| Model strategy | GPT-5.6 Terra default, GPT-5.6 Sol bounded escalation. |
| Durable execution | Inngest. |
| Auth/database | Supabase Auth + Postgres. |
| State model | Append-only mission events plus materialized current state. |
| Realtime | AI SDK foreground streaming plus Supabase Realtime committed events. |
| Memory | Supermemory. |
| User app connectors | Composio plus native provider path where appropriate. |
| Approval | Deterministic policy engine outside model. |
| Prompt injection | Trusted instructions separated from bounded untrusted evidence and action requests. |
| Observability | Redacted OpenTelemetry across mission/model/tool/approval/token/cost events. |
| Context efficiency | Structured context compiler, retrieval, prompt caching, per-call token and cost budgets. |
| Rate limiting | Layered by user, signed guest, IP signal, mission, branch concurrency, tokens, cost, and expensive tools. |
| Domain design | Generic capability adapters discovered at runtime, no hardcoded branch taxonomy. |

## Component and resource policy

| Resource | Approved role |
|---|---|
| Beautiful UI | Prompt bar, activity, approvals, task rows, context cards, streaming, selection anatomy. |
| BeUI | Tilt card, morphing modal, drawer, theme transition, expandable controls, toast. |
| Rare UI | At most a few focal spatial effects after performance review. |
| Transitions.dev | Exact state-change mechanics after trigger/exit/interruption is defined. |
| Mobbin | Real screen and flow anatomy. |
| Paper/Figma | Tools and references, not art directors. |
| Source adoption | Inspect live behavior/source/license/dependencies/a11y/mobile/reduced motion; import smallest mechanic and restyle fully. |

## Explicitly rejected product output

- Current fixture canvas styling is not approved as final.
- Current compact cards, repeated thumbnails, debug selector, wizard state rail, and dense activity layout must not guide Claude's redesign.
- Landing's original giant centered headline/template silhouette was rejected.
- Any claim of visual completion requires rendered reference comparison at desktop and mobile sizes.

## Implementation status versus decision status

- A decision being implemented does not mean its current visual execution is approved.
- Claude should preserve working behavior and WebMCP effects, but may replace product markup and styles.
- The authoritative visual rebuild process is in `docs/CLAUDE_UI_REBUILD.md`.
- The full backend contract is in `ARCHITECTURE.md`.
- The eight production WebMCP tools and test instructions are in `README.md`.

## 2026-08-27: Cardea's spoken voice is lowercase casual

Owner decision during the concierge-close build: when Cardea herself speaks
in first person (the concierge bubble that closes a buying mission, and any
future spoken moments), the voice is lowercase casual, in the register of a
sharp friend texting: "found your best bet. annes flowers, $50-60. opening
their page now. which one you want?" This deliberately unlocks the
sentence-case rule for these bubbles only. Interface labels, buttons,
headings, documentation, and every other surface stay sentence case, and
the no em dash rule is unchanged everywhere.

Same session: the buying close is the Jarvis pattern. The verdict lands,
the top pick's order page opens by itself in a live browser tab exactly
once per mission, the other options are chips that switch the page, and
the full evidence brief lives behind a receipts drawer instead of being
the first thing shown.

## 2026-08-29: The landing page is light-only

Owner decision: the landing page dropped its own theme toggle and dark hero
plate. `src/app/page.tsx` wraps the whole page in `data-theme="light"`, and
`globals.css` re-declares the light tokens at that selector, so the landing
renders in warm bone regardless of a visitor's saved theme. The app's own
theming is unchanged: `/app`'s theme toggle and constellation-black dark
grid still exist for signed-in canvas use. This is a landing-only material
choice, not a reversal of the two-material light/dark system decided
earlier in this log.

## 2026-08-29: Landing feature proof is the real product

Owner decision: the engine section and the authority section on the
landing page now mount the app's actual `NodeCard`, `ApprovalCard`, and
`MandateSheet` components (`src/components/landing/product-demos.tsx`,
importing straight from `src/app/app/_components`), with fixture props
drawn from missions that actually ran. Handlers are no-ops, but the
rendered markup is the same component the canvas uses, not a lookalike.
Each engine card plays a CSS scene, an empty canvas, a typed prompt, then
components rising into place, built from the `scene-type`, `scene-caret`,
and `scene-rise-1/2/3` keyframes in `globals.css`. Generated artwork
remains atmosphere only, never a claimed product screenshot. The closing
section now carries a new dawn-arch plate (`closing-dawn.webp`) in place
of the earlier closing image.

## 2026-08-29: Approval visibility contract

Owner decision: a pending approval always fronts its node. Approval
geometry lives in `src/app/app/_components/approval-rects.ts`:
`approvalWorldRects` places each pending approval's card beside its node,
and `approvalFrameBox` is the box the camera frames when an approval
arrives, so the node and its question read together instead of the card
being cropped off. The board's tab-placement engine treats that rectangle
as reserved furniture, so nothing Cardea opens on its own can tile over
the card the person is meant to answer.

## 2026-08-29: Full agent control of the workspace via WebMCP

Owner decision: Cardea now registers eleven WebMCP tools instead of eight
(`src/webmcp/use-cardea-webmcp.ts`, mirrored in
`src/core/agent-surface/site.ts`). `inspect_canvas` now carries pending
approval content, question, options, consequence, and id, so an agent can
relay it to the person instead of guessing. `resolve_approval` takes an
optional `approvalId` for when several approvals are pending at once.
`approve_mandate` is new: marked non-read-only, the WebMCP signal for a
consequential action, it approves exactly the visible mandate and grants
no spending, sending, or account changes, which each still stop at their
own approval. `list_missions` and `open_mission` expose Figma-style
workspace tabs: `BoardMount`
(`src/app/app/_components/board-mount.tsx`) owns the tab strip and
remounts the board on switch, and `GET /api/missions`
(`src/app/api/missions/route.ts`) lists the signed-in principal's own
recent 20 missions, newest activity first, with no parameter that could
widen it to another account.

- **Aug 29, open_pages (tool 12).** An in-page agent can open up to three public https pages as live browser tiles on the canvas through `open_pages`. The tiles are placed by the same collision engine as every other tab, each one spends a metered live-browser session, and the tool's description tells the agent to open only pages the person asked to see or that mission evidence names.

- **Aug 29, glass hero canvas.** The hero carries the product's own canvas at roughly 56 percent of the viewport as a refractive glass sheet over the threshold artwork: real WorkspaceTabs, NodeCard, ApprovalCard, and ComposerShell inside, glass on the panel only. A deliberate, user-decided exception to the no-glassmorphism rule, scoped to this one hero moment. The landing stages also now carry the board's own material tokens (board-material class mirrors board.module.css light values) so real components render identically on the landing and the canvas.

- **Aug 29, landing truth and uniformity pass.** The no-glass hero is final: real components float directly on the threshold artwork, lifted by soft bone glows behind each UI cluster rather than any pane. Cloudflare and Shopify are promoted from documented extensions to live integrations on every truth surface (stack tiles, llms.txt, markdown, receipts marks), under the landing brief's own condition, since Browser Rendering runs the live sessions and the storefront MCP prepares real carts. The trust row is uniform: equal stage heights, aligned captions, one design-colour wash (blue pale rising, a breath of coral). The browser tile gained a reusable BrowserTileShell so the landing shows the real tile opening, Cloudflare mark in the viewport. Component modules carry light re-pins so a saved dark app theme can never darken the light-only landing.
