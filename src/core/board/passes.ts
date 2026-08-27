/**
 * The five starter context passes and the money arithmetic behind them.
 *
 * A pass is a context/authority deck entry, not a payment card: it names the
 * memory, the connected apps, and the boundary a mission is allowed to work
 * inside. The optional spending boundary is the one part of a pass that is a
 * number, so it lives here as pure, testable arithmetic rather than inside a
 * component.
 *
 * Amounts are held in micro-units (1 USD = 1_000_000) everywhere they are
 * stored or transmitted, because binary floating point cannot represent cents
 * exactly and a spending boundary is not a place to lose a penny. Only the
 * display helpers speak in dollars.
 *
 * Kept free of React and free of the filesystem, so the ids, the clamp, and
 * the formatting can be asserted directly.
 */

export type PassDomain = "personal" | "work" | "home" | "shopping" | "travel";

export type StarterPass = {
  id: string;
  domain: PassDomain;
  label: string;
  art: string;
  description: string;
};

/** Upper bound on a single pass boundary, in USD. */
export const MAX_PASS_AMOUNT_USD = 10_000;

/** Micro-units in one USD. */
export const MICROUNITS_PER_USD = 1_000_000;

/**
 * Fixed ids. These are stable identifiers, not values generated per session: a
 * pass id is written into stored wallet state and will later key server-side
 * authority records, so regenerating them would orphan every saved selection.
 */
export const STARTER_PASSES: readonly StarterPass[] = [
  {
    id: "5f8a2c14-3d6b-4a9e-9c71-2e0b7d4f16a3",
    domain: "personal",
    label: "Personal",
    art: "/images/cardea/passes/personal.webp",
    description:
      "Carries your private memory, the people you know, and the errands you run under your own name.",
  },
  {
    id: "b1c47e08-9a52-4f3d-8e6a-71c9d2035b84",
    domain: "work",
    label: "Work",
    art: "/images/cardea/passes/work.webp",
    description:
      "Carries your role, your working calendar, and the authority a job related mission may use.",
  },
  {
    id: "3e2d9f61-47c8-4b05-a9d3-6f81b0e75c22",
    domain: "home",
    label: "Home",
    art: "/images/cardea/passes/home.webp",
    description:
      "Carries your address, the rooms and furniture in it, and anything scheduled to arrive there.",
  },
  {
    id: "c86b41d7-20fa-4e19-b7c5-93d8a6210fe4",
    domain: "shopping",
    label: "Shopping",
    art: "/images/cardea/passes/shopping.webp",
    description:
      "Carries the stores, sizes, and saved preferences a purchase uses, plus the amount it may reach.",
  },
  {
    id: "7a45d3b9-6e10-4c82-8f0d-15b3e9c47a6d",
    domain: "travel",
    label: "Travel",
    art: "/images/cardea/passes/travel.webp",
    description:
      "Carries your trips, your travel documents, and the preferences used to book and move between places.",
  },
];

/**
 * Convert a dollar amount to the stored integer.
 *
 * Anything that is not a usable number reads as zero rather than throwing: the
 * input is a text field, and an unloaded pass is a legitimate resting state.
 * The result is exact because cents are converted as integers, so accumulated
 * binary fraction error never reaches the stored boundary.
 */
export function toBudgetMicrounits(amountUsd: number): number {
  if (!Number.isFinite(amountUsd)) return 0;
  const clamped = Math.min(MAX_PASS_AMOUNT_USD, Math.max(0, amountUsd));
  const cents = Math.round(clamped * 100);
  return cents * (MICROUNITS_PER_USD / 100);
}

/**
 * Display form of a pass boundary. Rounded and clamped through the same path
 * as the stored value, so the number a person reads is always the number a
 * mission would be held to. Whole dollars drop the cents, because a boundary
 * of fifty dollars is no more precise for being written with two zeroes.
 */
export function formatPassAmount(amountUsd: number): string {
  const stored = toBudgetMicrounits(amountUsd);
  // Cents are all-or-nothing: a boundary with cents shows both digits, so
  // "$1,250.50" never reads as "$1,250.5" and gets misheard as five cents.
  const hasCents = stored % MICROUNITS_PER_USD !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(stored / MICROUNITS_PER_USD);
}

export function passById(id: string): StarterPass | null {
  return STARTER_PASSES.find((pass) => pass.id === id) ?? null;
}
