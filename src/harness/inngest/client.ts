import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "cardea",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
