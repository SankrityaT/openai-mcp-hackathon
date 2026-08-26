# Cardea canvas implementation handoff

Status: functional interaction prototype. The visual system is not approved and is intentionally replaceable.

Branch: `SankrityaT/cardea-canvas-journey`

Route: `/canvas`

This branch contains a client-side representative golden journey for the Phoenix to San Francisco relocation mission. It preserves useful interaction behavior and truthful fixture disclosure, but it does not implement a backend, WebMCP, authentication, integrations, durable approvals, persistent memory, or live browser execution.

## 1. File map

### Product-owned source files

| File | Purpose | Handoff classification |
| --- | --- | --- |
| `src/app/canvas/page.tsx` | Server Component route. Reads review query parameters, loads the fixture through the adapter, and passes serializable props into the client boundary. | Behavioral and reusable. Preserve the route and adapter boundary. Query-driven review controls may be replaced. |
| `src/app/canvas/_components/cardea-canvas.tsx` | Client Component containing the prototype state machine, interaction handlers, semantic controls, desktop and mobile markup, fixture previews, approvals, activity, memory, completion, and takeover. | Behavior is reusable. Markup is provisional and may be replaced completely if the preservation contract below remains intact. |
| `src/app/canvas/_components/canvas.module.css` | Entire provisional visual system, responsive composition, light and dark materials, node positioning, connector motion, takeover layout, and reduced-motion behavior. | Visual and safe to replace completely. None of its tokens or composition should be treated as a final shared design system. |
| `src/app/canvas/_fixtures/types.ts` | Prototype-only typed view models for journey stages, node state, wallet cards, activity, memory, and the relocation fixture. | Behavioral and reusable as view-model guidance. These are not approved backend contracts. |
| `src/app/canvas/_fixtures/relocation.ts` | Clearly disclosed representative content for the relocation mission. | Reusable fixture content. Replace or map it when approved runtime contracts exist. Do not present it as live data. |
| `src/app/canvas/_fixtures/adapter.ts` | `MissionFixtureAdapter` implementation returning the representative relocation mission asynchronously. | Behavioral and reusable. Preserve an adapter boundary between UI and future runtime data. |

### Tests

There are no committed automated unit, component, accessibility, visual-regression, or end-to-end test files for the canvas.

Browser verification was performed through an existing Chrome installation and Chrome DevTools Protocol scripts without adding dependencies. Those scripts were run inline and are not committed test infrastructure.

### Evidence files

Screenshots are stored under `.context/`, which is gitignored and is not part of the commit:

- `.context/canvas-active-redesign/active-dark.png`
- `.context/canvas-active-redesign/active-light.png`
- `.context/canvas-review/desktop-empty.png`
- `.context/canvas-review/desktop-planning.png`
- `.context/canvas-review/desktop-active.png`
- `.context/canvas-review/desktop-light-active.png`
- `.context/canvas-review/desktop-error.png`
- `.context/canvas-review/desktop-reroute.png`
- `.context/canvas-review/desktop-needs-you.png`
- `.context/canvas-review/desktop-takeover.png`
- `.context/canvas-review/desktop-memory.png`
- `.context/canvas-review/desktop-completion.png`
- `.context/canvas-review/mobile-monitor.png`
- `.context/canvas-review/mobile-approval.png`
- `.context/canvas-review/mobile-activity.png`

## 2. Interaction inventory

### Prompt and mandate

- The `empty` stage opens with a centered prompt prefilled from `mission.prompt`.
- Submitting the prompt transitions from `empty` to `planning`.
- Attachment, source, and command buttons are visual placeholders only.
- The mandate displays the goal, constraints, branch plan, selected wallet cards, authority copy, and Free Passage.
- `Revise prompt` transitions from `planning` to `empty`.
- `Approve the mandate` transitions from `planning` to `active`.
- Free Passage is local component state and defaults to off.

### Wallet selection

- Personal, Work, Home, and Travel begin selected.
- Clicking a wallet card toggles its ID in a local `Set<string>`.
- The selected count updates immediately.
- The active desktop canvas exposes a compact wallet stack that reports how many selected cards influence the fixture mission.
- Wallet selection is not persisted and does not change runtime authority.

### Mission spawning

- Approving the mandate changes the visible stage to `active`.
- Node records are mapped from the representative fixture and rendered in parallel.
- No mission is created on a server and no execution begins.

### Node selection and scoped prompting

- `selectedNode` identifies the active node, defaulting to `lyra`.
- Clicking a node selects it.
- Clicking `Inspect live work` expands or collapses the selected browser node in place.
- Pressing `F` toggles Focus mode when focus is not inside an input or textarea.
- While Focus mode is active, selecting a node inserts its codename as an `@NodeName` mention and opens the persistent composer.
- The selected node controls the label and target for Pause, Redirect, Retry, Revert, and Take Over.

### Persistent prompt composer

- The normal mission state shows a minimized bottom-center prompt pill.
- Clicking it expands a multiline composer.
- A selected node appears as an `@NodeName` chip.
- Enter submits a representative instruction, while Shift+Enter preserves a newline.
- Sending only closes the composer and displays a local status toast.
- The displayed `⌘ K` hint is not wired to a keyboard handler.
- Attachments, voice, slash commands, and source insertion are not implemented.

### Pause and resume

- Pause stores the selected node ID in `pausedNode`.
- The derived node status becomes `paused` and the action changes to Resume.
- Resume clears `pausedNode`.
- Takeover also exposes Pause and Resume controls.
- No background execution is actually paused or resumed.

### Redirect

- Redirect inserts the selected node codename into the composer and opens it.
- Sending records only a representative local notice.
- Redirect from takeover returns to the canvas and opens the scoped composer.

### Retry

- Retry transitions the fixture to `active` and displays `Safe representative retry completed`.
- It does not implement retry policy, idempotency, backoff, timeout, or circuit breaking.

### Revert

- Revert transitions the fixture to `active` and reports returning to the checkpoint before the housing update.
- Takeover Revert also closes takeover.
- No checkpoint data is stored or restored.

### Takeover

- Take Over opens a modal-like dimmed canvas with `aria-modal="true"`.
- The default split is 70 percent representative browser and 30 percent activity.
- A range input resizes the left pane between 55 and 80 percent.
- The left pane is a structured representative fixture, not a live website.
- The right pane contains the chronological activity stream and recovery controls.
- `Return to Cardea` or Escape closes takeover.
- The current implementation does not provide a complete focus trap or focus restoration contract.

### Approval mirroring

- The `approval` stage shows a singular top-center `Cardea Needs You` capsule.
- A compact approval is mirrored beside Lyra.
- Clicking the capsule opens the activity drawer, where the full approval appears again.
- The full approval includes recommendation, representative evidence, consequence, Modify, and Accept.
- Modify scopes the composer to `@Lyra` without changing stage.
- Accept transitions to `memory`, displays a local notice, and returns the mobile tab to Monitor.
- Approval state is not durable, server-authorized, or protected against refresh and multi-client races.

### Activity filters

- Available filters are All, Plan, Actions, Evidence, Decisions, Errors, and Approvals.
- Filtering is local and derived from `mission.activity`.
- Activity rows use semantic `details` and `summary` disclosure.
- The last visible row is initially expanded.
- Activity records are representative summaries, not hidden reasoning or live tool events.

### Memory interactions

- The Memory toolbar button toggles a local edge cluster.
- The `memory` stage opens the same cluster automatically.
- Notes show representative source and influence copy.
- Edit, Forget, and Save only display local notices.
- No memory is written, versioned, retrieved, or deleted.

### Failure and reroute

- The `error` stage derives Lyra as `error` and changes its commentary and preview.
- The `approval` stage derives Lyra as `needs-you`.
- Dependent node commentary changes for Hermes, Hestia, and Electra.
- Connector and notice styling communicates the fixture reroute.
- Failure is selected through fixture review controls. It is not triggered by a real site event.

### Completion

- The `complete` stage derives every node as `complete` with 100 percent progress.
- A completion artifact summarizes representative planned spend, decisions, actions, and remaining external action count.
- `Start another mission` returns to `empty`.
- Nothing is booked, purchased, signed, or sent.

### Mobile behavior

- Mobile uses a dedicated monitor instead of squeezing the desktop canvas.
- Tabs switch among Monitor, Needs You, and Activity.
- Monitor renders branch rows with role, task, and state.
- Selecting a branch scopes the mobile quick reply to that node.
- The Needs You tab displays the full approval when approval is active.
- Activity uses the same filter and chronological stream behavior as desktop.
- Quick reply submission displays only a representative local notice.
- Mobile does not support spatial editing or takeover.

### Keyboard behavior

- `F`: toggles Focus mode unless focus is inside an input or textarea.
- `Escape`: closes takeover, the activity drawer, the expanded composer, and an expanded node.
- `Enter` on the opening form: unfolds the mandate.
- `Enter` in the scoped composer: submits the representative instruction.
- `Shift+Enter` in the scoped composer: inserts a newline.
- Native Enter and Space behavior operates buttons, selects, and the Free Passage checkbox.
- Visible focus styling is defined in the route-scoped CSS Module.

## 3. State machine

### Primary journey state

`JourneyStage` is a local discriminated union:

```text
empty | planning | active | error | approval | memory | complete
```

Primary transitions:

```text
empty --submit prompt--> planning
planning --revise--> empty
planning --approve mandate--> active
active --fixture event selection--> error
error --retry or revert--> active
error --fixture event selection--> approval
approval --modify--> approval + composer(@Lyra)
approval --accept--> memory
memory --fixture event selection--> complete
complete --start another mission--> empty
```

The fixture scene selector can jump directly between all stages for review. Mobile review controls expose the mission stages after planning. These direct transitions are demonstration controls, not a production orchestration contract.

### Derived node state

Node state is derived from fixture node data plus the current journey stage and `pausedNode`:

- `complete`: every node becomes complete at 100 percent.
- `error`: Lyra becomes error.
- `approval`: Lyra becomes needs-you.
- `paused`: the node matching `pausedNode` becomes paused.
- Other nodes retain fixture status while commentary may change based on dependencies.

### Orthogonal client state

The component also tracks:

- `selectedWallet: Set<string>`
- `freePassage: boolean`
- `focusMode: boolean`
- `selectedNode: string`
- `pausedNode: string | null`
- `composerOpen: boolean`
- `mention: string | null`
- `activityOpen: boolean`
- `memoryOpen: boolean`
- `expandedNode: string | null`
- `takeoverNode: string | null`
- `takeoverSplit: number`
- `filter: ActivityKind | "All"`
- `notice: string`
- `theme: "auto" | "light" | "dark"`
- `mobileTab: "mission" | "approval" | "activity"`

### Required client props

`CardeaCanvas` currently accepts:

```ts
{
  mission: RelocationMissionFixture;
  initialStage: JourneyStage;
  initialTakeover?: string | null;
  initialMobileView?: "mission" | "approval" | "activity";
  initialTheme: "auto" | "light" | "dark";
}
```

`page.tsx` maps review query parameters into those props:

- `state=<JourneyStage>`
- `theme=light|dark`
- `view=takeover`
- `view=activity` for the initial mobile Activity tab

### Fixture adapter boundary

`MissionFixtureAdapter` defines one asynchronous method:

```ts
interface MissionFixtureAdapter {
  getRelocationMission(): Promise<RelocationMissionFixture>;
}
```

The route depends on the interface rather than importing fixture data directly. A future adapter may map an approved runtime contract into the same view model or replace the view model after an architecture decision.

UI components must not import provider SDKs. Provider credentials, orchestration, authorization, storage, and browser execution must remain outside the visual component tree.

### Assumptions that architecture must replace

- Mission, node, event, approval, activity, checkpoint, and memory schemas.
- Durable stage and node state.
- Authentication and mission ownership.
- Server-authorized approval IDs and idempotent decision handling.
- Retry eligibility, backoff, circuit breaking, and operation keys.
- Real browser or WebMCP session state.
- Verifiable evidence and source attribution.
- Integration connection and OAuth return behavior.
- Persistent wallet authority and Free Passage limits.
- Persistent memory consent, versions, edit, and deletion.
- Guest and judge quotas.
- Notifications and multi-device synchronization.
- Mission history, checkpoints, replay, and recovery.

## 4. Known visual failures

The next designer or implementer should treat the current UI as a behavioral prototype, not a visual foundation.

- The wallet does not match the approved stacked gyroscopic transit-card concept.
- Card materials, artwork, depth, and motion are provisional.
- Browser previews are representative fixtures, not satisfactory final windows.
- Cardea's presence and commentary are incomplete.
- Canvas composition still needs stronger reference fidelity.
- Typography, controls, surfaces, and spatial rhythm may be replaced.
- The current active desktop composition is a structural direction only. It has not been approved for propagation.
- Planning, error, reroute, Needs You, takeover, memory, completion, and mobile still reflect the earlier compact prototype composition.
- The exact Newsreader and Geist Pixel font assets are not available through product-owned files. Georgia and Geist Mono substitutes remain provisional.
- The CSS orbital mark is not the approved production Cardea figure or logo.
- Wallet art is procedural CSS and does not satisfy the approved classical transit-poster artwork brief.
- Connector geometry is hand-authored for the representative viewport rather than generated from measured node anchors.
- Browser previews do not embed or stream live pages.
- The original approved attachment set was unavailable in this workspace, preventing exact visual comparison.

## 5. Preservation contract

A visual rewrite may replace all JSX structure in `cardea-canvas.tsx` and all CSS in `canvas.module.css`, provided it preserves the following behavior and trust boundaries:

1. `/canvas` remains a product-owned route that loads data through a replaceable adapter.
2. Representative data remains visibly and unambiguously disclosed.
3. No UI implies that fixture pages, integrations, bookings, purchases, signatures, messages, evidence, or timestamps are live.
4. The seven journey stages remain representable: empty, planning, active, error, approval, memory, and complete.
5. The prompt unfolds into the mandate, and mandate approval spawns the mission view without a dashboard interstitial.
6. Wallet selection and Free Passage remain explicit before mission start.
7. Every visible branch preserves its Greek or celestial codename plus plain-language role.
8. Node selection can scope the persistent composer with `@NodeName`.
9. Pause, Resume, Redirect, Retry, Revert, Inspect, and Take Over remain accessible for applicable nodes.
10. Error and reroute remain understandable without relying on color alone.
11. Needs You remains a singular top-center capsule with mirrored approval access near the affected node and in the queue.
12. Consequential actions retain explicit Accept or Modify boundaries and clear no-action fixture copy.
13. Activity remains chronological, filterable, expandable, and free of fabricated hidden reasoning.
14. Takeover preserves a dimmed canvas, explicit `You are controlling` boundary, browser and activity split, resize control, and return action.
15. Memory remains visibly consent-based with source, influence, Edit, Forget, and Save affordances.
16. Completion remains a replayable artifact rather than removing the mission.
17. Mobile remains a dedicated monitoring, approval, activity, and quick-reply experience rather than a compressed desktop canvas.
18. Keyboard access, visible focus, semantic controls, 44 px mobile touch targets, reduced motion, and overflow safety must not regress.
19. Light and dark materials preserve the same information hierarchy.
20. Provider SDKs and backend assumptions remain outside UI components until architecture is approved.

The following may be replaced without compatibility concern:

- All component markup and DOM nesting.
- All CSS class names and CSS Module contents.
- Node coordinates and connector geometry.
- Visual tokens, radius, shadows, depth, and motion timing.
- The CSS logo and orbital artwork.
- Wallet and browser-preview rendering.
- Desktop and mobile composition.
- Review-only query controls, as long as another deterministic state harness exists.

## 6. Verification record

### Repository gates

Commands run successfully during the implementation and freeze pass:

```bash
pnpm exec next typegen
pnpm exec tsc --noEmit
pnpm lint
pnpm build
git diff --check
```

The production build reports `/canvas` as a dynamic App Router route because it reads `searchParams`.

### Desktop browser review

Viewport: 1440 by 1000 CSS pixels, device scale factor 1.

Captured and visually inspected:

- Empty prompt
- Mandate planning
- Active mission
- Active mission in light material
- Apartment error
- Dependency reroute
- Needs You
- Takeover
- Memory
- Completion
- Revised dark active-state structural prototype
- Revised light active-state structural prototype

### Mobile browser review

Viewport: 390 by 844 CSS pixels using Chrome DevTools Protocol device-metrics emulation.

Captured and visually inspected:

- Mission monitoring
- Needs You approval
- Activity and filters

Measured results from the device-emulated run:

- `innerWidth`: 390
- document `scrollWidth`: 390
- visible interactive targets below 44 px: none in the audited mobile activity view

### Browser interaction checks

The following interactions were exercised in a production build through Chrome DevTools Protocol:

- Keyboard Enter submits the opening prompt and displays the mandate.
- Keyboard Space toggles Free Passage.
- `F` enables Focus mode.
- Keyboard selection of Lyra inserts `@Lyra`.
- Pause changes Lyra to Paused.
- Resume restores Working.
- Redirect opens a scoped composer with `Redirect @Lyra`.
- Retry returns the error fixture to active.
- Revert displays the checkpoint notice.
- Take Over opens an `aria-modal` dialog.
- Escape closes takeover.
- The takeover range changes the split to 60 percent when driven.
- Filtering Activity to Errors leaves one matching row.
- Repeated approval activation settles in the Memory stage in this single-client fixture.
- The tested application page produced zero page-console errors.

### Reduced motion

Chrome media emulation set `prefers-reduced-motion: reduce`.

Computed animation duration for the orbital ring and pulse path was `0.000001s`, and connector dashes resolved to a static equivalent.

### Runtime sample

A clean headless active-state sample recorded:

- JavaScript heap used: approximately 7.26 MB
- DOM nodes: 3,353
- Layout count: 2
- Style recalculation count: 22

This was a development handoff sample, not a Lighthouse result or production performance guarantee.

### Known verification limitations

- No automated test suite is committed.
- No Playwright, axe, Lighthouse, or visual-regression dependency was installed.
- Contrast review was visual and targeted, not a complete automated WCAG audit.
- Screenshots are gitignored `.context` artifacts and will not travel with a clone.
- The original approved reference attachments were unavailable in this workspace.
- No real browser or WebMCP action was exercised because backend architecture is not approved.
- Approval durability, refresh behavior, and multi-client races cannot be validated with client-local fixture state.
- Other states were not visually propagated after the revised active-state structural checkpoint.

## Freeze note

Do not treat this commit as visual completion. It freezes the useful interaction prototype and its fixture boundary so another designer or implementer can rebuild the visual system without losing behavior or trust constraints.
