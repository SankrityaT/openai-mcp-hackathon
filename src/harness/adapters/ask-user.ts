// Note: no `import "server-only"` here — see harness/planner.ts for why (the
// package is not an installed dependency and plain `node --test` cannot
// resolve Next's bundler-only alias). Nothing in this module reaches a
// credential, a socket, or a provider: asking the person is entirely local.
//
// Relative (not `@/...`-aliased) *value* imports for the same reason as
// execute-node.ts: the alias is a compile-time aid only and is not rewritten
// in the emitted CommonJS that `pnpm test:harness` runs.
import type { JsonValue } from "@/core/contracts/types";
import {
  ASK_USER_CAPABILITY_ID,
  ASK_USER_ORIGIN,
} from "../../core/contracts/safe-capabilities";
import type {
  CapabilityAdapter,
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
  NormalizedCapability,
} from "../contracts";

export { ASK_USER_CAPABILITY_ID, ASK_USER_ORIGIN };

/**
 * `cardea.ask_user`: the mission stops and asks the person one concrete
 * preference question, with the options a plan can actually branch on.
 *
 * This is the capability that lets a mission stop guessing. Taste, budget
 * shape, and "which of these directions" are not facts the web holds and not
 * things a model may invent on someone's behalf; they are the person's, and a
 * furnishing or gifting or wardrobe mission that fabricates them produces a
 * confident brief about a life nobody described.
 *
 * It is deliberately NOT executed through the capability registry. There is no
 * function here to run: the question is raised as an approval, the node pauses
 * on the board exactly the way an approval-gated write pauses, and the answer
 * arrives when the person settles it. `execute` therefore refuses rather than
 * inventing an answer (see `AskUserNotExecutableError`), and `runExecuteNode`
 * owns the whole flow.
 *
 * Trust design, and it is the inverse of the web capabilities': the descriptor
 * is "derived" (Cardea's own asking surface), and the evidence it produces is
 * "trusted", because the person said it themselves. Nothing else in the
 * harness earns that label.
 */

/** The question, as it is displayed. Longer than this is not a question. */
export const MAX_ASK_QUESTION_CHARS = 200;

/** One option, as it is displayed on the card. */
export const MAX_ASK_OPTION_CHARS = 60;

/**
 * Two options is the smallest real choice; four is where a choice starts
 * becoming a survey. The bound is the consideration-set finding in
 * docs/PURCHASE_PSYCHOLOGY.md applied to the question itself.
 */
export const MIN_ASK_OPTIONS = 2;
export const MAX_ASK_OPTIONS = 4;

/** A typed answer. Bounded because it becomes recorded node output. */
export const MAX_ASK_ANSWER_CHARS = 400;

/** Upper bound on the summary line, which is a UI string. */
const MAX_SUMMARY_CHARS = 160;

/** Where the recorded answer came from: the person, through Cardea's board. */
export const ASK_USER_PROVENANCE = "ask://cardea/person";

/** Invalid input: an unusable question is the caller's mistake, not a failure. */
export class AskUserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AskUserInputError";
  }
}

/**
 * Raised if anything ever routes this capability through `registry.execute`.
 * There is no answer to return without the person, and returning one anyway
 * is exactly the fabrication this capability exists to prevent.
 */
export class AskUserNotExecutableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AskUserNotExecutableError";
  }
}

/** One validated question: what is asked, what may be picked, what is suggested. */
export type AskUserRequest = {
  question: string;
  options: string[];
  /** Always one of `options`: the suggestion Accept takes. */
  recommended: string;
};

/** Collapses runs of whitespace so a bound measures the displayed length. */
function flatten(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Reads the question out of the capability input, in either shape a plan can
 * carry.
 *
 * The planner's structured output carries one FLAT primitive per capability
 * (see the schema note in planner.ts), so a real plan expresses this input as
 * the JSON-encoded object the schema note names as the escape hatch for nested
 * input. The already-decoded object is accepted too, for a caller that can
 * express one.
 */
export function readAskUserInput(input: JsonValue): AskUserRequest {
  let record: Record<string, JsonValue> | null = null;
  if (typeof input === "string") {
    let decoded: unknown;
    try {
      decoded = JSON.parse(input);
    } catch {
      throw new AskUserInputError(
        "ask_user needs a JSON object with a question and 2 to 4 options",
      );
    }
    if (typeof decoded === "object" && decoded !== null && !Array.isArray(decoded)) {
      record = decoded as Record<string, JsonValue>;
    }
  } else if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    record = input as Record<string, JsonValue>;
  }
  if (record === null) {
    throw new AskUserInputError("ask_user needs a question and 2 to 4 options");
  }

  if (typeof record.question !== "string") {
    throw new AskUserInputError("ask_user needs a question string");
  }
  const question = flatten(record.question);
  if (question.length === 0) {
    throw new AskUserInputError("ask_user needs a non-empty question");
  }
  if (question.length > MAX_ASK_QUESTION_CHARS) {
    throw new AskUserInputError(
      `ask_user question exceeds ${MAX_ASK_QUESTION_CHARS} characters`,
    );
  }

  if (!Array.isArray(record.options)) {
    throw new AskUserInputError("ask_user needs an options array");
  }
  const options: string[] = [];
  const seen = new Set<string>();
  for (const raw of record.options) {
    if (typeof raw !== "string") {
      throw new AskUserInputError("every ask_user option must be a string");
    }
    const option = flatten(raw);
    if (option.length === 0) continue;
    if (option.length > MAX_ASK_OPTION_CHARS) {
      throw new AskUserInputError(
        `ask_user options must each be ${MAX_ASK_OPTION_CHARS} characters or fewer`,
      );
    }
    // Two spellings of the same option is not a choice. Dropped rather than
    // refused: the remaining options are still a real question, and the count
    // check below is what decides whether enough of them survived.
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(option);
  }
  if (options.length < MIN_ASK_OPTIONS || options.length > MAX_ASK_OPTIONS) {
    throw new AskUserInputError(
      `ask_user needs between ${MIN_ASK_OPTIONS} and ${MAX_ASK_OPTIONS} distinct options`,
    );
  }

  // A recommendation that does not name one of the options is a model slip,
  // not a reason to abandon the question: the options are the truth, so the
  // suggestion falls back to the first one rather than inventing a choice the
  // person was never offered.
  const suggested = typeof record.recommended === "string" ? flatten(record.recommended) : "";
  const matched = options.find((option) => option.toLowerCase() === suggested.toLowerCase());

  return { question, options, recommended: matched ?? options[0] };
}

/**
 * The two strings the approval card renders: its one prominent line, and the
 * hinge line beneath the options.
 *
 * The card has exactly one prominent text slot (`recommendation`), so the
 * question and the suggested option share it. Putting the bare option there
 * would show the person an answer with no question attached.
 */
export function askUserApprovalCopy(ask: AskUserRequest): {
  recommendation: string;
  consequence: string;
} {
  return {
    recommendation: `${ask.question} Suggested: ${ask.recommended}`,
    consequence:
      "Accept takes the suggested answer. Modify lets you write your own. The mission waits here until you answer, and nothing leaves Cardea either way.",
  };
}

/**
 * The answer, read off the settled approval.
 *
 * Modify carries the person's own words in `resolution.note`, and those words
 * ARE the answer: a preference question has no wrong answer to reject, so free
 * text is a first-class response rather than a correction. Accept carries no
 * note, and means the suggestion.
 *
 * The approval row records `status` and `resolution` but not the decision verb
 * (see resolve_mission_approval in
 * supabase/migrations/20260826000200_transactions_and_guards.sql), so the note
 * is the signal, which is exactly what the two decisions differ by.
 */
export function askUserAnswer(ask: AskUserRequest, resolution: JsonValue | null): string {
  if (typeof resolution === "object" && resolution !== null && !Array.isArray(resolution)) {
    const note = (resolution as Record<string, JsonValue>).note;
    if (typeof note === "string") {
      const written = flatten(note);
      if (written.length > 0) return written.slice(0, MAX_ASK_ANSWER_CHARS);
    }
  }
  return ask.recommended;
}

/** `answered: walnut mid-century`. Bounded to a UI-safe length. */
export function askUserSummary(answer: string): string {
  return `answered: ${answer}`.slice(0, MAX_SUMMARY_CHARS);
}

const ASK_DESCRIPTION = [
  "Asks the person one concrete preference question with 2 to 4 short options and waits for their answer.",
  "Plan it BEFORE any step whose work depends on taste, budget shape, or a choice among directions, and make those steps depend on it.",
  "Downstream steps receive the answer as recorded evidence, so they work from what the person actually said instead of a guess.",
  'Give it its input as a JSON string, for example {"question":"which style do you want?","options":["walnut mid-century","white minimal","industrial"],"recommended":"walnut mid-century"}.',
  "Ask one thing only, keep every option under 60 characters, and make the options real alternatives the plan can branch on.",
  "It reaches no account and no website. It costs nothing but the person's attention, and the mission pauses until they answer.",
].join(" ");

export class AskUserAdapter implements CapabilityAdapter {
  // Distinct registry key: the registry keys adapters by provider and throws
  // on duplicates, and "cardea" and "cardea-research" are the two browser
  // adapters' keys.
  readonly provider = "cardea-ask";

  /**
   * Always advertised. Unlike the browser capabilities there is nothing to
   * configure and nothing that can be unavailable: the person is already here.
   */
  async discover(): Promise<NormalizedCapability[]> {
    return [
      {
        id: ASK_USER_CAPABILITY_ID,
        provider: this.provider,
        name: ASK_USER_CAPABILITY_ID,
        description: ASK_DESCRIPTION,
        inputSchema: {
          type: "object",
          properties: {
            question: { type: "string", maxLength: MAX_ASK_QUESTION_CHARS },
            options: {
              type: "array",
              minItems: MIN_ASK_OPTIONS,
              maxItems: MAX_ASK_OPTIONS,
              items: { type: "string", maxLength: MAX_ASK_OPTION_CHARS },
            },
            recommended: { type: "string", maxLength: MAX_ASK_OPTION_CHARS },
          },
          required: ["question", "options"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {
            question: { type: "string" },
            answer: { type: "string" },
          },
        },
        risk: { level: "low", categories: ["read"] },
        // "derived" is the descriptor: the asking surface is Cardea's own. The
        // answer it records is "trusted", and that is not a contradiction —
        // the person said it themselves, which no other evidence in the
        // harness can claim.
        trust: { level: "derived", origin: ASK_USER_ORIGIN, provenance: "cardea:ask_user" },
        readOnly: true,
      },
    ];
  }

  /**
   * Never called. `runExecuteNode` recognizes this capability before it
   * reaches the registry and raises an approval instead, because the answer
   * belongs to the person and cannot be produced here. Refusing loudly is the
   * point: a silent placeholder would be a fabricated preference.
   */
  async execute(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult> {
    throw new AskUserNotExecutableError(
      `${request.capabilityId} is answered by the person through an approval, not by a tool call`,
    );
  }
}

export const askUserAdapter = new AskUserAdapter();
