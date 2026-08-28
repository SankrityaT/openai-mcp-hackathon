// Operator smoke test for `cardea.web_lookup`. Nothing calls this
// automatically and no test imports it: it exists so one real round trip
// through Cloudflare Browser Run can be proven from a terminal.
//
//   node --env-file=.env.local src/harness/adapters/web-lookup-smoke.mjs [url]
//
// It creates one real Cloudflare session, opens one page, reads it, and always
// closes the session, including on failure. It prints the adapter's own output
// payload verbatim. It never prints the token.
//
// Mirrors the existing operator script convention in this directory
// (shopify-smoke.mjs). Deliberately a .mjs sitting outside the TypeScript test
// projects, so `pnpm test:*` never picks it up and never reaches the network.
import { WebSocket } from "ws";

const TARGET = process.argv[2] ?? "https://example.com";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = process.env.CLOUDFLARE_BROWSER_TOKEN?.trim();
if (!accountId || !token) {
  console.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_BROWSER_TOKEN must be set.");
  process.exit(1);
}

const { WebLookupAdapter, WEB_LOOKUP_CAPABILITY_ID } = await import(
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
  const response = await fetch(
    `${base}/devtools/browser/${encodeURIComponent(sessionId)}`,
    { method: "DELETE", headers: authHeaders },
  );
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

const adapter = new WebLookupAdapter({
  deps: { createSession, connect, closeSession: async (id) => closeSession(id) },
});

const startedAt = Date.now();
try {
  const result = await adapter.execute({
    capabilityId: WEB_LOOKUP_CAPABILITY_ID,
    missionId: "smoke",
    input: { url: TARGET },
    correlationId: "00000000-0000-0000-0000-000000000000",
    idempotencyKey: "smoke",
  });
  console.log(`elapsed ${Date.now() - startedAt}ms`);
  console.log("summary:", result.summary);
  console.log("provenance:", result.provenance);
  console.log("trust:", result.trust);
  console.log("output:", JSON.stringify(result.output, null, 2));
  console.log("output bytes:", Buffer.byteLength(JSON.stringify(result.output), "utf8"));
} catch (error) {
  console.error(`failed after ${Date.now() - startedAt}ms:`, error?.message ?? error);
  process.exitCode = 1;
}
