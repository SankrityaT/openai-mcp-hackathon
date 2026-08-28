// Operator smoke test for `cardea.web_research`. Nothing calls this
// automatically and no test imports it: it exists so one real search-and-read
// round trip through Cloudflare Browser Run can be proven from a terminal.
//
//   pnpm exec tsc -p tsconfig.harness-tests.json
//   node --env-file=.env.local src/harness/adapters/web-research-smoke.mjs ["query"]
//
// It creates one real Cloudflare session, runs one search, opens the results
// it picked, and always closes the session, including on failure. It prints
// the adapter's own output payload verbatim. It never prints the token.
//
// Mirrors web-lookup-smoke.mjs, which mirrors shopify-smoke.mjs. Deliberately
// a .mjs sitting outside the TypeScript test projects, so `pnpm test:*` never
// picks it up and never reaches the network.
import { WebSocket } from "ws";

const QUERY = process.argv[2] ?? "best pizza phoenix arizona";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = process.env.CLOUDFLARE_BROWSER_TOKEN?.trim();
if (!accountId || !token) {
  console.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_BROWSER_TOKEN must be set.");
  process.exit(1);
}

const { WebResearchAdapter, WEB_RESEARCH_CAPABILITY_ID } = await import(
  "../../../.context/harness-tests/harness/adapters/web-research.js"
);

const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering`;
const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function createSession() {
  const response = await fetch(`${base}/devtools/browser?keep_alive=600000`, {
    method: "POST",
    headers: authHeaders,
  });
  if (!response.ok) throw new Error(`session create failed with status ${response.status}`);
  const body = await response.json();
  const result = body.result ?? body;
  return {
    sessionId: result.sessionId ?? result.id,
    webSocketDebuggerUrl: result.webSocketDebuggerUrl ?? result.webSocketDebuggerURL,
  };
}

async function closeSession(sessionId) {
  const response = await fetch(`${base}/devtools/browser/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: authHeaders,
  });
  console.log(`session ${sessionId} close: ${response.ok ? "ok" : `status ${response.status}`}`);
}

function connect(session) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(session.webSocketDebuggerUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const messageHandlers = [];
    const closeHandlers = [];
    const errorHandlers = [];
    socket.on("message", (raw) => {
      for (const handler of messageHandlers) handler(raw.toString());
    });
    socket.on("close", () => {
      for (const handler of closeHandlers) handler();
    });
    socket.on("error", (error) => {
      for (const handler of errorHandlers) handler(error);
      reject(error);
    });
    socket.on("open", () =>
      resolve({
        send: (payload) => socket.send(payload),
        close: () => socket.close(1000, "smoke complete"),
        onMessage: (handler) => messageHandlers.push(handler),
        onClose: (handler) => closeHandlers.push(handler),
        onError: (handler) => errorHandlers.push(handler),
      }),
    );
  });
}

const adapter = new WebResearchAdapter({
  deps: { createSession, connect, closeSession: async (id) => closeSession(id) },
});

const startedAt = Date.now();
try {
  const result = await adapter.execute({
    capabilityId: WEB_RESEARCH_CAPABILITY_ID,
    missionId: "smoke",
    input: { query: QUERY },
    correlationId: "00000000-0000-0000-0000-000000000000",
    idempotencyKey: "smoke",
  });
  console.log(`elapsed ${Date.now() - startedAt}ms`);
  console.log("summary:", result.summary);
  console.log("provenance:", result.provenance);
  console.log("trust:", result.trust);
  const read = result.output.results.filter((entry) => entry.excerpt !== undefined);
  console.log(`results read: ${read.length} of ${result.output.results.length}`);
  for (const entry of result.output.results) {
    if (entry.error !== undefined) {
      console.log(`  [${entry.error}] ${entry.url}`);
      continue;
    }
    console.log(`  ${new URL(entry.url).host} | ${entry.title}`);
    console.log(`    ${entry.excerpt.slice(0, 160)}`);
  }
  console.log("output bytes:", Buffer.byteLength(JSON.stringify(result.output), "utf8"));
  if (read.length < 2) {
    console.error("smoke expected at least 2 readable results");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`failed after ${Date.now() - startedAt}ms:`, error?.message ?? error);
  process.exitCode = 1;
}
