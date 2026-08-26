# Cardea UI rebuild brief for Claude

Status: authoritative visual rebuild handoff.

Read this after `AGENTS.md`, `DESIGN.md`, and `docs/PRODUCT_FLOW.md`. For visual decisions, the approved user references and this brief override the current `/canvas` implementation. The current code is interaction scaffolding, not a visual reference.

## Product truth

Cardea is a shared spatial workspace used by a human and the agent already present in ChatGPT's in-app browser. ChatGPT can call Cardea's eight WebMCP tools and the same visible canvas must respond. Cardea is not a chat wrapper, React Flow diagram, compact dashboard, or collection of agent cards.

The primary relationship is:

`human goal -> living canvas -> visible web work -> dependencies -> human judgment`

An OpenAI API key is optional for Cardea's private autonomous harness. It is not required for ChatGPT to use Cardea's WebMCP interface. Do not make optional backend complexity the organizing idea of the UI.

## Actual visual references required

Do not begin high-fidelity work without the original images attached in the Claude workspace. At minimum inspect:

- Infinite canvas references: Paper/Figma/Stitch/n8n and the dark spatial AI canvas.
- Browser preview and takeover references: Aside browser panel and full takeover.
- Prompt composer references: minimized pill, expanded composer, source chips, drop state, voice state.
- Transit-card references: Japanese metro passes, Suica/Oyster/Metrocard, and colorful collectible card systems.
- Classical editorial references: Aegis/Civor landing compositions and generated Cardea threshold imagery.
- AI-native component references: Beautiful UI activity, approvals, context cards, loading, recommendations, and prompt bar.
- Motion references: BeUI tilt card, morphing panel, theme transition, and expandable controls.
- Cardea logo and historical Cardea figure.

Assign references narrowly: composition, product anatomy, card material, typography, motion, or atmosphere. Do not average them into one generic style.

## Current implementation is rejected visually

Preserve useful behavior, but do not preserve its composition or component styling merely because it exists.

Explicit failures to remove:

- developer-facing fixture scene selector or journey-step switcher in product chrome;
- wizard navigation across Prompt, Mandate, Parallel Work, Reroute, Needs You, Memory, and Artifact;
- seven equal mini-cards visible in one viewport;
- identical fake website thumbnails repeated across nodes;
- tiny labels, tiny controls, excessive pills, borders, and microcopy;
- fixed selection toolbar visible before selection;
- approvals duplicated into colliding floating cards;
- activity rail permanently consuming the canvas;
- literal bright sticky notes covering active work;
- generic serif headlines used as product hierarchy everywhere;
- centered marketing-style headline where a product composer should be;
- dense React Flow, Jira, or dashboard silhouette;
- orbit, sparkle, and mythology used as decoration instead of state or interaction.

## Canvas composition

- The application opens directly onto an infinite canvas, never a dashboard.
- Empty state centers one calm, high-quality composer with Cardea's small ambient presence.
- Keep product copy restrained. The composer and available action are the focus.
- During active work, show two or three substantial browser/work windows in the current viewport, not every branch.
- Other nodes may exist beyond the viewport and appear in a subtle minimap.
- Nodes vary in size based on information and state.
- Partial offscreen windows and meaningful negative space establish an infinite surface.
- Dependencies are a primary visual layer: calm curves at rest, traveling energy while active, visible reroute when state changes.
- Root mission is understated and spatially anchors the graph without becoming another dashboard card.
- Toolbar is minimal and left-aligned; selection controls appear only after selection.
- Persistent composer rests at bottom-center and expands on focus.
- Light mode is warm-bone paper with a quiet micro-grid; dark mode is orbital black with constellation depth.

## Browser nodes

- Default anatomy: mythic codename plus clear role, domain/source, large inspectable 16:9 page state, one concise Cardea sentence, and state.
- Website previews must have distinct, credible anatomy appropriate to their source. Do not repeat one thumbnail.
- A node expands from its location in place, preserving spatial origin.
- Full takeover is optional after in-place expansion.
- Takeover floats above a dimmed canvas at a resizable 70/30 default.
- Left side is the visible website or work surface, including clicks and typing when real.
- Right side is a chronological action summary with filters for Plan, Actions, Evidence, Decisions, Errors, and Approvals.
- Show evidence and concise reasoning summaries, never raw hidden chain-of-thought.

## Context wallet

The wallet is a product anchor and requires original treatment.

- It appears on the canvas as a compact physical stack, not a flat settings chip.
- Clicking opens a focused wallet surface above a dimmed canvas.
- Starter passes: Personal, Work, Home, Shopping, Travel.
- Users can create custom passes.
- Cardea suggests relevant passes from the prompt; user confirms or swaps them.
- Each pass visibly communicates memory scope, connected apps, authority, and optional limits.
- Card artwork mixes a classical mythological scene with one recognizable everyday domain object, composed like a collectible transit poster.
- Material: tactile printed artwork sealed inside a soft dimensional enamel edge.
- Motion: restrained gyroscopic tilt, cursor-responsive glare or foil only where readable, tactile select/deselect, static touch and reduced-motion fallback.
- Card data and controls remain live HTML over approved generated artwork.
- A selected pass unfolds into a portal or relevant work surface when Cardea uses it.
- Do not use separate agent identities or A2A Agent Cards.

## Prompt composer

- Initial state: large centered prompt with files, sources, voice, commands, and wallet access.
- Mission state: compact bottom-center pill.
- Focus expands into a rounded multiline composer.
- `@` searches nodes and sources; `/` searches commands.
- Focus tool plus node click inserts `@Codename` and scopes pause, redirect, retry, revert, compare, summarize, or takeover.
- Attachments and selected passes appear as real chips.
- Dragging files transforms the composer into a drop surface.
- Voice has a clear listening and transcript state.
- Send becomes Stop while Cardea is active.
- Do not expose a model picker in the MVP.

## Mandate and authority

- Complex prompts unfold the composer into an editable Cardea mandate, then collapse it into the root node.
- Show goal, constraints, branch plan, selected passes, required connections, budget, and approval boundaries.
- `Free Passage` is a clear off-by-default toggle with plain-language scope.
- Payments, purchases, signatures, account/permission changes, sensitive messages, deletion, and protected-data disclosure always remain hard stops.
- The mandate should feel like an elegant personal operating agreement, not an enterprise configuration table.

## Needs You and approvals

- One floating orbital capsule at top-center appears only when judgment is required.
- Approval is mirrored at the affected node and in the Needs You queue, but never duplicated as overlapping cards.
- Approval card shows recommendation, evidence, alternatives, consequence, and Accept or Modify.
- Blue plus coral marks the human threshold; red is error, green is completion, neutral is paused.
- State always has text/icon support, never color alone.

## Memory

- Relevant memory appears as a restrained clustered note object at a canvas edge or affected node.
- Notes expose source, influence, Edit, and Forget.
- Cardea proposes memory; the user explicitly promotes it.
- Avoid childish Post-it styling and avoid covering active work.
- The full memory library belongs in Settings.

## Cardea presence

- Cardea is the only guide, not a cast of subagent mascots.
- Visual form: textured classical editorial figure with subtle living motion and an animated orbital braid.
- Resting canvas presence is small and ambient.
- Expand only for onboarding, meaningful commentary, approvals, or completion.
- The logo remains simplified and usable at favicon size.

## Typography and material

- Newsreader: landing display and rare major human-decision moments.
- Geist: almost all product UI, controls, body, cards, and browser chrome.
- Geist Pixel: sparse status, elapsed time, node telemetry, and activity metadata.
- Do not use large serif typography as a substitute for product hierarchy.
- Soft rounded geometry is approved, but not every object is a pill.
- Avoid global glassmorphism, blue button glow, purple AI gradients, bento grids, and outline-heavy surfaces.
- Use depth, tonal contrast, print texture, enamel edges, and spatial layering with a real purpose.

## Motion

- Fast tactile controls.
- Slower breathing canvas motion.
- Deliberate portal and shared-layout transitions.
- Connector energy reflects actual work.
- Every transition is interruptible and reversible.
- Implement reduced-motion and low-power fallbacks.
- No continuous decorative animation that harms input latency.

## User flow and required states

Preserve and visually rebuild:

1. centered empty composer;
2. short skippable Cardea tour with two illustrations and one real node-selection interaction;
3. mandate and pass confirmation;
4. active mission with two or three visible work windows;
5. node focus and scoped prompt;
6. error and visible dependency reroute;
7. Needs You approval;
8. memory proposal and control;
9. in-place expansion and takeover;
10. completion artifact and replayable history;
11. quick settings drawer plus full Settings page;
12. missing OAuth connection pause/resume;
13. guest quota and judge-code state;
14. mobile monitoring, approval, notification, and quick reply.

## WebMCP behavior that must not regress

The deployed page currently exposes and verifies these eight tools:

- `create_mission`
- `inspect_canvas`
- `update_mandate`
- `focus_node`
- `redirect_node`
- `set_node_state`
- `resolve_approval`
- `open_takeover`

Chrome 151 production verification confirms discovery of all eight. `create_mission` visibly changes the page to planning, and `inspect_canvas` returns bounded state. A visual rewrite must preserve the hooks, visible effects, feature detection, and normal manual UI fallback.

## Landing-page relationship

- Landing and Product share typography, palette, Cardea imagery, and component material, but not the same composition.
- Landing is classical editorial and atmospheric.
- Product is precise, spatial, calm, and work-focused.
- Hero should show meaningful real product, not generated fake UI.
- Keep navigation brutally simple and claims truthful.

## Execution sequence

1. Inspect all actual references.
2. Run the existing product and capture current states.
3. Preserve behavior contracts but treat current markup/styles as replaceable.
4. Redesign only one desktop active-canvas state first.
5. Present that rendered screenshot for user approval.
6. After approval, propagate the system to empty, mandate, error, approval, memory, takeover, completion, light, dark, and mobile.
7. Render and visually review at approximately 1440, 768, and 390 CSS pixels.
8. Test keyboard, touch, focus, overflow, reduced motion, interruption, and performance.
9. Do not claim completion from source or build success alone.

## Hard acceptance test

When the composition is blurred, it must read as an expansive living workspace with a few substantial work surfaces and visible dependencies, not a dashboard. When product nouns are removed, the dependency behavior, wallet passes, scoped prompting, takeover boundary, and approval threshold must still make Cardea recognizable.

