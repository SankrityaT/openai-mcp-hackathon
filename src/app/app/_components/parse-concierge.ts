/**
 * Parses the buying brief's concierge shape out of the worker's recorded
 * deliverable: the spoken first line, the machine-readable Option lines, and
 * everything from "The receipts" on. Pure and tolerant: a brief without
 * Option lines parses to an empty options array, and the first url found
 * anywhere remains available as a fallback open target. Nothing here ever
 * invents content; it only slices the recorded text.
 */

export type ConciergeOption = { label: string; url: string };

export type ConciergeBrief = {
  /** Cardea's spoken line, verbatim from the deliverable's first line. */
  spoken: string;
  /** Parsed Option lines, in recorded order (top pick first). */
  options: ConciergeOption[];
  /** The receipts section onward, verbatim; empty when absent. */
  receipts: string;
  /** First url anywhere in the text, for briefs without Option lines. */
  fallbackUrl: string | null;
};

const URL_SHAPE = /^https?:\/\//;
const OPTION_LINE = /^Option:\s*(.+?)\s*\|\s*(\S+)\s*$/;
const MAX_OPTIONS = 3;
const MAX_LABEL_CHARS = 80;

export function parseConcierge(text: string): ConciergeBrief {
  const lines = text.split("\n");
  const spoken = lines.find((line) => line.trim().length > 0)?.trim() ?? "";

  const options: ConciergeOption[] = [];
  for (const line of lines) {
    if (options.length >= MAX_OPTIONS) break;
    const match = OPTION_LINE.exec(line.trim());
    if (!match) continue;
    const label = match[1].slice(0, MAX_LABEL_CHARS);
    const url = match[2];
    if (!URL_SHAPE.test(url)) continue;
    options.push({ label, url });
  }

  const receiptsIndex = text.search(/^\s*The receipts\s*$/im);
  const receipts = receiptsIndex >= 0 ? text.slice(receiptsIndex).trim() : "";

  const fallbackUrl = text.match(/https?:\/\/[^\s)\]]+/)?.[0] ?? null;

  return { spoken, options, receipts, fallbackUrl };
}
