# Cardea design system

Status: locked product and visual direction for the WebMCP Challenge.

This document is the shared design source of truth for every Cardea workspace and agent. It records the user-approved decisions from the product-definition sessions. Read it before changing any user-facing surface. The detailed landing narrative is in `docs/LANDING_PAGE.md`; the application behavior is in `docs/PRODUCT_FLOW.md`.

The complete question-by-question product record is in `docs/DECISION_LOG.md`. If this document is less specific, the decision log controls.

## Product truth

Cardea is a user-owned agent operating environment where a person can watch, steer, and approve complex work across the web. It is not an AI browser with a chat sidebar and it is not an enterprise support concierge. Chat captures intent; the spatial canvas makes parallel work, dependencies, evidence, changing state, and human judgment visible.

The product must remain impossible to relabel as an unrelated workflow tool. Its defining relationship is:

`prompt -> living mission canvas -> parallel web work -> visible dependencies -> human judgment -> real outcome`

### Brand

- Product name: **Cardea**.
- Descriptor: **Your Canvas Beyond the Prompt**.
- Landing headline: **Turn Any Goal Into a Living Workspace**.
- Landing subhead: **Cardea plans, browses, researches, and acts across the web while you watch, steer, and approve the work in real time.**
- Cardea is both the product and the single warm guide. There is no secondary mascot or cast of agent personalities.
- Name story: Cardea is associated with hinges, thresholds, guardianship, and transitions. The near-Earth quasi-moon adds an orbital layer without turning the identity into a space product.
- Voice: warm, calm, capable, concise, transparent, and never theatrical about routine work.

### Flagship mission

The golden demo is a new-job relocation from Phoenix to San Francisco. It is a coordinated mission rather than a trip planner.

Reference prompt:

> I am moving from Phoenix to San Francisco in 10 days for a new job. Keep planned move-in costs under $8,000, work around my calendar, and prioritize a bright apartment within 30 minutes of the office with no ground-floor units. I am bringing my desk but almost no other furniture. Prepare everything you can, but do not book, buy, sign, or send anything without my approval.

Parallel branches include Housing, Travel, Moving, Home, Utilities, Admin, and First Week. The defining demo event is that the leading apartment becomes unavailable, forcing the canvas to reroute travel, delivery, utilities, and budget dependencies in view. Cardea handles coordination; the human handles judgment.

## Reference lock

The user supplied and approved the reference set in the originating Cardea design session. New visual work must inspect the original images, not rely only on these descriptions. Because chat attachments and `.context` are workspace-local, attach the original references again in a new Conductor workspace before high-fidelity work.

### Primary composition

The Aegis/Civor classical editorial landing references contribute a bold editorial silhouette, generous negative space, high-contrast serif display type, tactile paper grain, sparse navigation, and large atmospheric classical imagery. Do not copy their green tint, exact hero layout, industrial micro-labels, or generic centered SaaS structure.

### Product anatomy

- Paper, Figma, Google Stitch, and n8n references contribute infinite-canvas spatial freedom and progressive zoom.
- The dark AI media canvas contributes black-field depth, branching content windows, and inspectable work.
- The Aside browser references contribute small live website previews, expanded takeover, and a visible control boundary between agent and human.
- Beautiful UI contributes truthful anatomy for prompt bars, approvals, task rows, context, recommendations, streaming, and tool activity.
- BeUI contributes candidate mechanics for tilt cards, morphing panels, theme transitions, docks, drawers, and expandable controls.
- Transit-card references contribute stacked physicality, bold information hierarchy, collectibility, and domain differentiation.

Do not copy any one product's chrome, tokens, or component styling. Component libraries are mechanical references, not Cardea's art direction.

### Imagery and material

The approved Cardea asset language combines classical figures and thresholds with Japanese transit-poster clarity, celestial transitions, pale screenprint or fresco pigment, and tactile paper tooth. Generated media establishes atmosphere only. Product screenshots, mission graphs, evidence, controls, and browser previews must be real components.

## Positive art-direction brief

Cardea should feel like a warm cultural artifact that happens to operate the live web: editorial and classical at the brand layer, precise and tactile at the product layer, spatial and cinematic only when work expands. The landing page uses warm paper, monumental threshold imagery, and a large real product reveal. The application uses a soft infinite canvas, collectible context cards, live browser windows, and restrained orbital motion. Information breathes at mission level and becomes denser as the user zooms into work. One animated relationship carries the identity: a calm connector becomes an energized path when Cardea acts, reroutes visibly when dependencies change, and pauses at the coral hinge when human judgment is required.

## Logo and Cardea figure

- The approved logo direction combines Cardea's side profile, an open threshold, an orbital braid, a Cardea-blue circle, and a coral hinge point.
- Preserve the richer generated mark as animation and illustration reference, but create a simplified, precise SVG for production and favicon use.
- The simplified mark must remain recognizable in one color and at 16 px.
- Cardea's animated presence is a textured classical editorial figure with subtle living motion and an animated orbital braid, not a photorealistic statue or chat avatar.
- On the canvas, Cardea rests as a small ambient orbital presence and expands only for meaningful commentary, approvals, onboarding, or completion.

## Typography

Use the three related roles below. Verify exact files, licenses, weights, language coverage, and loading behavior before implementation.

### Newsreader

- Role: landing hero, major section headings, rare product editorial moments, and Cardea's most human statements.
- Character: literary, warm, intelligent, and calm.
- Do not use it for dense controls, tables, long node labels, or small canvas text.
- Prefer optical sizing and a restrained range of roman weights. Italic is reserved for quotations or a singular emphasis.

### Geist

- Role: product UI, navigation, body copy, forms, buttons, menus, cards, and long-form explanatory text.
- Use real weights, tabular numerals where needed, and short readable measures.
- It is the default interface voice across light and dark themes.

### Geist Pixel

- Role: agent activity, node status, progress, timestamps, elapsed time, loading, tool telemetry, and a small number of transit-like labels.
- Use sparingly so it remains an authored signal rather than a retro filter.
- Never use it for paragraphs, approvals, or essential long instructions.

### Typographic behavior

- The wordmark is `Cardea`, without the descriptor in the navbar.
- Favor sentence case. Avoid tracked all-caps microcopy as a default.
- Hero copy must wrap intentionally at desktop and mobile sizes.
- UI text cannot become pale or undersized to appear premium.
- Preserve semantic HTML and selectable text. Do not rasterize headings.

## Color system

### Brand colors

- Warm Bone: `#F4F0E8`, primary light canvas and editorial ground.
- Orbital Black: `#11110F`, primary dark canvas and strongest text.
- Cardea Blue: `#445CFF`, identity, active work, focus, selected paths, and primary action.
- Hinge Coral: `#FF6B4A`, human checkpoint, pivot, threshold, and restrained warmth.

### State colors

Exact accessible values may be tuned during implementation, but roles cannot drift:

- Active: Cardea Blue shimmer or traveling pulse.
- Needs You: paired Cardea Blue and Hinge Coral pulse with explicit label and icon.
- Complete: green with check and status text.
- Error: red with explanation and recovery actions.
- Paused: neutral surface with pause icon and label.
- Human takeover: strong neutral boundary with explicit `You are controlling` state.

Color is never the sole carrier of meaning. Every state also needs an icon, text label, or motion change.

### Domain color

The interface remains Cardea blue, coral, bone, and black. Domain-specific color lives inside wallet-card artwork and tiny identifiers only. It must not recolor the entire application.

## Themes and surfaces

Cardea has one design language with two material expressions:

- Light mode: warm-bone micro-grid, blue and coral transit details, pale paper, controlled pigment texture, and soft enamel edges.
- Dark mode: constellation-black grid, luminous but restrained blue, coral hinge points, matte deep surfaces, and cinematic depth.
- Follow the operating-system theme by default.
- Provide a quick theme toggle with a portal-like transition.
- Preserve structure, typography, hierarchy, and component anatomy between themes.

Avoid global glassmorphism. Blur and transparency are permitted only when they clarify spatial layering, such as the dimmed canvas behind takeover mode.

## Geometry and physical language

- Components are soft and rounded, with a small consistent radius scale rather than arbitrary pills everywhere.
- Wallet cards are tactile paper artworks sealed inside dimensional enamel-edged shells.
- Cards, approvals, browser windows, and drawers should feel related through edge treatment, inset borders, and shadow logic.
- Pills are reserved for compact status, filters, references, and the minimized prompt bar.
- Major content must not become a grid of identical cards. Use cards only where grouping or physical ownership is real.

Exact radii, shadows, and spring values are implementation tokens, selected after inspecting the chosen Beautiful UI, BeUI, Rare UI, and Transitions.dev primitives. Their defaults must be replaced with Cardea tokens.

## Motion system

The motion character is fast and tactile in controls, slower and breathing on the canvas, and deliberate when a portal opens.

- Hover, press, selection, and chip feedback: fast, interruptible, and reversible.
- Panel resize, disclosure, and shared-layout morph: smooth and state-driven.
- Browser-node expansion: preserve spatial origin as it opens in place.
- Portal and theme transition: deliberate, used rarely, and meaningful.
- Connector breathing: calm at rest, traveling energy pulse while active, visible reroute when dependencies change.
- Node active state: subtle blue shimmer, never constant distracting glow.
- Card tilt: restrained gyroscopic response with a static touch fallback.
- Cardea presence: minimal idle motion; richer motion only for decisions or narrative moments.

Implement `prefers-reduced-motion`, low-power fallbacks, and static equivalents. Continuous rendering must pause when offscreen or idle.

## Core product components

### Infinite canvas

- Opens directly to the canvas, not a dashboard.
- Light canvas uses a warm-bone micro-grid; dark canvas uses a constellation-black grid.
- Cardea auto-arranges new work, while users can drag, pin, group, and collapse objects.
- Provide a subtle minimap and Mission -> Branch -> Node breadcrumbs.
- Use a minimal left toolbar; selection-specific controls appear beside the selected object.
- The initial prompt begins in the center. During a mission, the composer persists at bottom-center.

### Connectors

- Use calm curved paths rather than rigid flowchart elbows.
- Active paths carry traveling energy pulses.
- Dependency changes animate as visible reroutes.
- Error, approval, completion, and pause states alter both the path and its accessible label.

### Browser nodes

- Default node contains a live 16:9 website preview, domain, mythic codename, clear functional role, state, progress, and one sentence of Cardea commentary.
- Clicking expands the node in place; full-screen takeover remains optional.
- Expanded mode floats above a dimmed canvas and defaults to a resizable 70/30 split.
- Left pane shows the live browser and visible clicks or typing.
- Right rail shows an activity summary, actions, tools, searches, evidence, decisions, and approvals.
- Do not claim to expose private chain-of-thought. Show concise reasoning summaries and verifiable activity.
- Takeover controls include Pause, Resume, Redirect, Retry, Revert, and Take Over when applicable.

### Activity rail

- Use one chronological stream with filter chips for Plan, Actions, Evidence, Decisions, Errors, and Approvals.
- Rows are expandable and collapse after settling.
- Use Geist Pixel for timestamps and compact telemetry.
- Use a Cardea orbital loader rather than a generic spinner.
- Sources and evidence must be clickable and visibly attributed.

### Needs You

- A floating orbital capsule sits at the top-center when any decision needs the user.
- Approval cards are mirrored beside the affected node and inside the central queue.
- Cards show the question, recommended option, evidence, alternatives, consequences, and Accept or Modify actions.
- Blue and coral indicate a human threshold. Spending, booking, signing, sending, permissions, deletion, and other consequential actions must be explicit.

### Focus and scoped prompting

- A dedicated Focus tool lets the user click any node.
- Selection inserts an `@NodeName` chip into the composer.
- Commands can then scope to the node, including pause, redirect, retry, revert, compare, summarize, or take over.
- Every node receives a curated Greek or celestial codename plus an explicit role, for example `Lyra · Housing`.
- Codenames are dynamically assigned from a curated pool. Do not generate unreadable or culturally careless names.

### Prompt composer

- Resting state: minimized soft pill at bottom-center.
- Focused state: expands into a rounded multi-line composer.
- Attachment state: becomes a drop surface and shows files, sources, wallet cards, and selected nodes as chips.
- Supports `@` sources, `/` commands, wallet access, voice, attachments, and node mentions.
- While Cardea is working, Send becomes Stop.
- Do not expose a model picker in the MVP. Cardea should feel like one coherent intelligence.

### Context wallet

- Appears as a dimensional stack of collectible cards on the canvas.
- Cardea suggests cards based on the prompt, and the user confirms or swaps them before a complex run.
- Starter cards: Personal, Work, Home, Shopping, and Travel.
- Users can create additional cards.
- Each card carries relevant memory, connected apps, permissions, authority limits, and optional spending limits.
- Artwork mixes classical mythological scenes with one recognizable everyday object, composed like a collectible transit poster.
- Selecting a card unfolds it into a portal or live work surface when relevant.

### Memory notes

- Relevant memories appear as small sticky-note clusters near the canvas edge or affected node.
- Notes show source, where the memory influenced work, and Edit or Forget controls.
- The canonical memory library lives in Settings.
- Cardea suggests potential memories; the user promotes them to persistent memory.
- Do not silently save everything. Exact Supermemory behavior must be implemented from the current SDK and explicit consent rules.

### History and recovery

- Each node has a local history timeline.
- Complex or consequential changes create mission-wide checkpoints.
- Safe failures use bounded retry, backoff, idempotency, fallback, and circuit breaking.
- After safe recovery is exhausted, the node becomes visibly red and offers Retry, Redirect, or Take Over with a plain explanation.
- Irreversible actions never retry silently.

### Settings

- Quick settings use a slide-over panel.
- Full management uses a dedicated page.
- Sections include Profile, Integrations, Context Wallet, Memory, Authority, Notifications, Appearance, and Usage.
- Missing integrations can be connected just in time through official OAuth; the affected node pauses and resumes after authorization.

## Mission lifecycle

### Entry and onboarding

- Regular product entry requires sign-in. Exact provider is an architecture decision.
- A short, skippable centered Cardea tour lives inside the canvas.
- Tour has two custom illustrated moments and one real interaction where the user selects a node and summons the prompt bar.
- After onboarding, the canvas and centered prompt are immediately available.

### Planning

- Simple low-risk tasks may begin immediately.
- A complex mission causes the prompt bar to unfold into a Cardea mandate sheet.
- Mandate includes goal, constraints, plan, selected wallet cards, connected services, approval boundaries, and authority.
- On approval, the mandate collapses into the root mission node.

### Free Passage

- `Free Passage` is an off-by-default toggle in the mandate sheet and Settings.
- It allows Cardea to proceed autonomously only within explicit, visible limits.
- Payments, legal commitments, account changes, sensitive messages, and other hard-stop categories still require confirmation.
- The label must be accompanied by a short plain-language scope summary.

### Execution

- Branches appear and operate in parallel.
- Browser nodes, connectors, commentary, evidence, and state updates stream into the canvas.
- The person may redirect any branch through Focus and `@NodeName` prompting.
- When the preferred apartment becomes unavailable, housing turns red and the dependency graph reroutes before Cardea requests the next decisions.

### Completion

- A completed canvas becomes a replayable mission artifact rather than disappearing.
- Completion card contains decisions, evidence, planned and approved spend, completed actions, remaining actions, and unresolved risks.
- Recent missions remain accessible through a compact history control. The app still opens directly to the canvas.

## Responsive behavior

- Full creation and spatial editing are desktop-first.
- Landing page is fully responsive.
- Mobile product supports monitoring, approvals, notifications, and quick replies.
- Mobile does not squeeze the entire infinite canvas into a small viewport. It presents mission, branch, decision, and activity views by priority.

## Notifications

- In-product requests appear through the Needs You capsule and affected node.
- Optional browser, mobile, and email alerts are configured per mission.
- Notifications must state the required decision and consequence, not generic `Cardea needs attention` copy.

## Accessibility and trust

- Keyboard access is required for canvas selection, prompt commands, menus, approvals, takeover, and dismissal.
- Visible focus, 44 px touch targets, readable contrast, semantic controls, and screen-reader status announcements are mandatory.
- Motion, color, and spatial position cannot be the only explanation of state.
- Do not fabricate customers, results, timestamps, confidence, sources, or activity.
- Confidence labels require a real basis; otherwise use neutral recommendation language.
- Keep consequential boundaries explicit and reviewable.

## Component-source policy

Approved reference pool:

- [Beautiful UI](https://www.beautifului.dev/) for AI-native state anatomy.
- [BeUI](https://beui.dev/) for selected animated primitives.
- [Rare UI](https://www.rareui.com/) for at most a few distinctive focal interactions.
- [Transitions.dev](https://transitions.dev/) for state-specific transitions.
- Mobbin for real screen and flow evidence.

Before copying any source:

1. Inspect the live behavior and actual source.
2. Verify license, package requirements, framework compatibility, accessibility, reduced motion, mobile behavior, and runtime cost.
3. Import the smallest useful mechanic.
4. Replace every demo token, radius, shadow, icon, copy, and surface with Cardea's system.
5. Render and inspect the adapted result at target sizes.

Do not install a dependency or component without user authorization.

## Non-negotiable quality bar

- No generic AI dashboard, purple glow, glass bento grid, fake reasoning, or decorative orbit that does not carry product state.
- No UI screenshot generated as an image. Build the real product.
- No high-fidelity work without the actual reference images available in that workspace.
- No visual handoff without rendered desktop and mobile screenshots and a comparison against this reference lock.
- If a library remains more recognizable than Cardea after adaptation, reject it.
