/**
 * The one email Cardea is allowed to send, and the transport that sends it.
 *
 * Cardea emails a person for exactly one reason: a mission has stopped at a
 * hinge and cannot go further without their judgment. The message therefore
 * states the decision itself. `DESIGN.md` forbids generic "Cardea needs
 * attention" copy, so every line below is built from the real approval
 * content, and this module offers no way to send anything else.
 *
 * No SDK: Resend's API is a plain HTTPS POST, so this is a `fetch` call and
 * nothing more. Nothing here logs a recipient address, an API key, or a
 * message body.
 *
 * Like `credentials.ts` this module deliberately does not import
 * `server-only`, so the composer stays unit-testable under plain
 * `node --test`.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 5_000;

/** Per-line ceiling. The human ceiling is far below any provider limit. */
const MAX_LINE_LENGTH = 200;
const MAX_SUBJECT_LENGTH = 120;

const CLOSING_LINE = "Approve or modify on the board.";

/**
 * Resend's shared sandbox sender. It needs no DNS and no verified domain,
 * which is what makes a first run possible; it can only deliver to the Resend
 * account owner's own address until a domain is verified.
 */
const DEFAULT_FROM = "Cardea <onboarding@resend.dev>";

export type ApprovalEmailFailureReason = "not_configured" | "invalid_input" | "failed";

export type ApprovalEmailResult =
  | { sent: true }
  | { sent: false; reason: ApprovalEmailFailureReason };

export function getResendApiKey(): string | null {
  const key = process.env.RESEND_API_KEY;
  return typeof key === "string" && key.length > 0 ? key : null;
}

export function getNotifyEmailFrom(): string {
  const from = process.env.NOTIFY_EMAIL_FROM?.trim();
  return from && from.length > 0 ? from : DEFAULT_FROM;
}

/** Collapses whitespace and bounds a line so one long field cannot swallow the rest. */
function boundedLine(value: unknown, limit: number = MAX_LINE_LENGTH): string {
  if (typeof value !== "string") return "";
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

export type ApprovalEmailInput = {
  recommendation: string;
  consequence: string;
  codename: string;
  boardUrl: string;
};

export type ApprovalEmailContent = { subject: string; text: string };

/**
 * Builds the subject and the plain-text body from the approval's own
 * recommendation and consequence, so the person can decide from the inbox
 * preview alone without opening anything.
 *
 * Subject: the decision, prefixed so it is recognisable in a crowded inbox.
 * Body line one: the decision again, in full. Line two: what it costs or
 * causes. Line three: where to act. Then the board link on its own line.
 *
 * The codename is only ever a fallback for the pathological case of an
 * approval with no recommendation text, and even then the line names the
 * agent that stopped rather than saying nothing.
 */
export function composeApprovalEmail(input: ApprovalEmailInput): ApprovalEmailContent {
  const codename = boundedLine(input.codename, 60);
  const recommendation =
    boundedLine(input.recommendation) ||
    (codename ? `${codename} is waiting on a decision.` : "A mission is waiting on a decision.");
  const consequence = boundedLine(input.consequence);

  const subject = boundedLine(`Cardea: ${recommendation}`, MAX_SUBJECT_LENGTH);
  const body = [recommendation, consequence, CLOSING_LINE].filter((line) => line.length > 0);
  const boardUrl = boundedLine(input.boardUrl, 400);
  if (boardUrl.length > 0) body.push(boardUrl);

  return { subject, text: body.join("\n") };
}

function isPlausibleAddress(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

/**
 * Sends one plain-text email through Resend.
 *
 * The body is sent as `text` only, never HTML: mission content that happens
 * to contain markup is delivered literally and can neither break the message
 * nor smuggle a link past the reader.
 *
 * Failure is a return value, never an exception and never a log line. One
 * retry covers a transient network blip; anything past that is reported to
 * the caller, which is a fire-and-forget notifier that must not care.
 */
export async function sendApprovalEmail(
  to: string,
  content: ApprovalEmailContent,
): Promise<ApprovalEmailResult> {
  const apiKey = getResendApiKey();
  if (!apiKey) return { sent: false, reason: "not_configured" };
  if (!isPlausibleAddress(to)) return { sent: false, reason: "invalid_input" };
  if (content.subject.length === 0 || content.text.length === 0) {
    return { sent: false, reason: "invalid_input" };
  }

  const payload = {
    from: getNotifyEmailFrom(),
    to: [to],
    subject: content.subject,
    text: content.text,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return { sent: true };
      // 4xx is a permanent refusal (unverified sender, rejected recipient):
      // retrying it only burns time inside a background function.
      if (response.status < 500) return { sent: false, reason: "failed" };
    } catch {
      // Timeout or transport error. Fall through to the single retry.
    }
  }
  return { sent: false, reason: "failed" };
}
