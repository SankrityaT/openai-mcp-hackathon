import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

const origin = process.env.CARDEA_APP_ORIGIN;
if (!origin) throw new Error("CARDEA_APP_ORIGIN is required for the companion build");
const parsed = new URL(origin);
if (parsed.protocol !== "https:") throw new Error("CARDEA_APP_ORIGIN must use HTTPS");

await mkdir("dist", { recursive: true });
await Promise.all(["index.html", "styles.css"].map((file) => cp(file, `dist/${file}`)));
const source = await readFile("webmcp.js", "utf8");
await writeFile("dist/webmcp.js", source.replace("__CARDEA_ORIGIN__", JSON.stringify(parsed.origin)));
await writeFile("dist/_headers", `/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors ${parsed.origin}\n  Permissions-Policy: tools=(self \"${parsed.origin}\")\n`);

