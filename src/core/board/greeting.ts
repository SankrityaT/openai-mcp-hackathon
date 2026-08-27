/**
 * Time-of-day salutation for the board's resting state.
 *
 * Deliberately does not invent a name: when no display name is known the
 * greeting stands alone rather than addressing the person as something they
 * never told us.
 */
export type Salutation = { greeting: string; name: string | null };

export function saluteFor(date: Date, displayName?: string | null): Salutation {
  const hour = date.getHours();
  const greeting =
    hour < 5 ? "Late night" : hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

  const name = typeof displayName === "string" ? displayName.trim() : "";
  return { greeting, name: name.length > 0 ? name : null };
}

export function formatSalutation(salutation: Salutation) {
  return salutation.name ? `${salutation.greeting}, ${salutation.name}` : salutation.greeting;
}
