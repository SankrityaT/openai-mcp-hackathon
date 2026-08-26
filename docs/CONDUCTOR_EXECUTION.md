# Cardea Conductor execution plan

This plan is optimized for a sub-one-week WebMCP hackathon. It follows the official Conductor operating model and the saved loop-engineering research. The goal is maximum verified product value per unit of human review, not maximum simultaneous code generation.

## Critical rule

Do not create landing and product workspaces from `origin/main` until the checked-in Cardea source-of-truth documents are reviewed and merged into `main`. A new Conductor workspace starts from the remote base and does not inherit unmerged files or workspace-local `.context` attachments.

Shared sources:

- `AGENTS.md`: mandatory project workflow and routing.
- `DESIGN.md`: brand, visual language, component behavior, and approved interaction decisions.
- `docs/LANDING_PAGE.md`: landing-page ownership and acceptance.
- `docs/PRODUCT_FLOW.md`: application flow and required states.
- Future `ARCHITECTURE.md`: backend choices, contracts, schemas, security, and integration boundaries.

## Recommended topology

Keep one integration control room and no more than three implementation workspaces active at once.

### Control room

Use this workspace for:

- locked scope and decisions;
- dependency graph and task ownership;
- architecture and shared contracts;
- review and merge;
- assembled demo verification;
- scope cuts.

Avoid feature implementation here while workers own the same areas.

### Workspace 0: Foundation

Create first and merge before Landing and Product begin.

Owns:

- current framework and package-manager preservation;
- shared font loading and theme foundation;
- design tokens and semantic primitives;
- application shell and route boundaries;
- shared icon, status, button, card, and focus conventions;
- typed fixture contracts for mission, branch, node, event, approval, memory, and wallet card;
- one minimal dev fixture and test harness.

Must not:

- build the whole landing page;
- build the whole canvas;
- choose backend vendors without an approved architecture decision;
- replace the framework or package manager.

Why it lands first: landing, product, and backend otherwise edit root layout, global styles, package manifests, and shared types concurrently.

### Workspace 1: Landing page

Create from fresh `origin/main` after Foundation lands.

Owns:

- public marketing route and section components;
- landing-only generated assets and responsive crops;
- public demo and Start a Mission entry presentation;
- partner-logo presentation after truth verification;
- desktop and mobile landing visual QA.

Reads:

- `DESIGN.md`.
- `docs/LANDING_PAGE.md`.
- foundation tokens and primitives.

Must not:

- change shared contracts without escalation;
- implement the product canvas;
- invent integration claims;
- install component libraries without approval.

Use a second chat in the same workspace as a read-only visual critic after the first full page is rendered. The implementer fixes findings.

### Workspace 2: Product canvas

Create from fresh `origin/main` after Foundation lands.

Owns:

- authenticated application route and canvas shell;
- prompt composer states;
- mission, branch, node, connector, minimap, breadcrumb, toolbar, and layout behavior;
- wallet, memory notes, Needs You, activity rail, and browser takeover UI;
- representative mock-data golden journey;
- desktop product and mobile monitoring/approval views;
- product visual QA.

Reads:

- `DESIGN.md`.
- `docs/PRODUCT_FLOW.md`.
- approved `ARCHITECTURE.md` contracts.
- foundation tokens, fixtures, and primitives.

Must not:

- invent backend event shapes;
- implement provider SDKs inside view components;
- change landing-page sections;
- expose fake raw reasoning or fake live browser state.

Use an implementer chat, then a separate same-workspace reviewer chat for interaction, accessibility, and screenshot critique.

### Workspace 3: Mission runtime and WebMCP

Create after `ARCHITECTURE.md` and foundational schemas land. It may run in parallel with Landing and Product if it owns separate files.

Owns:

- selected orchestration runtime;
- durable mission and event state;
- WebMCP registration, schemas, and execution;
- approval enforcement, checkpoints, retry/idempotency, usage quota, and audit;
- streaming contract consumed by Product;
- one thin real end-to-end action.

Must not:

- restyle product components;
- add every possible integration;
- adopt multiple top-level orchestrators.

After the walking skeleton works, use a bounded follow-up workspace or task for the single winning connector path, likely Composio plus Supermemory and a narrow Shopify path.

### Final workspace: Judge and deployment hardening

Reserve the final 48 hours for:

- compatible-browser WebMCP discovery and execution;
- clean public guest and judge-code path;
- live URL, environment, and quota verification;
- public repository clean-clone setup;
- license visibility;
- README, architecture diagram, and WebMCP implementation evidence;
- three-minute demo rehearsal and recording;
- submission links and smoke test.

Do not introduce architecture or optional integrations here.

## Execution waves

### Wave 0: review and land truth

1. Review `DESIGN.md`, Landing, Product, and this plan.
2. Commit them on the current branch.
3. Merge them into `main`.
4. Reattach or safely provide the approved visual-reference images to visual workspaces because `.context` is not shared.

### Wave 1: architecture and foundation

1. Open one architecture session in the control room or a dedicated architecture workspace.
2. Decide one primary orchestrator, memory provider, auth/database, WebMCP boundary, connector path, browser fallback, schemas, and security rules.
3. Write and merge `ARCHITECTURE.md`.
4. Create Foundation and land shared shell, tokens, types, fixtures, and verification.

### Wave 2: walking skeleton and two visual surfaces

Run at most three workspaces:

1. Mission runtime/WebMCP produces one real tool invocation and streamed event.
2. Product canvas consumes the contract and renders the golden mission.
3. Landing page builds its full narrative and uses real product states as proof.

Integrate the smallest green prerequisite immediately. Do not wait for a final-day merge.

### Wave 3: depth

- Connect the selected user-app integration path.
- Implement visible, consent-based memory.
- Add relocation replanning, approval, failure, and takeover states.
- Replace provisional landing crops with approved generated assets.
- Run independent code and visual review.

### Wave 4: hardening

- Exercise authentication, OAuth pause/resume, quota, retries, duplicate requests, and failure.
- Run full desktop and mobile visual review.
- Verify WebMCP in the required compatible browser.
- Freeze optional scope.

## Worker contract

Every session prompt must include:

```text
Outcome: one observable user or system result.
Why: how it serves the golden relocation demo.
Scope: owned files or subsystem, plus exclusions.
Inputs: exact source-of-truth docs and landed dependencies.
Contract: schemas, events, routes, or UI states that cannot drift.
Acceptance: commands and observable runtime behavior.
Visual acceptance: target viewports, states, and reference roles.
Handoff: files, tests, screenshots, risks, and known limitations.
Stop conditions: decisions that must be escalated instead of guessed.
```

## Copy-ready Landing session prompt

```text
Outcome: implement and visually verify the complete Cardea public landing page.
Why: judges must understand Cardea within five seconds and enter the public relocation demo.
Read first: all applicable AGENTS.md files, DESIGN.md, and docs/LANDING_PAGE.md. Read the relevant installed Next.js 16.3.3 documentation before code. Use the craft-distinctive-ui skill and re-inspect the supplied visual references.
Scope: marketing route, landing-only components, landing assets, responsive composition, and landing tests.
Do not change: product canvas implementation, backend contracts, integration claims, shared package choices, or root tokens without escalation.
Reference policy: inspect Beautiful UI, BeUI, Rare UI, Transitions.dev, and Mobbin only for the exact states named in the brief. Verify source and license before proposing any copied mechanic. Do not install anything without authorization.
Acceptance: full desktop and mobile page rendered and screenshot-reviewed; hero survives without animation; real product occupies meaningful space; partner claims are truthful; keyboard, contrast, reduced motion, performance, lint, typecheck, and build pass.
Handoff: changed files, commands run, desktop/mobile screenshots, reference trace, asset provenance, and remaining limitations.
```

## Copy-ready Product session prompt

```text
Outcome: implement and visually verify the Cardea canvas golden journey using the approved contracts and representative fixtures.
Why: the canvas is Cardea's competitive wedge and must demonstrate visible, steerable, dependent web work.
Read first: all applicable AGENTS.md files, DESIGN.md, docs/PRODUCT_FLOW.md, and approved ARCHITECTURE.md. Read the relevant installed Next.js 16.3.3 documentation before code. Use the craft-distinctive-ui skill and re-inspect supplied visual references.
Scope: product route, canvas, nodes, connectors, prompt states, wallet, memory notes, Needs You, activity rail, takeover, mission completion, and mobile monitoring/approval views.
Do not change: landing-page composition, backend event schemas, provider SDKs, authentication architecture, or shared package choices without escalation.
Reference policy: use Beautiful UI and BeUI only for selected mechanics; rebuild them in Cardea's tokens and anatomy. Never expose fake raw reasoning or generated product screenshots.
Acceptance: golden relocation journey works from prompt through mandate, parallel branches, apartment failure, reroute, approval, scoped redirect, takeover, and completion; desktop/mobile states screenshot-reviewed; keyboard, reduced motion, contrast, touch, performance, lint, typecheck, and build pass.
Handoff: changed files, commands run, screenshots, interaction coverage, reference trace, and remaining limitations.
```

## Review loop

Inside each workspace:

1. Orient on instructions, sources, and current diff.
2. Reproduce baseline and run the smallest relevant check.
3. Implement one coherent outcome.
4. Run focused tests, typecheck, and lint.
5. Exercise the real runtime path.
6. Capture and inspect target-size screenshots for visual work.
7. Ask a fresh-context reviewer to inspect the diff and acceptance contract.
8. Fix findings and rerun broader gates.
9. Hand off a clean diff with evidence.

Use Ralph-style automated loops only for narrow mechanically verifiable work, such as resolving known test or type failures. Do not use them for art direction, architecture, live credentials, or final demo judgment.

## Integration cadence

- Keep `main` deployable.
- Land foundation contracts before dependents.
- Integrate at least morning and evening, and immediately after shared-contract changes.
- Keep one owner per shared file cluster.
- Rebase or merge the latest base before final polish.
- Run the assembled golden journey and screenshot review after every integration wave.
- Stop or archive work that leaves the golden demo path.

## Conductor configuration, only after approval

The repository currently has no shared Conductor settings. A later authorized setup may add:

- `pnpm install` setup;
- concurrent local dev scripts using `CONDUCTOR_PORT`;
- lint and build run actions;
- safe `.env*` Files to copy behavior.

Do not add the configuration until the user explicitly authorizes it and the relevant Next.js documentation is checked.

## Immediate next action

Review these documents, then merge them into `main`. After that, open the architecture decision session before opening the Landing and Product implementation workspaces. Once architecture and Foundation land, create Landing and Product from fresh `origin/main` and paste the prompts above.

