import "server-only";

import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";

const allowedToolkits = ["gmail", "googlecalendar"] as const;

function client() {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  return new Composio({
    apiKey,
    provider: new VercelProvider({ strict: true }),
  });
}

export async function createComposioReadSession(userId: string) {
  const composio = client();
  if (!composio) return { available: false as const, reason: "not_configured" as const };
  const session = await composio.sessions.create(userId, {
    toolkits: [...allowedToolkits],
    tags: ["readOnlyHint"],
    manageConnections: true,
  });
  const [tools, toolkits] = await Promise.all([session.tools(), session.toolkits({ limit: 20 })]);
  return {
    available: true as const,
    sessionId: session.sessionId,
    tools,
    toolkits: toolkits.items.map((toolkit) => ({
      slug: toolkit.slug,
      name: toolkit.name,
      connected: toolkit.connection?.isActive ?? false,
      logo: toolkit.logo,
    })),
  };
}

export async function authorizeComposioToolkit(input: {
  sessionId: string;
  toolkit: (typeof allowedToolkits)[number];
  callbackUrl: string;
}) {
  if (!allowedToolkits.includes(input.toolkit)) throw new Error("Toolkit is not allowed");
  const composio = client();
  if (!composio) return { available: false as const, reason: "not_configured" as const };
  const session = await composio.sessions.use(input.sessionId);
  const request = await session.authorize(input.toolkit, { callbackUrl: input.callbackUrl });
  return { available: true as const, redirectUrl: request.redirectUrl };
}
