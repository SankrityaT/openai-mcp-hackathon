# Cardea landing implementation notes

Date: 2026-08-26

## Reference trace

The implementation uses the approved reference lock from `DESIGN.md` and the visual evidence below. Sources contribute one narrow role each. No component source was copied into the repository.

| Source | Role used | Boundary |
| --- | --- | --- |
| User-supplied Aegis screenshot in `.context/attachments/CckZVu/image.png` | Primary editorial silhouette, monumental serif scale, quiet upper field, tactile grain, sparse navigation | Did not copy its green tint, exact layout, micro-label treatment, or imagery |
| [Beautiful UI](https://www.beautifului.dev/) | Prompt, approval, task, context, status, and activity anatomy | Used behavioral anatomy only. Source is MIT licensed, but no source code was copied |
| [BeUI Theme Toggle](https://beui.dev/components/motion/theme-toggle) | Portal-like page repaint from the trigger | Implemented locally with the browser View Transition API and CSS. Did not copy the Motion or next-themes implementation |
| [BeUI Tilt Card](https://beui.dev/components/motion/tilt-card) | Restrained physical response for context objects | Used a small CSS lift and rotation only. No glare and no dependency |
| [BeUI Morphing Modal](https://beui.dev/components/motion/morphing-modal) | Content continuity across a decision state | Adapted as a stable-height approval card with local state, not a copied modal |
| [Transitions.dev](https://transitions.dev/) | Compositor-safe state timing, reversible feedback, and reduced-motion behavior | Used project-owned CSS tokens and static fallbacks. No snippet was copied |
| [Rare UI Folder](https://www.rareui.com/components/foldercomponent) | Inspected as a possible wallet mechanic | Rejected because the literal folder metaphor and Motion dependency compete with Cardea's card language |
| [Mobbin, Grok product reveal](https://mobbin.com/sites/sections/17d26e07-af19-455e-b6e2-1d6edfabbacf) | Large product proof directly beneath concise copy | Did not copy chrome or palette |
| [Mobbin, Jira dependencies](https://mobbin.com/screens/eb4e8742-d7a5-48dc-bb5b-548083c96137) | Readable dependency topology and edge labels | Rebuilt as Cardea nodes, curved connectors, and mission state |
| [Mobbin, Magnific canvas](https://mobbin.com/screens/01a40506-e49b-4efe-9c3e-e2228dcd6080) | Spatial grouping and progressive canvas scale | Did not copy its toolbar, group color, or layout |
| [Mobbin, Airwallex approval](https://mobbin.com/screens/f163ee8f-79d1-4dc5-a626-68c25a971bca) | Evidence beside an explicit consequential action | Rebuilt with Cardea's Needs You, recommendation, evidence, and hard-stop language |
| [Mobbin, Juicebox review](https://mobbin.com/screens/90f31e41-5f08-49b7-98bc-0ff16e31fd71) | Recommendation evidence and alternatives kept in one decision frame | Did not copy its three-column product layout |

## Generated asset provenance

All five atmospheric roles were generated with the built-in OpenAI image generation tool. The tool did not expose a public model identifier. The full approved prompt specifications remain in `docs/LANDING_ASSETS.md`. The selected family was generated on 2026-08-26 from the user-supplied Aegis reference and the chosen Cardea hero. Product UI, evidence, browser previews, controls, mission nodes, memory notes, and approval states are real HTML and CSS components.

Three hero variants were generated first. Variant 2 was selected because it preserved the quiet upper field, kept the threshold dominant, placed the coral point at the hinge, and left a calm lower region for the real canvas.

| Final file | Role | Generated source | Delivery edit |
| --- | --- | --- | --- |
| `public/images/cardea/hero-stage-desktop.webp` | Desktop opening lower plate | `exec-27a0180e-1663-45ed-8f81-bd72f3b72b07.png` | Cropped to the lower figure and threshold plate, converted to WebP at quality 84, metadata removed |
| `public/images/cardea/hero-stage-mobile.webp` | Mobile-specific opening lower plate | `exec-4d6c6860-9a04-403a-8702-f89255a65d51.png` | Cropped to the lower figure and threshold plate, converted to WebP at quality 84, metadata removed |
| `public/images/cardea/mechanism.webp` | Mission and dependency atmosphere | `exec-424e7d47-05e1-431f-927f-17e8fb6f29a5.png` | Converted to WebP at quality 82, metadata removed |
| `public/images/cardea/memory.webp` | Context wallet and memory archive atmosphere | `exec-ee0adb83-efc3-4769-be85-46bed65b27fa.png` | Converted to WebP at quality 82, metadata removed |
| `public/images/cardea/authority.webp` | Human approval hinge atmosphere | `exec-8e78f93f-bd94-4160-86e0-ec67eb02292d.png` | Converted to WebP at quality 82, metadata removed |
| `public/images/cardea/closing.webp` | Nocturnal closing threshold | `exec-f0bc73fa-12eb-4c64-adbf-8a935ba78e9a.png` | Converted to WebP at quality 84, metadata removed |

The original selected PNGs remain in `.context/generated-sources/` for workspace-local review. Delivery assets total less than 900 KB before Next.js image optimization.

## Dependency record

No package was installed, removed, or upgraded. `package.json` and `pnpm-lock.yaml` are unchanged. BeUI, Rare UI, Beautiful UI, and Transitions.dev were inspected only. All shipped mechanics use React, native controls, the View Transition API, CSS, and the existing Next.js image and font systems.

Geist Pixel's Latin WOFF2 is self-hosted at `src/app/fonts/geist-pixel-latin.woff2` through `next/font/local`. The font is distributed by Vercel under the SIL Open Font License 1.1. The required copyright notice and license are preserved beside it in `src/app/fonts/LICENSE-Geist.txt`.

## Truth boundaries

- The Phoenix to San Francisco mission is visibly labeled as a preloaded demo fixture.
- Service rows explicitly state that they demonstrate an interface boundary and do not claim a live connection.
- The personal mission composer truthfully reports that authentication is not connected in this landing fixture.
- Partner logos are omitted because no qualifying live integration or deployment relationship is verified in this workspace.
