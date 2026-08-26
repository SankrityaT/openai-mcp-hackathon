# Cardea landing-page brief

Read `DESIGN.md` first. This brief owns the public marketing experience only. It does not authorize changes to the product canvas, backend architecture, shared package manifest, or integration contracts.

## Objective

Make Cardea understandable and desirable within five seconds, then prove that its spatial human-agent experience is fundamentally different from chat and browser sidebars. The page must feel authored, editorial, and product-led, not like a generic AI launch template.

## Audience and decision

- Primary audience: WebMCP Challenge judges and technically curious early adopters.
- Pressure: judges have many projects to review and a demo under three minutes.
- Primary decision: enter Cardea and inspect the relocation mission.
- Secondary decision: start a new mission.

## Opening frame

### Navigation

- Left: Cardea mark and `Cardea`.
- Center: `Canvas`, `Use cases`, `How it works`.
- Right: `Watch demo`, `Start a Canvas`.
- Keep About in the footer.
- Do not add Pricing, Docs, Blog, Login, or other template navigation unless a real destination exists.
- Do not put `Your Canvas Beyond the Prompt` in the navbar.

### Hero copy

Headline:

> Turn Any Goal Into a Living Workspace

Subhead:

> Cardea plans, browses, researches, and acts across the web while you watch, steer, and approve the work in real time.

Actions:

- Primary: `Enter Cardea`.
- Secondary: `Start a Mission`.

### Hero composition

- Use a bold editorial opening with generous negative space and a real Cardea product canvas occupying approximately the lower 60 percent.
- The product may enter partially cropped in the first viewport and reveal more as the user scrolls.
- The hero must remain coherent without animation.
- Use generated classical-celestial atmosphere behind or around the real product, never a generated fake product screenshot.
- Scrolling should feel like passing through Cardea's threshold into the live canvas, not a routine fade-up stack.

## Narrative sequence

Each section has a different spatial job while preserving one grid and type system.

### 1. Promise: beyond the prompt

Job: establish Cardea as a living workspace rather than a chat assistant.

Visual anchor: the real canvas begins beneath the editorial hero. Show the centered prompt becoming a mission root and the first branches appearing.

### 2. Mechanism: one mission, many dependent worlds

Job: show why a spatial interface is necessary.

Content: Phoenix to San Francisco relocation expands into Housing, Travel, Moving, Home, Utilities, and Admin. Use real browser-node components and real connector motion.

Defining moment: the preferred apartment becomes unavailable and multiple paths visibly reroute.

### 3. Human control: Cardea handles coordination, you handle judgment

Job: demonstrate approval, redirection, and takeover.

Content: Needs You capsule, approval card, node-scoped prompt, 70/30 takeover view, and explicit hard stops. Use the real components.

### 4. Context wallet and memory

Job: show that Cardea understands context without hiding it.

Content: stacked Personal, Work, Home, Shopping, and Travel cards, plus editable memory-note clusters. Explain that users confirm which context enters a mission and can edit or forget memory.

### 5. Live web work

Job: prove Cardea operates through live tools and connected services.

Content: show browser previews, source evidence, OAuth pause/resume, Shopify cart preparation, Gmail and Calendar context, and WebMCP-native actions where supported. Do not place raw architecture diagrams on the landing page.

### 6. Use cases

Job: demonstrate that relocation is the flagship, not the only possible mission.

Use a small editorial set, not six generic cards. Candidate secondary cases:

- Launch a microbusiness without publishing or spending before approval.
- Coordinate a complex move or life transition.
- Research and execute a multi-service purchase with visible constraints.

Keep examples honest and structural. Do not imply integrations that are not functional.

### 7. Partner credibility

Use only real and actually integrated or deployment-relevant partner logos. Possible set after verification: OpenAI, Chromium, Vercel, Cloudflare, Shopify, Composio, and Supermemory. Do not show a logo merely because the company sponsors the challenge.

### 8. Closing threshold

Return to a quieter Cardea doorway image and one clear next action. Use the dark-mode companion asset if it improves page rhythm.

Primary action: `Enter Cardea`.

## Judge access

- Public visitors can explore the preloaded Phoenix to San Francisco mission without authentication.
- Starting a personal mission requires sign-in.
- Public guests receive one server-authorized mission run through a signed guest session and abuse signals.
- A judge access code receives a separate quota of up to ten runs.
- The code must be verified server-side, stored safely, and never embedded in client code.

## Visual implementation

- Typography: Newsreader for major editorial display, Geist for UI and body, Geist Pixel for sparse activity accents.
- Palette and materials: follow `DESIGN.md` exactly.
- Maintain a real product-to-atmosphere ratio. Generated media supports the narrative but never becomes the proof.
- Avoid repeating the same centered copy plus card grid structure across sections.
- Mobile is a recomposition: fewer and larger images, real product crops, concise copy, and accessible actions.

## Generated asset family

Use the checked-in prompt and production guide in `docs/LANDING_ASSETS.md`. Reattach the approved visual-reference images in a new Conductor workspace because chat attachments and `.context` are not shared.

Required family:

1. Hero threshold opening, with quiet upper space and Cardea/product focus below.
2. Mission mechanism panorama, with architectural thresholds and visible reroute metaphor.
3. Memory archive, with transit cards, notes, material clues, and editable/removable implication.
4. Authority detail, with Cardea's hand, coral hinge, and a paused path.
5. Nocturnal closing threshold for the final CTA.

Generate the hero first, choose one direction, and carry its exact Cardea anatomy, arch geometry, pigment, grain, and line weight into the other four. Preserve prompts, provider, date, selected output, edits, and provenance.

## Component-reference routing

- Beautiful UI: inspect Prompt Bar, Approval Card, Task Rows, Context Cards, Thinking, Loading, Recommendation Card, Selection Actions, and Flowchart.
- BeUI: inspect Tilt Card, Morphing Modal, Drawer, Theme Toggle, Expandable Control, Animated Toast Stack, and Action Swap.
- Rare UI: inspect only if one focal spatial effect has a real narrative job.
- Transitions.dev: search by the exact state change, including card resize, panel reveal, theme transition, drag/drop, and error recovery.

Do not import a complete page or unchanged component block. Record source, license, dependencies, and adopted mechanic.

## Acceptance criteria

- Within five seconds, a visitor can say what Cardea is, what makes it different, and what to click.
- The real product occupies meaningful hero space and remains readable at desktop and mobile targets.
- The page uses the approved references without copying any one site's layout or styling.
- All displayed product behavior is real or explicitly labeled as a demo fixture.
- All partner logos are truthful and linked where appropriate.
- Theme, keyboard, contrast, reduced motion, and responsive behavior pass review.
- Full-page desktop and mobile screenshots have been inspected against `DESIGN.md`.
- The page builds cleanly, loads quickly, and never blocks the primary CTA on a large generated asset.

## Out of scope

- Pricing page.
- Blog or documentation portal.
- Fabricated testimonials or customer logos.
- Technical architecture diagram inside the marketing narrative.
- A second visual direction.
- Product-canvas implementation beyond the minimum real previews required for the landing page.
