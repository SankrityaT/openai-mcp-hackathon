# Cardea product-flow brief

Read `DESIGN.md` first. This document defines the user-visible application flow and state model. Backend vendors and exact APIs remain architecture decisions until recorded in a separate `ARCHITECTURE.md`.

## Product promise

Cardea turns a complex goal into a living workspace. The person can see parallel work, understand dependencies, inspect evidence, redirect any branch, take over a live website, and approve consequential actions without losing the whole mission.

## Golden journey

### 1. Enter

- Product opens directly onto the infinite canvas.
- Returning users see a compact history control, not a dashboard.
- First-time users receive a short, skippable centered Cardea tour.
- Tour contains two custom illustrated moments and one real Focus-tool interaction.

### 2. Express intent

- A large prompt composer begins at canvas center.
- It supports voice, files, connected sources, commands, and context cards.
- Golden prompt starts the Phoenix to San Francisco relocation mission documented in `DESIGN.md`.

### 3. Form the mandate

- Simple low-risk prompts may begin immediately.
- A complex prompt unfolds the composer into a Cardea mandate sheet.
- Cardea presents goal, constraints, branch plan, selected context cards, available integrations, expected approval points, and current authority.
- Cardea suggests wallet cards; the user confirms or swaps them.
- `Free Passage` remains off by default and displays its exact permitted scope when enabled.
- Approving the mandate collapses it into the root mission node.

### 4. Expand into work

- Root mission opens into parallel branches.
- Cardea assigns each branch a curated Greek or celestial codename plus a clear role.
- Nodes appear through auto-layout but remain draggable, pinnable, groupable, and collapsible.
- Website work uses live 16:9 browser previews when technically possible; truthful snapshots or structured states may be used where live embedding is impossible.
- One sentence of Cardea commentary sits beneath each active node.

### 5. Inspect and steer

- Selecting Focus and clicking a node inserts an `@NodeName` chip into the persistent bottom composer.
- Scoped commands include pause, resume, redirect, retry, revert, compare, summarize, or take over.
- User can expand a browser node in place, then optionally enter full-screen takeover.
- Expanded view floats above a dimmed canvas and defaults to a resizable 70/30 split.
- Browser is left; Cardea activity rail is right.
- Activity is chronological with filters for Plan, Actions, Evidence, Decisions, Errors, and Approvals.

### 6. Handle changing reality

- The preferred apartment becomes unavailable during the flagship demo.
- Housing becomes red with a plain event description.
- Dependent connectors reroute visibly.
- Travel, furniture delivery, utilities, and budget update in place.
- Cardea retries only safe, idempotent work and explains any remaining recovery choice.

### 7. Ask for judgment

- `Cardea Needs You` appears as a top-center orbital capsule.
- The same approval card appears beside the affected node and inside the queue.
- Card shows recommendation, evidence, alternatives, consequence, and Accept or Modify.
- Example decisions include apartment choice, mover selection, and furniture-cart approval.
- Nothing is booked, purchased, signed, or sent merely for the demo.

### 8. Resume and complete

- Approved branches resume without rebuilding the mission.
- Completed nodes become green and settle without disappearing.
- Completion turns the canvas into a replayable mission artifact.
- Final card lists actions completed, decisions, evidence, planned and approved spend, remaining actions, and risks.

## Canvas hierarchy

### Mission level

Show root goal, branch names, high-level progress, active dependency paths, Needs You count, budget boundary, and current mission status. Keep this level spacious.

### Branch level

Reveal candidate nodes, evidence, branch timeline, dependencies, errors, and pending choices. Increase information density without opening every tool call.

### Node level

Reveal live browser or service state, exact action summary, evidence, tool activity, history, pause/resume, redirect, revert, and takeover.

Use Mission -> Branch -> Node breadcrumbs plus a subtle minimap.

## Persistent composer states

1. Centered welcome composer before a mission.
2. Mandate-sheet expansion for complex work.
3. Minimized bottom-center pill during normal canvas activity.
4. Expanded multi-line composer on focus.
5. Drop surface during file drag.
6. Attachment/reference state with file, source, wallet, and node chips.
7. Listening state for voice input.
8. Running state where Send becomes Stop.
9. Scoped state containing one or more `@NodeName` chips.

Do not expose model selection in the MVP.

## Context wallet

- Wallet is a visible stacked-card object on the canvas.
- Starter cards are Personal, Work, Home, Shopping, and Travel.
- Users may create custom cards.
- Cardea proposes which cards a mission needs; user confirms.
- Each card binds visible preferences and memory, connected apps, authority, and limits.
- Card art combines classical myth with an everyday domain object.
- Card backgrounds may be generated, but text, live state, controls, tilt, and data overlays are real components.

## Memory

- Relevant memory appears as sticky-note clusters at canvas edges or beside affected nodes.
- Each note exposes source, influence, Edit, and Forget.
- Cardea proposes a memory after meaningful user correction or explicit preference.
- User promotes it to persistent storage.
- Settings provides the full searchable memory library.
- Exact Supermemory ingestion, retrieval, update, version, and deletion behavior must be designed from the selected current SDK.

## Integrations and authentication

- Users sign into Cardea before starting personal missions. Provider is not yet locked.
- Settings provides a quick integration slide-over and full connection-management page.
- Composio is the leading connector candidate for Gmail, Calendar, Slack, Notion, and similar services.
- If a mission needs an unconnected service, the node pauses and requests the official OAuth flow.
- After connection, Cardea resumes the node with the same mission state.
- Shopify's native MCP/WebMCP is preferred for commerce if included.
- Never expose raw connector credentials to the client or model.

## Authority and approvals

Consequential categories include spending, booking, signing, publishing, sending messages, deletion, permission changes, account changes, and sensitive data disclosure.

- Normal mode requires explicit approval based on action risk.
- `Free Passage` reduces friction only within explicit preauthorized limits.
- Hard-stop categories remain approvals even in Free Passage.
- Approval decisions and mandate changes become audit events.
- Mission checkpoints precede consequential dependency changes.

## Failure and recovery

- Retry only safe and idempotent operations.
- Use bounded attempts, exponential backoff, timeout, fallback, and circuit breaking.
- Keep one operation key to prevent duplicate action.
- Do not silently retry purchases, sends, signatures, or irreversible writes.
- After safe recovery is exhausted, show the error, evidence, and Retry / Redirect / Take Over.
- Preserve partial progress and branch state.

## Public demo and usage boundaries

- Public visitors can inspect the relocation mission without authentication.
- Starting a personal mission requires sign-in.
- Guest quota: one server-authorized mission per signed guest session with IP-based abuse signals.
- Judge code quota: up to ten runs.
- Never implement quota solely in browser storage.
- Demo accounts, fixtures, and data must be clearly isolated from real users.

## Responsive product

### Desktop

Full canvas editing, auto-layout, grouping, browser expansion, takeover, wallet, memory, and activity rail.

### Mobile

Mission overview, branch drill-down, activity, Needs You approvals, notifications, quick replies, and limited node control. Do not attempt a squeezed desktop canvas.

## Required UI states

- Empty canvas.
- First-run tour.
- Prompt focus and attachment.
- Mandate planning.
- Missing integration and OAuth return.
- Active, paused, Needs You, complete, and error nodes.
- Live browser unavailable fallback.
- Safe retry and exhausted recovery.
- Node selection and scoped prompt.
- History, checkpoint, and revert confirmation.
- Takeover entered and returned to Cardea.
- Memory proposed, saved, edited, and forgotten.
- Guest quota reached and judge-code entry.
- Mission completion.

## Product acceptance criteria

- Golden relocation flow works end to end with representative data.
- One browser or WebMCP action produces a real user-visible result.
- Every active branch exposes verifiable state and evidence.
- Dependency rerouting is visible and understandable.
- The user can focus, redirect, pause, resume, revert, and take over a node.
- Approval cannot be bypassed by UI race, refresh, or duplicate request.
- Activity shows summaries and evidence, not fabricated hidden reasoning.
- Keyboard, reduced motion, contrast, touch, and responsive states pass review.
- Desktop and mobile screenshots are compared against `DESIGN.md`.

## Deferred until architecture lock

- Vercel AI SDK versus OpenAI Agents SDK as primary orchestrator.
- Supermemory versus HydraDB, with Supermemory currently lower risk.
- Auth and transactional database provider.
- Cloudflare Browser Run live fallback scope.
- Cloudflare Sandbox, which should be omitted unless code execution becomes necessary.
- Exact mission, node, event, approval, and checkpoint schemas.
- Exact subagent delegation and concurrency model.

