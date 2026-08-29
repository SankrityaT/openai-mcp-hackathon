import Image from "next/image";
import { headers } from "next/headers";
import { ArrowIcon, ButtonLink, LogoMark } from "@/components/ui/primitives";
import {
  ConstellationVignette,
  MemoryVignette,
  ReceiptsVignette,
  WalletVignette,
} from "@/components/landing/vignettes";
import {
  HingeDemo,
  LiveBrowsingDemo,
  HeroCanvas,
  MandateDemo,
  ParallelBranchesDemo,
  TypedComposer,
} from "@/components/landing/product-demos";
import {
  HERO_SUBHEAD,
  STACK_DISCLOSURE,
  STACK_NOTE,
  WORKING_STACK as workingStack,
  siteOrigin,
} from "@/core/agent-surface/site";
import { homepageJsonLd, serializeJsonLd } from "@/core/agent-surface/structured-data";

export default async function Home() {
  // Same per-request CSP nonce RootLayout reads (minted in src/proxy.ts). The
  // JSON-LD block is data, not executable script, but `script-src` still
  // governs the element, so it carries the nonce like every other inline
  // script on the page.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    // The landing page is authored in one material: warm bone, always. The
    // wrapper pins the light tokens regardless of the app's saved theme (the
    // `:root, [data-theme="light"]` selector in globals.css re-declares them
    // at this scope), per the user's decision to drop theming here entirely.
    <div className="landing" data-theme="light">
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(homepageJsonLd(siteOrigin())) }}
      />
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="landing-rail landing-rail--left" aria-hidden="true" />
      <div className="landing-rail landing-rail--right" aria-hidden="true" />
      <header className="site-header">
        <a href="#top" className="brand" aria-label="Cardea home">
          <LogoMark />
          <span>Cardea</span>
        </a>
        <nav className="primary-nav" aria-label="Primary navigation">
          <a href="/app">Canvas</a>
          <a href="#how">How it works</a>
          <a href="#stack">The stack</a>
        </nav>
        <div className="header-actions">
          <ButtonLink href="/app" tone="primary" className="header-cta">Start a Canvas</ButtonLink>
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
              <p className="hero-subhead">{HERO_SUBHEAD}</p>
              <div className="hero-actions">
                <ButtonLink href="/app" tone="primary" className="hero-primary hero-primary--pill">Enter Cardea <ArrowIcon /></ButtonLink>
              </div>
            </div>
          </div>
          <picture className="hero-atmosphere">
            <source media="(max-width: 820px)" srcSet="/images/cardea/hero-stage-mobile.webp" />
            {/* A picture element keeps the monumental lower plate responsive without loading both crops. */}
            <img src="/images/cardea/hero-stage-desktop.webp" alt="" width="2200" height="1160" fetchPriority="high" />
          </picture>
          <HeroCanvas />
        </section>

        <section className="engine-section section-rule" id="how" aria-labelledby="engine-title">
          <div className="page-grid engine-section__inner">
            <p className="section-eyebrow">How it works</p>
            <h2 id="engine-title">Watch the work, not a spinner.</h2>
            <p className="engine-section__lede">
              Cardea does not answer from recall. Give it a goal with real moving parts and it
              opens real pages in its own browser, runs the independent branches in parallel,
              and stops at the threshold whenever the next move is yours.
            </p>
            <div className="engine-cards">
              <article className="engine-card">
                <div className="engine-card__stage board-material">
                  <div className="engine-card__work">
                    <LiveBrowsingDemo />
                  </div>
                  <TypedComposer>Buy me a desk and a floor lamp this week.</TypedComposer>
                </div>
                <p className="engine-card__caption">
                  <strong>Live browsing.</strong> Every branch opens real pages in Cardea&apos;s
                  Cloudflare-run browser, and you can watch, open, scroll, and take over.
                </p>
              </article>
              <article className="engine-card">
                <div className="engine-card__stage board-material">
                  <div className="engine-card__work">
                    <ParallelBranchesDemo />
                  </div>
                  <TypedComposer>Host a dinner party for six on Saturday.</TypedComposer>
                </div>
                <p className="engine-card__caption">
                  <strong>Parallel branches.</strong> Independent work runs at once, and each step
                  hands its evidence to the ones that depend on it.
                </p>
              </article>
              <article className="engine-card">
                <div className="engine-card__stage board-material">
                  <div className="engine-card__work">
                    <HingeDemo />
                  </div>
                  <TypedComposer>Get flowers to my mom by Friday.</TypedComposer>
                </div>
                <p className="engine-card__caption">
                  <strong>The hinge.</strong> When only you can answer, the mission stops and asks,
                  and your answer steers everything downstream.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="memory-section section-rule" aria-labelledby="memory-title">
          <div className="page-grid memory-section__inner">
            <div className="memory-section__copy">
              <p className="section-eyebrow">Memory</p>
              <h2 id="memory-title">Memory you approve.</h2>
              <p>
                Cardea notices what your missions reveal, your taste, your budget shape, the way
                you decide, and asks before keeping any of it. Promoted memory sharpens the next
                plan. Everything is visible, editable, and yours to forget.
              </p>
              <p className="memory-section__powered">
                <Image src="/images/stack/supermemory.png" alt="" width={28} height={28} />
                Long-term memory runs on supermemory.
              </p>
            </div>
            <div className="memory-section__stage">
              <MemoryVignette />
            </div>
          </div>
        </section>

        <section className="trust-section section-rule" aria-labelledby="trust-title">
          <div className="page-grid trust-section__inner">
            <p className="section-eyebrow">Authority</p>
            <h2 id="trust-title">Nothing commits without you.</h2>
            <p className="trust-section__lede">
              Every mission starts from a mandate you approve, spends only what you loaded, and
              stops at a visible approval before anything consequential leaves Cardea.
            </p>
            <div className="trust-cards">
              <article className="trust-card">
                <div className="trust-card__stage trust-card__stage--mandate board-material"><MandateDemo /></div>
                <p className="trust-card__caption">
                  <strong>The mandate.</strong> Goal, constraints, and every capability the mission
                  may reach, reviewed before planning begins.
                </p>
              </article>
              <article className="trust-card">
                <div className="trust-card__stage"><WalletVignette /></div>
                <p className="trust-card__caption">
                  <strong>Context wallet.</strong> Collectible passes carry the context and spending
                  limits a mission is allowed to use.
                </p>
              </article>
              <article className="trust-card">
                <div className="trust-card__stage"><ReceiptsVignette /></div>
                <p className="trust-card__caption">
                  <strong>Hard stops.</strong> Research runs freely. Carts, drafts, and events wait
                  for you. Sending and spending never happen on their own.
                </p>
              </article>
              <article className="trust-card">
                <div className="trust-card__stage"><ConstellationVignette /></div>
                <p className="trust-card__caption">
                  <strong>Connected apps.</strong> Gmail and Calendar connect through official
                  OAuth, scoped to drafts and events that still stop for you.
                </p>
              </article>
            </div>
          </div>
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
              <p>{STACK_NOTE}</p>
              <p className="stack-section__disclosure">{STACK_DISCLOSURE}</p>
            </div>
          </div>
        </section>

        <section className="closing-section" aria-labelledby="closing-title">
          <Image
            src="/images/cardea/closing-dawn.webp"
            alt="A figure walks toward a monumental arch at sunrise over a wide valley"
            fill
            sizes="100vw"
            className="closing-image"
          />
          <div className="closing-overlay page-grid">
            <div className="closing-copy">
              <LogoMark className="logo-mark--closing" />
              <h2 id="closing-title">The next world is ready when you are.</h2>
              <p>Watch Cardea coordinate the move, then step in at every decision that matters.</p>
              <ButtonLink href="/app" tone="coral">Enter Cardea <ArrowIcon /></ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer__brand"><LogoMark /><span>Cardea</span></div>
        <p>Your Canvas Beyond the Prompt</p>
        <nav aria-label="Footer navigation">
          <a href="/app">Canvas</a>
          <a href="#stack">The stack</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    </div>
  );
}
