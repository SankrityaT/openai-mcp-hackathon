import Image from "next/image";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { ArrowIcon, ButtonLink, LogoMark } from "@/components/ui/primitives";

const workingStack = [
  { name: "OpenAI", slug: "openai", role: "Agent runtime", href: "https://openai.com/" },
  { name: "Chrome", slug: "chrome", role: "WebMCP browser", href: "https://developer.chrome.com/docs/ai/webmcp" },
  { name: "Vercel", slug: "vercel", role: "Deployment", href: "https://vercel.com/" },
  { name: "Supabase", slug: "supabase", role: "Auth + mission state", href: "https://supabase.com/" },
  { name: "Inngest", slug: "inngest", role: "Durable orchestration", href: "https://www.inngest.com/" },
  { name: "Composio", slug: "composio", role: "Connected apps", href: "https://composio.dev/" },
  { name: "supermemory", slug: "supermemory", role: "Long-term memory", href: "https://supermemory.ai/" },
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
          <a href="#stack">The stack</a>
        </nav>
        <div className="header-actions">
          <ButtonLink href="/canvas" tone="primary" className="header-cta">Start a Canvas</ButtonLink>
          <ThemeToggle />
        </div>
      </header>

      <main id="main-content">
        <section className="hero" id="top" aria-labelledby="hero-title">
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
          <picture className="hero-atmosphere hero-atmosphere--light">
            <source media="(max-width: 820px)" srcSet="/images/cardea/hero-stage-mobile.webp" />
            {/* A picture element keeps the monumental lower plate responsive without loading both crops. */}
            <img src="/images/cardea/hero-stage-desktop.webp" alt="" width="2200" height="1160" fetchPriority="high" />
          </picture>
          <picture className="hero-atmosphere hero-atmosphere--dark">
            <source media="(max-width: 820px)" srcSet="/images/cardea/hero-stage-mobile-dark.webp" />
            {/* A hand-authored dark plate, not a filtered copy of the light artwork. */}
            <img src="/images/cardea/hero-stage-desktop-dark.webp" alt="" width="2200" height="1238" />
          </picture>
        </section>

        <section className="stack-section section-rule" id="stack" aria-labelledby="stack-title">
          <div className="page-grid stack-section__inner">
            <p className="stack-section__eyebrow">Cardea&apos;s working stack</p>
            <h2 id="stack-title">Built across the open web.</h2>
            <ul className="stack-logos" aria-label="Technology companies Cardea is built on">
              {workingStack.map((company) => (
                <li key={company.slug}>
                  <a
                    className="stack-logo"
                    href={company.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${company.name}, ${company.role}`}
                  >
                    <Image
                      src={`/images/stack/${company.slug}.png`}
                      alt=""
                      width={224}
                      height={224}
                      className="stack-logo__tile"
                    />
                    <span className="stack-logo__name" aria-hidden="true">{company.name}</span>
                  </a>
                </li>
              ))}
            </ul>
            <div className="stack-section__note">
              <p>
                WebMCP is the public doorway. These systems provide the browser, deployment, durable work, connected apps, and memory behind it &mdash; so Cardea acts on the real web instead of a simulation of it.
              </p>
              <p className="stack-section__disclosure">
                Cloudflare and Shopify remain documented extensions, not live Cardea integrations.
              </p>
            </div>
          </div>
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
          <a href="#stack">The stack</a>
          <a href="#top">About</a>
        </nav>
      </footer>
    </>
  );
}
