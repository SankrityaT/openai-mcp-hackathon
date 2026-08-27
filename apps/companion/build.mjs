import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

/**
 * Bake the single trusted Cardea origin into the companion bundle.
 *
 * Production requires an HTTPS origin. `ALLOW_HTTP_ORIGIN=1` additionally permits a plain-HTTP
 * loopback origin so the companion can be served next to `next dev` on http://localhost:3000.
 * The escape hatch is deliberately narrow: it never accepts a non-loopback host, so setting it in
 * a deploy environment cannot downgrade a real deployment. Netlify and Vercel never set it.
 */
const origin = process.env.CARDEA_APP_ORIGIN;
if (!origin) throw new Error("CARDEA_APP_ORIGIN is required for the companion build");
const parsed = new URL(origin);
const loopback =
  parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
const allowHttp = process.env.ALLOW_HTTP_ORIGIN === "1";

if (parsed.protocol !== "https:") {
  if (!(allowHttp && parsed.protocol === "http:" && loopback)) {
    throw new Error(
      "CARDEA_APP_ORIGIN must use HTTPS. For local development only, set ALLOW_HTTP_ORIGIN=1 with an http://localhost or http://127.0.0.1 origin.",
    );
  }
  console.warn(
    `[companion] Local development build: trusting plain-HTTP loopback origin ${parsed.origin}. Never deploy this output.`,
  );
}

await mkdir("dist", { recursive: true });
await Promise.all(["index.html", "styles.css"].map((file) => cp(file, `dist/${file}`)));
const source = await readFile("webmcp.js", "utf8");
await writeFile("dist/webmcp.js", source.replace("__CARDEA_ORIGIN__", JSON.stringify(parsed.origin)));
await writeFile("dist/_headers", `/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors ${parsed.origin}\n  Permissions-Policy: tools=(self "${parsed.origin}")\n`);
