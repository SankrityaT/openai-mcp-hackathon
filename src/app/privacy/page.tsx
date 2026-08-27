import type { Metadata } from "next";
import { LegalShell } from "../_legal/legal-shell";

export const metadata: Metadata = {
  title: "Privacy policy | Cardea",
  description: "What Cardea collects, what it never stores, and how to remove your data.",
};

/**
 * Written to be true, not to look legal. Every claim below is checked against
 * the implementation; if the product changes, this page must change with it.
 */
export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy policy" updated="August 27, 2026">
      <p>
        Cardea is a personal agent workspace built for the OpenAI WebMCP Challenge. This page
        describes what the service collects, what it deliberately never stores, and how to get
        your data removed. It is written plainly because you should be able to read it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          Your email address, if you sign in. Authentication runs on Supabase, either through a
          sign-in link sent to your email or through Google sign-in. From Google sign-in we
          receive only your basic profile: email address, name, and profile photo.
        </li>
        <li>
          Mission content you create: the goals you type, the plans generated for them, the
          resulting work log, and decisions you approve or reject. Goals are sent to OpenAI to
          generate the mission plan.
        </li>
        <li>
          For guest sessions: a session cookie and a hashed network signal used only for abuse
          limits. Guests are never asked for an email or a name.
        </li>
        <li>
          If you connect Gmail or Google Calendar, we store only non-secret connection metadata:
          which service is connected, its Composio account id, and its status.
        </li>
      </ul>

      <h2>What we never store</h2>
      <ul>
        <li>
          Google access or refresh tokens. Connected-service OAuth is handled by Composio, and
          tokens live only there. Our database, logs, and browser code never hold them.
        </li>
        <li>Passwords. Cardea has none, for anyone.</li>
        <li>Payment details. Cardea takes no payments.</li>
      </ul>

      <h2>How connected Google services are used</h2>
      <p>
        Cardea reads from a connected Gmail or Google Calendar account only when a mission you
        started and approved needs it, and shows you what it read as evidence on the canvas. We
        do not import, sync, or archive your mailbox, calendar, or contacts. Consequential
        actions such as sending, spending, or signing always stop for your explicit approval
        first.
      </p>
      <p>
        Cardea&apos;s use of information received from Google APIs adheres to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. Google user data is never sold, never used for
        advertising, and never used to train models.
      </p>

      <h2>Where data lives</h2>
      <p>
        Account and mission data is stored in Supabase (Postgres) with row-level security, so one
        account cannot read another&apos;s data. Mission planning calls the OpenAI API. Durable
        background work runs on Inngest. The site is hosted on Vercel.
      </p>

      <h2>Deletion and contact</h2>
      <p>
        To have your account or data removed, or to ask anything about this policy, open an issue
        on the public repository at{" "}
        <a
          href="https://github.com/SankrityaT/openai-mcp-hackathon/issues"
          target="_blank"
          rel="noreferrer"
        >
          github.com/SankrityaT/openai-mcp-hackathon
        </a>{" "}
        or reply to your sign-in email. Disconnecting Gmail or Calendar from the connected
        services page revokes Cardea&apos;s access immediately.
      </p>

      <h2>Scope</h2>
      <p>
        Cardea is a hackathon submission, not a commercial service. Data may be reset during the
        judging period. If the project continues past the challenge, this policy will be updated
        before anything about the practices above changes.
      </p>
    </LegalShell>
  );
}
