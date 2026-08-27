/**
 * The curated celestial codename pool.
 *
 * DESIGN.md locks codenames to a curated Greek/celestial pool, dynamically
 * assigned. The planner model is asked for a codename but its output is NOT
 * trusted for this: models drift into descriptive labels ("Calendar Context")
 * that break the design language and overflow the tab. Assignment here is
 * deterministic per mission, so replays and reloads name nodes identically.
 */
const POOL = [
  "Lyra",
  "Vega",
  "Altair",
  "Rigel",
  "Polaris",
  "Mira",
  "Atlas",
  "Callisto",
  "Europa",
  "Titan",
  "Ceres",
  "Vesta",
  "Juno",
  "Orion",
  "Deneb",
  "Castor",
  "Pollux",
  "Capella",
  "Sirius",
  "Antares",
  "Carina",
  "Phoebe",
  "Tethys",
  "Oberon",
] as const;

/** Small stable string hash; not cryptographic, just a stable seed. */
function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Assigns pool codenames to a node list. The seed rotates the pool so two
 * missions do not always open with the same names, while the same seed
 * always yields the same assignment. Wraps with a numeral suffix only past
 * pool exhaustion (plans are capped far below it).
 */
export function assignCodenames<T extends { codename: string }>(
  nodes: readonly T[],
  seed: string,
): T[] {
  const offset = seedFrom(seed) % POOL.length;
  return nodes.map((node, index) => {
    const name = POOL[(offset + index) % POOL.length];
    const round = Math.floor((offset + index) / POOL.length);
    return { ...node, codename: round > 0 ? `${name} ${round + 1}` : name };
  });
}

export const CODENAME_POOL: readonly string[] = POOL;
