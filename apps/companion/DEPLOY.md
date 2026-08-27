# Deploying the Cardea WebMCP companion

The companion is a static site with no dependencies and no build tooling beyond Node. `build.mjs`
copies three files into `dist/` and bakes exactly one trusted Cardea origin into `webmcp.js` and
into `dist/_headers`.

`dist/` is gitignored and must never be committed: a bundle baked with a localhost origin would
silently trust the wrong origin if it were ever published.

## Environment

| Where | Variable | Value | Purpose |
|---|---|---|---|
| Companion build | `CARDEA_APP_ORIGIN` | `https://cardea-two.vercel.app` | Baked into `exposedTo`, CSP `frame-ancestors`, and `Permissions-Policy: tools`. HTTPS required. |
| Companion build (local only) | `ALLOW_HTTP_ORIGIN` | `1` | Permits `http://localhost:3000` / `http://127.0.0.1:3000`. Never set in a deploy environment. |
| Cardea (Vercel) | `NEXT_PUBLIC_CARDEA_COMPANION_ORIGIN` | the companion origin, e.g. `https://cardea-companion.netlify.app` | The single origin Cardea embeds and passes to `getTools({ fromOrigins })`. Also drives Cardea's CSP `frame-src` and `Permissions-Policy: tools`. |

The two origins point at each other. Deploy the companion first to learn its origin, then set the
Cardea variable and redeploy Cardea.

## Netlify (primary)

1. Create a new Netlify site from this repository.
2. Set **Base directory** to `apps/companion`. `netlify.toml` there already declares
   `command = "node build.mjs"` and `publish = "dist"`, both relative to the base directory.
3. In **Site configuration → Environment variables**, add
   `CARDEA_APP_ORIGIN = https://cardea-two.vercel.app`. Do not add `ALLOW_HTTP_ORIGIN`.
4. Deploy. The build fails loudly if `CARDEA_APP_ORIGIN` is missing or not HTTPS, which is the
   intended guard.
5. Note the resulting origin, for example `https://cardea-companion.netlify.app`.
6. Verify the headers before trusting the deployment:

   ```bash
   curl -sI https://<companion-origin>/ | grep -iE 'content-security-policy|permissions-policy|x-content-type|referrer-policy|origin-agent-cluster|strict-transport-security'
   ```

   Expect `frame-ancestors https://cardea-two.vercel.app`, `tools=(self "https://cardea-two.vercel.app")`,
   `nosniff`, `strict-origin-when-cross-origin`, `Origin-Agent-Cluster: ?1`, and
   `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`. The HSTS value is
   emitted from both `netlify.toml` and `dist/_headers` (belt-and-suspenders); the rest split the
   same way as before — `nosniff`/`Referrer-Policy`/`Origin-Agent-Cluster` come from `netlify.toml`,
   `Content-Security-Policy`/`Permissions-Policy` are generated into `dist/_headers` by the build.

## Vercel static (fallback)

Netlify's `_headers` file is not read by Vercel, so the fallback needs the headers declared in
project config instead.

1. Create a Vercel project with **Root Directory** `apps/companion`.
2. Framework preset: **Other**. Build command `node build.mjs`. Output directory `dist`.
3. Set `CARDEA_APP_ORIGIN` in project environment variables.
4. Add `apps/companion/vercel.json` with the same two headers the Netlify build generates, with
   the Cardea origin written literally:

   ```json
   {
     "headers": [
       {
         "source": "/(.*)",
         "headers": [
           { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors https://cardea-two.vercel.app" },
           { "key": "Permissions-Policy", "value": "tools=(self \"https://cardea-two.vercel.app\")" },
           { "key": "X-Content-Type-Options", "value": "nosniff" },
           { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
           { "key": "Origin-Agent-Cluster", "value": "?1" },
           { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" }
         ]
       }
     ]
   }
   ```

   Re-run the same `curl -sI` check afterwards.

## Cardea side

Set `NEXT_PUBLIC_CARDEA_COMPANION_ORIGIN` to the companion origin and redeploy. Because it is a
`NEXT_PUBLIC_*` variable it is inlined at build time, so a redeploy is required — changing it in
the dashboard alone has no effect.

`next.config.ts` derives Cardea's headers from that variable:

- `Content-Security-Policy: frame-src 'self' <companion origin>` — only that origin is embeddable.
  When the variable is unset it degrades to `frame-src 'self'`.
- `Permissions-Policy: tools=(self "<companion origin>")` — delegates the WebMCP `tools` feature.
  The `<iframe allow="tools">` attribute in the canvas is necessary but not sufficient without it.

Only `frame-src` is declared in that CSP, deliberately. A full policy would need script/style
nonce plumbing through Next.js, which is a separate change; declaring one directive leaves every
other directive unrestricted rather than silently breaking the app.

## Local development loop

```bash
# terminal 1
pnpm dev                                   # Cardea on http://localhost:3000

# terminal 2
cd apps/companion
CARDEA_APP_ORIGIN=http://localhost:3000 ALLOW_HTTP_ORIGIN=1 node build.mjs
npx --yes serve dist -l 4321               # or any static server on a distinct port
```

Then run Cardea with `NEXT_PUBLIC_CARDEA_COMPANION_ORIGIN=http://localhost:4321 pnpm dev`.

`http://localhost:*` is a secure context in Chrome, so WebMCP and `crypto.subtle` both work. The
two ports are distinct origins, so this exercises the real cross-origin path rather than a
same-origin shortcut. Do not publish a `dist/` produced this way.

## Manual Chrome verification

Cross-origin discovery cannot be exercised by the Node test suite; it requires a WebMCP-capable
browser. Verify by hand:

1. Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled and Chrome restarted.
2. Open the companion origin directly. The footer should read "Five WebMCP tools are available to
   the trusted Cardea origin." If it still reads "Normal browsing works without WebMCP", the
   browser did not expose `document.modelContext`.
3. Open Cardea `/canvas?state=active`, open the **Companion origin** tool in the left toolbar.
4. Confirm the panel shows the exact configured origin and the companion renders inside the frame.
5. Press **Discover tools**. Expect five tools: `search_catalog`, `get_item`, `compare_items`,
   `update_cart`, `read_policies`. `search_catalog` is badged `read`; `update_cart` is badged
   `write`.
6. Run the read tool: `search_catalog` with `query = lamp`. The companion's own catalog inside the
   iframe filters — the human and the agent see the same state — and Cardea records untrusted
   evidence with a sha-256 digest.
7. Run the reversible write: `update_cart` with `itemId = lumen-lamp`, `quantity = 2`. The
   companion's visible cart updates. Re-run with `quantity = 0` to reverse it.
8. Open the activity drawer. Each invocation appears twice: an **Actions** entry with the bounded
   structured input, and an **Evidence** entry with origin, trust, digest, byte count, excerpt, and
   whether it was persisted.
9. Negative check — origin isolation: open the companion in a tab that is not Cardea's origin and
   run `await document.modelContext.getTools({ fromOrigins: ["<companion origin>"] })` in DevTools.
   It must return an empty list, because `exposedTo` names only Cardea's origin.
10. Negative check — CSP: temporarily point `NEXT_PUBLIC_CARDEA_COMPANION_ORIGIN` at a different
    origin and confirm the browser refuses to frame it, citing `frame-src`.

## Verifying in ChatGPT

Open the deployed Cardea `/canvas` in ChatGPT's built-in browser and ask it to inspect the canvas.
ChatGPT drives Cardea's eight inbound tools; the outbound companion half is operated from the
companion panel in the same visible canvas, and its results land in the same activity surface
ChatGPT can read back through `inspect_canvas`.
