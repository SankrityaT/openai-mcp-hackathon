<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Cardea project instructions

Before any user-facing work, read `/DESIGN.md` completely. Then read the matching brief:

- Authoritative decisions: `/docs/DECISION_LOG.md`

- Landing page: `/docs/LANDING_PAGE.md`
- Product application: `/docs/PRODUCT_FLOW.md`
- Product visual rebuild: `/docs/CLAUDE_UI_REBUILD.md`
- Multi-workspace execution: `/docs/CONDUCTOR_EXECUTION.md`
- Backend implementation: `/ARCHITECTURE.md` once it exists
- Backend ticket queue: `/docs/tickets/README.md`

Do not replace locked product, brand, interaction, or visual decisions without user approval. Do not infer backend contracts that have not been recorded in `ARCHITECTURE.md`.

For visual work, use the `craft-distinctive-ui` skill, inspect actual reference images in the current workspace, and render and visually review desktop and mobile states before completion. Component libraries are mechanical references, not Cardea's art direction; verify source, license, dependencies, accessibility, responsive behavior, performance, and reduced motion before adopting the smallest useful mechanic.

Preserve pnpm, Next.js 16.3.3, React 19.2.8, Tailwind CSS 4, the existing lockfile, and repository conventions. Read the relevant installed Next.js documentation before writing Next.js code.

Never fabricate live browser state, tool activity, reasoning, evidence, integrations, customers, metrics, or claims. Never commit credentials or expose connector tokens to the client.
