import Image from "next/image";
import {
  ApprovalDemo,
  ConnectionStateButton,
  ContextWalletDemo,
  MissionCanvasPreview,
  StartMissionDemo,
  TakeoverPreview,
  ThemeToggle,
} from "@/components/landing/client-demos";
import { ArrowIcon, ButtonLink, DemoBadge, LogoMark, StatusDot } from "@/components/ui/primitives";

const useCases = [
  {
    number: "01",
    title: "Coordinate a life transition",
    copy: "Keep housing, travel, moving, utilities, and a first week aligned as the plan changes.",
  },
  {
    number: "02",
    title: "Launch a microbusiness",
    copy: "Research suppliers, prepare a storefront, and hold every publish or spend action for approval.",
  },
  {
    number: "03",
    title: "Execute a complex purchase",
    copy: "Compare sources and constraints across services, then decide with evidence in view.",
  },
];

const workingStack = [
  { name: "OpenAI", role: "Agent runtime", href: "https://openai.com/" },
  { name: "Chrome", role: "WebMCP browser", href: "https://developer.chrome.com/docs/ai/webmcp" },
  { name: "Vercel", role: "Deployment", href: "https://vercel.com/" },
  { name: "Supabase", role: "Auth + mission state", href: "https://supabase.com/" },
  { name: "Inngest", role: "Durable orchestration", href: "https://www.inngest.com/" },
  { name: "Composio", role: "Connected apps", href: "https://composio.dev/" },
  { name: "supermemory", role: "Long-term memory", href: "https://supermemory.ai/" },
] as const;

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <a href="#top" className="brand" aria-label="Cardea home">
          <LogoMark />
          <span>Cardea</span>
        </a>
        <nav className="primary-nav" aria-label="Primary navigation">
          <a href="/canvas">Canvas</a>
          <a href="#use-cases">Use cases</a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <div className="header-actions">
          <a href="#canvas" className="header-link">Watch demo</a>
          <ButtonLink href="/canvas" tone="primary" className="header-cta">Start a Canvas</ButtonLink>
          <ThemeToggle />
        </div>
      </header>

      <main id="main-content">
        <section className="hero" id="top" aria-labelledby="hero-title">
          <picture className="hero-atmosphere hero-atmosphere--light">
            <source media="(max-width: 820px)" srcSet="/images/cardea/hero-stage-mobile.webp" />
            {/* A picture element keeps the monumental lower plate responsive without loading both crops. */}
            <img src="/images/cardea/hero-stage-desktop.webp" alt="" width="2200" height="1231" fetchPriority="high" />
          </picture>
          <picture className="hero-atmosphere hero-atmosphere--dark">
            <source media="(max-width: 820px)" srcSet="/images/cardea/hero-stage-mobile-dark.webp" />
            {/* A hand-authored dark plate, not a filtered copy of the light artwork. */}
            <img src="/images/cardea/hero-stage-desktop-dark.webp" alt="" width="2200" height="1238" />
          </picture>
          <div className="hero-copy page-grid">
            <div className="hero-copy__inner">
              <h1 id="hero-title" aria-label="Turn Any Goal Into a Living Workspace">
                <span className="hero-heading hero-heading--desktop" aria-hidden="true">
                  Turn Any Goal Into<br />a Living Workspace
                </span>
                <span className="hero-heading hero-heading--mobile" aria-hidden="true">
                  Turn Any Goal<br />Into a Living<br />Workspace
                </span>
              </h1>
              <p className="hero-subhead">
                Cardea plans, browses, researches, and acts across the web while you watch, steer, and approve the work in real time.
              </p>
              <div className="hero-actions">
                <ButtonLink href="/canvas" tone="primary" className="hero-primary hero-primary--pill">Enter Cardea <ArrowIcon /></ButtonLink>
              </div>
            </div>
          </div>
          <span id="canvas" className="hero-canvas-anchor" aria-hidden="true" />
        </section>

        <section className="promise-section page-grid" aria-labelledby="promise-title">
          <div className="section-kicker">
            <span className="pixel-label">Prompt → mission canvas</span>
            <span>One goal, kept alive</span>
          </div>
          <div className="promise-layout">
            <h2 id="promise-title">The prompt is only the threshold.</h2>
            <div className="promise-copy">
              <p>
                Chat captures what you want. Cardea turns it into a spatial mission where parallel work, dependencies, evidence, and judgment stay visible.
              </p>
              <p>
                When the world changes, the workspace changes with it. You can see what moved, why it moved, and what still needs you.
              </p>
            </div>
          </div>
        </section>

        <section className="mechanism-section" id="how-it-works" aria-labelledby="mechanism-title">
          <Image
            src="/images/cardea/mechanism.webp"
            alt="A classical threshold branching into connected spaces, with paths that change direction"
            fill
            sizes="100vw"
            className="mechanism-atmosphere"
          />
          <div className="mechanism-overlay page-grid">
            <div className="mechanism-copy">
              <p className="section-eyebrow">One mission, many dependent worlds</p>
              <h2 id="mechanism-title">A move is never just a move.</h2>
              <p>
                Housing changes travel. Travel changes delivery. Delivery changes utilities, budget, and the first week. Cardea keeps those relationships in view and replans them together.
              </p>
            </div>
            <div className="mechanism-demo-wrap">
              <MissionCanvasPreview detailed />
            </div>
          </div>
        </section>

        <section className="authority-section page-grid" aria-labelledby="authority-title">
          <div className="authority-heading">
            <p className="section-eyebrow">Coordination belongs to Cardea. Judgment belongs to you.</p>
            <h2 id="authority-title">Cardea pauses at the hinge.</h2>
          </div>
          <div className="authority-stage">
            <Image
              src="/images/cardea/authority.webp"
              alt="A classical figure pauses with her hand beside the coral hinge of a partly open doorway"
              fill
              sizes="(max-width: 800px) 100vw, 54vw"
              className="authority-image"
            />
            <div className="authority-ui">
              <ApprovalDemo />
            </div>
          </div>
          <div className="takeover-intro">
            <div>
              <p className="section-eyebrow">Visible control boundary</p>
              <h3>Watch the work. Take over when you want.</h3>
            </div>
            <p>
              Browser work expands from its place on the canvas. Cardea shows activity and evidence beside the page, then pauses its input the moment you take control.
            </p>
          </div>
          <TakeoverPreview />
        </section>

        <section className="memory-section" aria-labelledby="memory-title">
          <Image
            src="/images/cardea/memory.webp"
            alt="A tactile archive of cards, fabric, notes, and a small classical threshold"
            fill
            sizes="100vw"
            className="memory-atmosphere"
          />
          <div className="memory-overlay page-grid">
            <div className="memory-copy">
              <p className="section-eyebrow">Context with the doors left open</p>
              <h2 id="memory-title">Choose what Cardea carries forward.</h2>
              <p>
                Context cards collect the details a mission may need. You confirm which cards enter, and every memory note stays visible, editable, and removable.
              </p>
            </div>
            <ContextWalletDemo />
          </div>
        </section>

        <section className="live-web-section page-grid" id="live-web-work" aria-labelledby="live-web-title">
          <div className="live-web-heading">
            <div>
              <p className="section-eyebrow">Live web work, visible in place</p>
              <h2 id="live-web-title">A browser is part of the mission, not a hidden side effect.</h2>
            </div>
            <p>
              Sources, browser state, permission pauses, and prepared actions remain inspectable. Connected services appear only after a mission authorizes them.
            </p>
          </div>
          <div className="web-proof">
            <article className="browser-proof browser-proof--listing">
              <div className="browser-proof__chrome"><span /><span /><span /><b>housing source · demo fixture</b></div>
              <div className="listing-preview" aria-label="Demo rental listing preview">
                <div className="listing-preview__image"><span>2nd floor</span></div>
                <div className="listing-preview__copy">
                  <p className="pixel-label">Evidence 04</p>
                  <h3>Clementina apartment</h3>
                  <p>South-facing windows · 24 minute transit estimate</p>
                  <a href="#authority-title">Open approval evidence</a>
                </div>
              </div>
            </article>
            <article className="browser-proof browser-proof--services">
              <div className="service-proof__head"><span>Connected work</span><DemoBadge /></div>
              <div className="service-row">
                <span className="service-mark service-mark--mail">M</span>
                <span><b>Mail context</b><small>Available only after authorization</small></span>
                <ConnectionStateButton />
              </div>
              <div className="service-row">
                <span className="service-mark service-mark--calendar">31</span>
                <span><b>Calendar context</b><small>Used to protect the first workday</small></span>
                <ConnectionStateButton />
              </div>
              <div className="service-row">
                <span className="service-mark service-mark--cart">◇</span>
                <span><b>Cart preparation</b><small>Purchase remains a hard stop</small></span>
                <span className="hard-stop"><StatusDot tone="coral" /> Approval</span>
              </div>
              <p className="service-disclosure">
                These rows demonstrate the interface boundary. They do not claim a live connection in this build.
              </p>
            </article>
          </div>
        </section>

        <section className="stack-section" aria-labelledby="stack-title">
          <div className="page-grid stack-section__inner">
            <div className="stack-section__intro">
              <p className="section-eyebrow">Cardea&apos;s working stack</p>
              <h2 id="stack-title">Built across the open web.</h2>
              <p>
                WebMCP is the public doorway. These systems provide the browser, deployment, durable work, connected apps, and memory behind it.
              </p>
            </div>
            <div className="stack-logos" aria-label="Technology companies used by Cardea">
              {workingStack.map((company) => (
                <a
                  className={`stack-logo stack-logo--${company.name.toLowerCase()}`}
                  href={company.href}
                  key={company.name}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${company.name}, ${company.role}`}
                >
                  <span className="stack-logo__wordmark" aria-hidden="true">{company.name}</span>
                  <span className="stack-logo__role">{company.role}</span>
                </a>
              ))}
            </div>
            <p className="stack-section__disclosure">
              Cloudflare and Shopify remain documented extensions, not live Cardea integrations.
            </p>
          </div>
        </section>

        <section className="use-cases-section" id="use-cases" aria-labelledby="use-cases-title">
          <div className="page-grid">
            <div className="use-cases-heading">
              <p className="section-eyebrow">Relocation is the flagship, not the limit</p>
              <h2 id="use-cases-title">Any goal with moving parts deserves room to think.</h2>
            </div>
            <div className="use-case-list">
              {useCases.map((item) => (
                <article key={item.number}>
                  <span className="use-case-number pixel-label">{item.number}</span>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                  <span className="use-case-line" aria-hidden="true" />
                </article>
              ))}
            </div>
            <div className="public-demo-note">
              <span className="public-demo-note__mark"><LogoMark /></span>
              <div><b>Public demo access</b><p>Explore the preloaded Phoenix to San Francisco mission without signing in.</p></div>
              <ButtonLink href="/canvas" tone="secondary">Enter the relocation demo <ArrowIcon /></ButtonLink>
            </div>
          </div>
        </section>

        <section className="start-section page-grid" aria-labelledby="start-title">
          <div className="start-copy">
            <p className="section-eyebrow">Begin at the threshold</p>
            <h2 id="start-title">Tell Cardea what needs to change.</h2>
            <p>Start with a real goal and the boundaries that matter. Cardea will prepare a mandate before a complex mission begins.</p>
          </div>
          <StartMissionDemo />
        </section>

        <section className="closing-section" aria-labelledby="closing-title">
          <Image
            src="/images/cardea/closing.webp"
            alt="A figure faces a lit classical doorway in a quiet dark landscape"
            fill
            sizes="100vw"
            className="closing-image"
          />
          <div className="closing-overlay page-grid">
            <div className="closing-copy">
              <LogoMark className="logo-mark--closing" />
              <h2 id="closing-title">The next world is ready when you are.</h2>
              <p>Watch Cardea coordinate the move, then step in at every decision that matters.</p>
              <ButtonLink href="/canvas" tone="coral">Enter Cardea <ArrowIcon /></ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer__brand"><LogoMark /><span>Cardea</span></div>
        <p>Your Canvas Beyond the Prompt</p>
        <nav aria-label="Footer navigation">
          <a href="/canvas">Canvas</a>
          <a href="#use-cases">Use cases</a>
          <a href="#how-it-works">How it works</a>
          <a href="#top">About</a>
        </nav>
      </footer>
    </>
  );
}
