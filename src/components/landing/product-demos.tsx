"use client";

import { ApprovalCard } from "@/app/app/_components/approval-card";
import { BrowserTileShell } from "@/app/app/_components/remote-browser-node";
import { WorkspaceTabs } from "@/app/app/_components/workspace-tabs";
import { ComposerShell, SendIcon } from "@/app/app/_components/launcher";
import launcherStyles from "@/app/app/_components/launcher.module.css";
import { MandateSheet } from "@/app/app/_components/mandate-sheet";
import { NodeCard } from "@/app/app/_components/node-card";

/**
 * The landing page's product proof, rendered by the product itself.
 *
 * These are the REAL components from /app (NodeCard, ApprovalCard,
 * MandateSheet), mounted with demo-fixture props drawn from missions that
 * actually ran, per DESIGN.md's rule that product surfaces on the landing
 * page must be real components, never lookalikes. Handlers are no-ops: the
 * components render and behave exactly as they do on the canvas, but resolve
 * nothing, because there is no mission behind them here.
 */

const noop = () => {};

/**
 * The app's own composer, typing the prompt that opened the mission. Inert:
 * the shell is the real component (same frame, tool row, and send button the
 * board renders), the input region is a typed line instead of a textarea,
 * and none of it is focusable because it is an exhibit, not an input.
 */
export function TypedComposer({ children }: { children: string }) {
  return (
    <div className="demo-composer" aria-hidden="true">
      <ComposerShell
        input={
          <div className={launcherStyles.input}>
            <span className="scene-typing">{children}</span>
          </div>
        }
        send={
          <span className={launcherStyles.send}>
            <SendIcon />
          </span>
        }
      />
    </div>
  );
}

export function LiveBrowsingDemo() {
  return (
    <div className="demo-live" aria-hidden="true">
      <div className="demo-live__node scene-actor scene-actor--1">
        <NodeCard
          node={{
            id: "demo-polaris",
            codename: "Polaris",
            roleLabel: "Retail research",
            objective: "Search Target's own site for current compact desk listings with prices.",
            capabilityNames: ["cardea.web_research"],
          }}
          status="running"
          surface={{ kind: "capture", domain: null, live: true }}
        />
      </div>
      {/* The REAL browser tile shell, opening the page the node is reading.
          Its sessions run on Cloudflare Browser Rendering, and the viewport
          says so with the mark instead of a fabricated page capture. */}
      <div className="demo-live__tile scene-actor scene-actor--2">
        <BrowserTileShell
          title="Polaris · target.com"
          domain="target.com"
          badge="Live"
          detail="Cloudflare browser"
          viewport={
            // A miniature of the cart page this mission actually reached
            // (the real run's floor lamp and desk, ready for pickup). Drawn
            // small, not screenshotted, and true to what the browser held.
            <div className="mini-tgt">
              <div className="mini-tgt__bar">
                <i className="mini-tgt__bullseye" />
                <span className="mini-tgt__search" />
                <span className="mini-tgt__cart">2</span>
              </div>
              <p className="mini-tgt__title">Cart</p>
              <div className="mini-tgt__row">
                <i className="mini-tgt__thumb" />
                <span className="mini-tgt__name">Floor lamp, Threshold</span>
                <em>$115.00</em>
              </div>
              <div className="mini-tgt__row">
                <i className="mini-tgt__thumb mini-tgt__thumb--desk" />
                <span className="mini-tgt__name">Scandi desk, Room Essentials</span>
                <em>$100.00</em>
              </div>
              <div className="mini-tgt__foot">
                <span>$232.42 est. total</span>
                <em>Sign in to check out</em>
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}

/**
 * A calm curved path from one node's right edge to the next node's left
 * edge. Same curve construction the board's mission layer draws, so the
 * demo graph routes exactly like the product's.
 */
function connectorPath(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const reach = Math.max(46, Math.abs(x2 - x1) * 0.5);
  return `M${x1} ${y1} C${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`;
}

export function ParallelBranchesDemo() {
  // Node footprints in the demo's own coordinate space. Heights reflect the
  // real rendered card (~200px with an objective and a status row) so the
  // connectors anchor at true card middles and nothing overlaps.
  const lyra = { x: 0, y: 0, width: 268, height: 200 };
  const vega = { x: 0, y: 244, width: 268, height: 200 };
  const altair = { x: 318, y: 122, width: 268, height: 200 };

  return (
    <div className="demo-graph" style={{ zoom: 0.6 }}>
      <svg className="demo-graph__paths scene-paths" viewBox="0 0 586 444" fill="none" aria-hidden="true">
        <path d={connectorPath(lyra, altair)} className="demo-path demo-path--done" />
        <path d={connectorPath(vega, altair)} className="demo-path demo-path--active" />
      </svg>
      <div className="demo-graph__slot scene-actor scene-actor--1" style={{ left: lyra.x, top: lyra.y }}>
        <NodeCard
          node={{
            id: "demo-lyra",
            codename: "Lyra",
            roleLabel: "Menu plan",
            objective: "Plan a Saturday dinner menu for six with one vegetarian guest.",
            capabilityNames: [],
          }}
          status="completed"
          surface={{ kind: "capture", domain: null }}
        />
      </div>
      <div className="demo-graph__slot scene-actor scene-actor--2" style={{ left: vega.x, top: vega.y }}>
        <NodeCard
          node={{
            id: "demo-vega",
            codename: "Vega",
            roleLabel: "Grocery run",
            objective: "Search current grocery prices for every menu ingredient.",
            capabilityNames: [],
          }}
          status="running"
          surface={{ kind: "capture", domain: null, live: true }}
        />
      </div>
      <div className="demo-graph__slot scene-actor scene-actor--3" style={{ left: altair.x, top: altair.y }}>
        <NodeCard
          node={{
            id: "demo-altair",
            codename: "Altair",
            roleLabel: "Shopping list",
            objective: "Fold both branches into one ordered shopping list.",
            capabilityNames: [],
          }}
          status="waiting"
          surface={{ kind: "capture", domain: null }}
        />
      </div>
    </div>
  );
}

export function HingeDemo() {
  return (
    <div className="demo-scale scene-actor scene-actor--2" style={{ zoom: 0.82 }}>
      <ApprovalCard
        approval={{
          id: "demo-bouquet",
          category: "read",
          recommendation: "Which flowers should go to her? Suggested: Peonies",
          alternatives: ["Tulips", "Roses", "Peonies"],
          evidence: [],
          consequence:
            "Accept takes the suggested answer. Modify lets you write your own. The mission waits here until you answer, and nothing leaves Cardea either way.",
          status: "pending",
        }}
        resolving={false}
        onResolve={noop}
      />
    </div>
  );
}

export function MandateDemo() {
  return (
    <div className="demo-scale demo-scale--mandate" style={{ zoom: 0.52 }}>
      <MandateSheet
        mandate={{
          goal: "Get me set up to buy a bed frame, a desk, and a floor lamp this week.",
          version: 1,
          constraints: [],
          approvedAt: null,
        }}
        plan={null}
        capabilityNames={[
          "cardea.web_research",
          "cardea.ask_user",
          "shopify.cart_prepare",
          "gmail.create_draft",
        ]}
        freePassage={false}
        onFreePassageChange={noop}
        approving={false}
        onApprove={noop}
      />
    </div>
  );
}

/**
 * The hero's glass canvas: the product's own surface, floating over the
 * threshold artwork. Every piece is the real component (workspace strip,
 * node cards, approval card, composer shell); the glass is the panel's,
 * not the components'. Inert fixture, aria-hidden, per the demo contract.
 */
export function HeroCanvas() {
  // Spread to the panel's edges so the threshold artwork stays visible
  // through the open centre of the glass.
  const from = { x: 0, y: 54, width: 268, height: 190 };
  const to = { x: 980, y: 6, width: 300, height: 190 };
  return (
    <div className="hero-canvas board-material" aria-hidden="true">
      <div className="hero-canvas__tabs">
        <WorkspaceTabs
          tabs={[
            { key: "m-demo-1", missionId: "demo-1", title: "Apartment setup", status: "active" },
            { key: "m-demo-2", missionId: "demo-2", title: "Dinner for six", status: "completed" },
          ]}
          activeKey="m-demo-1"
          onSelect={noop}
          onNewWorkspace={noop}
        />
      </div>
      <div className="hero-canvas__world">
        <svg className="hero-canvas__paths" viewBox="0 0 1280 380" fill="none">
          <path d={connectorPath(from, to)} className="demo-path demo-path--active" />
        </svg>
        <div className="hero-canvas__slot" style={{ left: from.x, top: from.y, width: from.width }}>
          <NodeCard
            node={{
              id: "hero-polaris",
              codename: "Polaris",
              roleLabel: "Retail research",
              objective: "Search Target's own site for current bed frame listings with prices.",
              capabilityNames: [],
            }}
            status="running"
            surface={{ kind: "capture", domain: null, live: true }}
          />
        </div>
        <div className="hero-canvas__slot" style={{ left: to.x, top: to.y, width: to.width }}>
          <ApprovalCard
            approval={{
              id: "hero-bed-size",
              category: "read",
              recommendation: "Which bed size should the plan build around?",
              alternatives: ["Twin", "Queen", "King"],
              evidence: [],
              consequence: "The mission waits here until you answer.",
              status: "pending",
            }}
            resolving={false}
            onResolve={noop}
          />
        </div>
      </div>
      <div className="hero-canvas__composer">
        <TypedComposer>Set me up to move into an empty apartment this week.</TypedComposer>
      </div>
    </div>
  );
}
