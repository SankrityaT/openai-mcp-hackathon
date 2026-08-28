import { serve } from "inngest/next";
import { inngest } from "@/harness/inngest/client";
import { cardeaFunctions } from "@/harness/inngest/functions";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: cardeaFunctions,
  // Registrations must advertise the public alias. Left to its default the
  // SDK self-reports Vercel's deployment-specific URL, which Deployment
  // Protection walls off behind SSO, so Inngest could register the app but
  // never invoke a function on it.
  ...(process.env.INNGEST_SERVE_HOST ? { serveHost: process.env.INNGEST_SERVE_HOST } : {}),
});
