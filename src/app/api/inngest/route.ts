import { serve } from "inngest/next";
import { inngest } from "@/harness/inngest/client";
import { cardeaFunctions } from "@/harness/inngest/functions";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: cardeaFunctions,
});
