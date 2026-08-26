"use client";

import { useRef, useState } from "react";
import {
  ArrowIcon,
  Button,
  CheckIcon,
  DemoBadge,
  MoonIcon,
  PauseIcon,
  StatusDot,
  SunIcon,
} from "@/components/ui/primitives";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const buttonRef = useRef<HTMLButtonElement>(null);

  function toggleTheme() {
    const nextTheme: Theme = currentTheme() === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const bounds = buttonRef.current?.getBoundingClientRect();
    const x = bounds ? bounds.left + bounds.width / 2 : window.innerWidth;
    const y = bounds ? bounds.top + bounds.height / 2 : 0;
    root.style.setProperty("--theme-x", `${x}px`);
    root.style.setProperty("--theme-y", `${y}px`);

    const apply = () => {
      root.dataset.theme = nextTheme;
      localStorage.setItem("cardea-theme", nextTheme);
    };

    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("startViewTransition" in document)
    ) {
      apply();
      return;
    }

    const transitionDocument = document as Document & {
      startViewTransition(callback: () => void): { finished: Promise<void> };
    };
    transitionDocument.startViewTransition(apply);
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label="Toggle color theme"
      title="Toggle color theme"
    >
      <span className="theme-toggle__icon theme-toggle__moon" aria-hidden="true"><MoonIcon /></span>
      <span className="theme-toggle__icon theme-toggle__sun" aria-hidden="true"><SunIcon /></span>
    </button>
  );
}

const branchNodes = [
  { id: "housing", code: "Lyra", role: "Housing", state: "Searching", position: "node--housing" },
  { id: "travel", code: "Vela", role: "Travel", state: "Ready", position: "node--travel" },
  { id: "moving", code: "Atlas", role: "Moving", state: "Comparing", position: "node--moving" },
  { id: "home", code: "Hestia", role: "Home", state: "Waiting", position: "node--home" },
];

export function MissionCanvasPreview({ detailed = false }: { detailed?: boolean }) {
  const [rerouted, setRerouted] = useState(false);
  const [selected, setSelected] = useState("housing");

  return (
    <div className={`mission-canvas ${detailed ? "mission-canvas--detailed" : ""}`}>
      <div className="canvas-topbar">
        <div className="canvas-breadcrumb">
          <span>Mission</span>
          <b aria-hidden="true">›</b>
          <span>Phoenix to San Francisco</span>
        </div>
        <DemoBadge />
      </div>

      <div className="canvas-toolbar" aria-label="Canvas tools">
        <button type="button" aria-label="Select" className="tool-button tool-button--active">↗</button>
        <button type="button" aria-label="Focus">◎</button>
        <button type="button" aria-label="Fit canvas">⌗</button>
      </div>

      <svg className="canvas-connectors" viewBox="0 0 900 530" preserveAspectRatio="none" aria-hidden="true">
        <path className="connector connector--root" d="M450 268 C355 225 285 188 195 148" />
        <path className={`connector connector--travel ${rerouted ? "connector--energized" : ""}`} d="M450 268 C560 210 655 180 746 137" />
        <path className={`connector connector--moving ${rerouted ? "connector--energized" : ""}`} d="M450 268 C352 334 260 376 175 412" />
        <path className={`connector connector--home ${rerouted ? "connector--rerouted" : ""}`} d={rerouted ? "M450 268 C570 302 617 392 754 408" : "M450 268 C560 326 650 370 754 408"} />
        <path className={`connector-pulse ${rerouted ? "connector-pulse--visible" : ""}`} d="M450 268 C570 302 617 392 754 408" />
      </svg>

      <div className="mission-root">
        <span className="mission-root__mark">C</span>
        <span>
          <b>Relocate in 10 days</b>
          <small>Budget under $8,000</small>
        </span>
      </div>

      {branchNodes.map((node) => {
        const unavailable = rerouted && node.id === "housing";
        const active = selected === node.id;
        return (
          <button
            type="button"
            key={node.id}
            className={`mission-node ${node.position} ${active ? "mission-node--selected" : ""} ${unavailable ? "mission-node--error" : ""}`}
            onClick={() => setSelected(node.id)}
            aria-pressed={active}
          >
            <span className="mission-node__head">
              <span className="mission-node__name">{node.code} · {node.role}</span>
              <span className={`node-status ${unavailable ? "node-status--error" : ""}`}>
                <StatusDot tone={unavailable ? "coral" : node.id === "home" ? "neutral" : "blue"} />
                {unavailable ? "Unavailable" : node.state}
              </span>
            </span>
            <span className="mission-node__preview" aria-hidden="true">
              {node.id === "housing" && <><i /><i /><i /></>}
              {node.id === "travel" && <><em>PHX</em><strong>→</strong><em>SFO</em></>}
              {node.id === "moving" && <><i /><i /></>}
              {node.id === "home" && <><span className="mini-chair" /><span className="mini-lamp" /></>}
            </span>
            <span className="mission-node__comment">
              {unavailable ? "Leading apartment changed state. Replanning dependent work." :
                node.id === "housing" ? "12 bright options, 4 within the commute limit." :
                node.id === "travel" ? "Two flexible routes fit the calendar." :
                node.id === "moving" ? "Comparing arrival windows after move-in." :
                "Held until a home is chosen."}
            </span>
          </button>
        );
      })}

      <div className="canvas-minimap" aria-hidden="true"><i /><i /><i /></div>

      <div className="canvas-composer">
        {selected && <span className="mention-chip">@{branchNodes.find((node) => node.id === selected)?.code}</span>}
        <span className="canvas-composer__placeholder">Steer this part of the mission…</span>
        <span className="canvas-composer__send">↑</span>
      </div>

      {detailed && (
        <div className="canvas-demo-control">
          <Button
            tone={rerouted ? "secondary" : "coral"}
            onClick={() => setRerouted((value) => !value)}
            aria-pressed={rerouted}
          >
            {rerouted ? "Reset mission" : "Make apartment unavailable"}
          </Button>
          <span role="status" aria-live="polite">
            {rerouted ? "3 dependencies rerouted, your approval is required" : "Fixture ready for the defining reroute"}
          </span>
        </div>
      )}
    </div>
  );
}

export function ApprovalDemo() {
  const [choice, setChoice] = useState("clementina");
  const [approved, setApproved] = useState(false);
  const choices = [
    { id: "clementina", name: "Clementina", detail: "$3,420 move-in · 24 min commute" },
    { id: "divisadero", name: "Divisadero", detail: "$3,760 move-in · 18 min commute" },
  ];

  return (
    <div className="approval-demo">
      <div className="needs-you"><span className="needs-you__orbit" />Needs You <b>1</b></div>
      <div className="approval-card">
        <div className="approval-card__meta">
          <span><StatusDot tone="coral" /> Housing changed</span>
          <span>Hard stop</span>
        </div>
        <h3>{approved ? "Your choice is recorded" : "Choose the next apartment to coordinate around"}</h3>
        <p>
          {approved
            ? "Cardea can now prepare the revised travel, moving, utility, and home plans. Nothing has been booked or purchased."
            : "The leading apartment is no longer available. Both options still meet your bright, non-ground-floor requirement."}
        </p>

        {approved ? (
          <div className="approval-result" role="status">
            <span className="approval-result__icon"><CheckIcon /></span>
            <span><b>{choices.find((item) => item.id === choice)?.name} selected</b><small>Prepared actions remain behind approval.</small></span>
          </div>
        ) : (
          <fieldset>
            <legend className="sr-only">Choose an apartment</legend>
            {choices.map((item, index) => (
              <label key={item.id} className={`approval-option ${choice === item.id ? "approval-option--selected" : ""}`}>
                <input type="radio" name="apartment" value={item.id} checked={choice === item.id} onChange={() => setChoice(item.id)} />
                <span className="approval-option__index">0{index + 1}</span>
                <span><b>{item.name}</b><small>{item.detail}</small></span>
                {index === 0 && <span className="recommended">Recommended</span>}
              </label>
            ))}
          </fieldset>
        )}

        <div className="approval-evidence">
          <span>Evidence</span>
          <a href="#live-web-work">4 source notes</a>
          <span>Budget stays below limit</span>
        </div>
        <div className="approval-actions">
          <Button tone="secondary" onClick={() => setApproved(false)}>{approved ? "Review again" : "Modify"}</Button>
          <Button tone="primary" onClick={() => setApproved(true)} disabled={approved}>{approved ? "Approved" : "Accept choice"}</Button>
        </div>
      </div>
    </div>
  );
}

const walletCards = [
  { id: "personal", name: "Personal", art: "figure", note: "Accessibility and personal preferences" },
  { id: "work", name: "Work", art: "steps", note: "Office location and calendar constraints" },
  { id: "home", name: "Home", art: "door", note: "Current home and furniture context" },
  { id: "travel", name: "Travel", art: "route", note: "Travel preferences and authority limits" },
];

export function ContextWalletDemo() {
  const [selected, setSelected] = useState(["personal", "work", "home"]);
  const [notes, setNotes] = useState([
    { id: 1, title: "No ground-floor units", source: "You added this preference" },
    { id: 2, title: "Bringing the desk", source: "From this mission prompt" },
    { id: 3, title: "Office near Mission Bay", source: "Work card" },
  ]);

  function toggleCard(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <div className="wallet-demo">
      <div className="wallet-stack" role="group" aria-label="Context wallet cards">
        {walletCards.map((card, index) => {
          const active = selected.includes(card.id);
          return (
            <button
              type="button"
              key={card.id}
              className={`wallet-card wallet-card--${card.art} ${active ? "wallet-card--selected" : ""}`}
              style={{ "--card-index": index } as React.CSSProperties}
              aria-pressed={active}
              onClick={() => toggleCard(card.id)}
            >
              <span className="wallet-card__art" aria-hidden="true"><i /><i /><i /></span>
              <span className="wallet-card__copy"><b>{card.name}</b><small>{card.note}</small></span>
              <span className="wallet-card__state">{active ? "Included" : "Not included"}</span>
            </button>
          );
        })}
      </div>
      <div className="memory-notes">
        <div className="memory-notes__head"><span>Visible memory</span><small>{notes.length} notes</small></div>
        {notes.map((note) => (
          <article className="memory-note" key={note.id}>
            <span className="memory-note__pin" aria-hidden="true" />
            <h3>{note.title}</h3>
            <p>{note.source}</p>
            <div>
              <button type="button" onClick={() => setNotes((items) => items.map((item) => item.id === note.id ? { ...item, title: `${item.title} (reviewed)` } : item))}>Edit</button>
              <button type="button" onClick={() => setNotes((items) => items.filter((item) => item.id !== note.id))}>Forget</button>
            </div>
          </article>
        ))}
        {notes.length === 0 && <p className="memory-empty" role="status">No memory notes are entering this mission.</p>}
      </div>
    </div>
  );
}

export function TakeoverPreview() {
  const [controlling, setControlling] = useState(false);

  return (
    <div className="takeover-preview">
      <div className="takeover-browser">
        <div className="browser-chrome">
          <i /><i /><i />
          <span>rental listing · demo fixture</span>
        </div>
        <div className="browser-content">
          <div className="browser-photo" aria-hidden="true"><span /><span /></div>
          <div className="browser-copy"><i /><i /><i /><i /></div>
          {controlling && <div className="control-boundary"><span>You are controlling</span><small>Agent input is paused</small></div>}
        </div>
      </div>
      <aside className="activity-rail">
        <div className="activity-rail__head"><span>Activity</span><DemoBadge /></div>
        <ol>
          <li><span className="pixel-time">00:14</span><b>Opened source</b><small>Listing details and availability</small></li>
          <li><span className="pixel-time">00:22</span><b>Checked constraints</b><small>Floor, light, and commute</small></li>
          <li><span className="pixel-time">00:31</span><b>Paused before contact</b><small>Sending requires your approval</small></li>
        </ol>
        <Button tone={controlling ? "primary" : "secondary"} onClick={() => setControlling((value) => !value)}>
          {controlling ? "Return control" : "Take over"}
        </Button>
      </aside>
    </div>
  );
}

export function StartMissionDemo() {
  return (
    <form className="start-mission" action="/canvas" method="get" id="start-a-mission">
      <label htmlFor="mission-input">Start with a goal</label>
      <div className="start-mission__composer">
        <textarea id="mission-input" name="prompt" rows={3} defaultValue="Help me plan a complex move without booking or buying anything before I approve." />
        <Button type="submit" tone="primary">Start a Mission <ArrowIcon /></Button>
      </div>
      <p className="start-mission__note">The public relocation demo needs no sign-in. A personal mission does.</p>
    </form>
  );
}

export function ConnectionStateButton() {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className="connection-state" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span><PauseIcon /> Connection required</span>
      <small>{open ? "This preview will resume only after explicit authorization." : "Inspect boundary"}</small>
    </button>
  );
}
