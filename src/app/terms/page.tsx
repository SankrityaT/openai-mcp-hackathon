import type { Metadata } from "next";
import { LegalShell } from "../_legal/legal-shell";

export const metadata: Metadata = {
  title: "Terms of service | Cardea",
  description: "The terms for using Cardea, plainly stated.",
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of service" updated="August 27, 2026">
      <p>
        Cardea is a personal agent workspace built for the OpenAI WebMCP Challenge. By using it
        you agree to the terms below. They are short because the service is young; they are
        honest because that is the product&apos;s whole point.
      </p>

      <h2>What Cardea does</h2>
      <p>
        You give Cardea a goal. It plans the work, carries out research and preparation across
        connected services, and shows everything it does on a visible canvas. Anything
        consequential, such as spending, booking, signing, or sending, stops and waits for your
        explicit approval. Cardea never acts invisibly on your behalf.
      </p>

      <h2>Your account and your content</h2>
      <ul>
        <li>You keep all rights to the goals, content, and decisions you put into Cardea.</li>
        <li>
          You are responsible for what you ask Cardea to do. Do not use it for anything unlawful,
          for abuse, or to harm others.
        </li>
        <li>
          Usage is limited by fair quotas: guests get one mission, and signed-in usage is also
          bounded. Attempting to evade quotas may end your access.
        </li>
      </ul>

      <h2>Connected services</h2>
      <p>
        Connecting Gmail or Google Calendar is optional and scoped to your own account. OAuth
        tokens are held by Composio, not by Cardea, and you can disconnect at any time from the
        connected services page. Your use of connected services remains governed by their own
        terms.
      </p>

      <h2>Honesty of the interface</h2>
      <p>
        Cardea labels what is live, what is a capture, and what is not persisted. It does not
        fabricate activity, evidence, or confidence. If something in the interface seems to
        overstate what happened, that is a bug: please report it.
      </p>

      <h2>No warranty</h2>
      <p>
        Cardea is provided as is, without warranties of any kind, during an active competition.
        It may be unavailable, rate limited, or reset. To the maximum extent permitted by law,
        the creators are not liable for damages arising from its use. Do not rely on Cardea as
        the only system of record for anything important.
      </p>

      <h2>Changes and contact</h2>
      <p>
        These terms may change as the project matures; the date above always reflects the current
        version. Questions and reports go to the public repository at{" "}
        <a
          href="https://github.com/SankrityaT/openai-mcp-hackathon/issues"
          target="_blank"
          rel="noreferrer"
        >
          github.com/SankrityaT/openai-mcp-hackathon
        </a>
        . The source is open under the repository&apos;s license.
      </p>
    </LegalShell>
  );
}
