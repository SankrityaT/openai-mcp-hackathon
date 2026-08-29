import Image from "next/image";

/**
 * Hand-built landing vignettes.
 *
 * Each one is a miniature of a real Cardea surface, drawn with the same
 * anatomy the product renders (memory notes, wallet passes, approval
 * trail, integrations), never a generated or doctored screenshot. The engine
 * and mandate proof is stronger still: src/components/landing/product-demos.tsx
 * mounts the REAL app components there.
 * DESIGN.md's rule is that product proof must be real components; until the
 * screen recordings exist, these miniatures are that proof, and every string
 * in them comes from missions that actually ran or from the product's own
 * fixture content.
 *
 * All static markup: no client JS, no fake interactivity. Controls that look
 * like buttons inside a vignette are deliberately inert divs, because a
 * marketing miniature must never pretend to be the live product.
 */

/**
 * The prompt that opened a real mission, typed the way the person typed it.
 * The span is the typewriter: its max-width animates in steps under
 * `prefers-reduced-motion: no-preference`; otherwise it just sits there.
 */
export function PromptChip({ children }: { children: string }) {
  return (
    <p className="vignette-prompt">
      <span className="vignette-prompt__text">{children}</span>
    </p>
  );
}




/** Memory notes exactly as the canvas shows them: source, influence, controls. */
export function MemoryVignette() {
  return (
    <div className="vig-memory" aria-hidden="true">
      <div className="vig-note vig-note--tilt">
        <p>Prefers walnut mid-century over white minimal.</p>
        <span className="vig-note__source">From the apartment mission, answered by you</span>
        <span className="vig-note__controls">Edit · Forget</span>
      </div>
      <div className="vig-note">
        <p>Dinner parties usually seat six.</p>
        <span className="vig-note__source">From the dinner mission</span>
        <span className="vig-note__controls">Edit · Forget</span>
      </div>
      <div className="vig-remember">
        <Image src="/images/cardea/logo-mark.png" alt="" width={22} height={22} />
        <span>remember you like queen beds?</span>
        <em>Keep it</em>
      </div>
    </div>
  );
}


/** The context wallet as it exists: tactile passes, fanned like a hand of cards. */
export function WalletVignette() {
  const passes = ["shopping", "home", "personal"] as const;
  return (
    <div className="vig-wallet" aria-hidden="true">
      {passes.map((pass, index) => (
        <Image
          key={pass}
          className={`vig-wallet__pass vig-wallet__pass--${index}`}
          src={`/images/cardea/passes/${pass}.webp`}
          alt=""
          width={310}
          height={195}
        />
      ))}
    </div>
  );
}

/** The approval trail: consequential actions and where each one stopped. */
export function ReceiptsVignette() {
  const rows = [
    { action: "Search the live web", state: "Ran freely", tone: "free" },
    { action: "Prepare the cart", state: "Stopped for you", tone: "hinge" },
    { action: "Draft the email", state: "Stopped for you", tone: "hinge" },
    { action: "Send anything", state: "Never on its own", tone: "never" },
  ] as const;
  return (
    <div className="vig-receipts" aria-hidden="true">
      {rows.map((row) => (
        <div key={row.action} className="vig-receipts__row">
          <span>{row.action}</span>
          <em data-tone={row.tone}>{row.state}</em>
        </div>
      ))}
    </div>
  );
}

/** Connected services orbiting the Cardea mark. Real integrations only. */
export function ConstellationVignette() {
  const marks = ["composio", "supermemory", "chrome", "openai"] as const;
  return (
    <div className="vig-orbit" aria-hidden="true">
      <span className="vig-orbit__ring" />
      <Image className="vig-orbit__core" src="/images/cardea/logo-mark.png" alt="" width={54} height={54} />
      {marks.map((mark, index) => (
        <Image
          key={mark}
          className={`vig-orbit__mark vig-orbit__mark--${index}`}
          src={`/images/stack/${mark}.png`}
          alt=""
          width={38}
          height={38}
        />
      ))}
    </div>
  );
}
