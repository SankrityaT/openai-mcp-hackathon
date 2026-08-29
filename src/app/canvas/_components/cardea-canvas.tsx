"use client";

import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type {
  ActivityItem,
  ActivityKind,
  JourneyStage,
  MissionNode,
  RelocationMissionFixture,
} from "../_fixtures/types";
import styles from "./canvas.module.css";
import { useCardeaWebMCP } from "@/webmcp/use-cardea-webmcp";
import type {
  ApprovalDecision,
  MissionActionOptions,
  MissionActionResult,
  NodeControlAction,
} from "@/core/contracts/mission-data-source";
import { useMissionDataSource } from "../_data/use-mission-data-source";
import { useCompanionTools, type CompanionRecord } from "@/webmcp/use-companion-tools";
import { useCompanionEvidenceRecorder } from "@/webmcp/use-companion-evidence-recorder";
import { CompanionPanel } from "./companion-panel";
import { IntegrationPanel } from "./integration-panel";
import { ShopifyPanel } from "./shopify-panel";
import { useShopifyCapability } from "./use-shopify-capability";

type IconName =
  | "arrow"
  | "check"
  | "close"
  | "companion"
  | "focus"
  | "history"
  | "memory"
  | "pause"
  | "play"
  | "redo"
  | "route"
  | "settings"
  | "spark"
  | "storefront"
  | "takeover";

const activityFilters: (ActivityKind | "All")[] = [
  "All",
  "Plan",
  "Actions",
  "Evidence",
  "Decisions",
  "Errors",
  "Approvals",
];

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <path d="m5 12 14 0m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    companion: (
      <>
        <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
        <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
      </>
    ),
    focus: (
      <>
        <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5M12 7v5l3 2" />
      </>
    ),
    memory: (
      <>
        <path d="M8 4a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4Z" />
        <path d="M9 9h6M9 13h6M9 17h4" />
      </>
    ),
    pause: <path d="M8 5v14M16 5v14" />,
    play: <path d="m8 5 11 7-11 7Z" />,
    redo: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M20 12a8 8 0 1 0-2.3 5.7" />
      </>
    ),
    route: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="19" r="2" />
        <path d="M6 7v3c0 2 2 3 4 3h4c2 0 4 1 4 4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    spark: (
      <>
        <path d="m12 2 1.2 4.8L18 8l-4.8 1.2L12 14l-1.2-4.8L6 8l4.8-1.2Z" />
        <path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7Z" />
      </>
    ),
    storefront: (
      <>
        <path d="M4 9h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
        <path d="M4 9 5.5 4h13L20 9" />
        <path d="M9 21v-6h6v6" />
      </>
    ),
    takeover: (
      <>
        <path d="M8 11V6a2 2 0 1 1 4 0v4" />
        <path d="M12 10V5a2 2 0 1 1 4 0v6" />
        <path d="M16 10V8a2 2 0 1 1 4 0v6c0 5-3 8-8 8h-1c-3 0-5-1-7-4l-2-3a2 2 0 0 1 3-2l3 2" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function OrbitalMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? styles.orbitalCompact : styles.orbitalMark} aria-hidden="true">
      <span className={styles.orbitalCore} />
      <span className={styles.orbitalRing} />
      <span className={styles.orbitalHinge} />
    </span>
  );
}

function StatusBadge({ status }: { status: MissionNode["status"] }) {
  const labels = {
    active: "Working",
    paused: "Paused",
    "needs-you": "Needs You",
    error: "Blocked",
    complete: "Complete",
  };

  return (
    <span className={`${styles.status} ${styles[`status_${status}`]}`}>
      <span className={styles.statusDot} />
      {labels[status]}
    </span>
  );
}

function FixturePreview({ node, failed }: { node: MissionNode; failed: boolean }) {
  const preview = {
    lyra: (
      <div className={styles.previewHousing}>
        <div className={styles.previewRoom} aria-hidden="true"><i /><i /><i /></div>
        <div><b>Candidate B</b><span>Upper floor · bright</span><strong>24 min</strong></div>
      </div>
    ),
    hermes: (
      <div className={styles.previewTravel}>
        <div><b>PHX</b><i /><b>SFO</b></div>
        <ul>
          <li><b>07:10</b><span>Nonstop</span><strong>10:28</strong></li>
          <li><b>09:35</b><span>Nonstop</span><strong>12:50</strong></li>
          <li><b>13:20</b><span>Nonstop</span><strong>16:36</strong></li>
        </ul>
        <em>3 provisional windows held</em>
      </div>
    ),
    atlas: (
      <div className={styles.previewQuotes}>
        <b>Move estimates</b>
        <span><i />Desert → Bay<strong>$1,480</strong></span>
        <span><i />Mesa Move Co.<strong>$1,620</strong></span>
      </div>
    ),
    hestia: (
      <div className={styles.previewProducts}>
        <b>First-night essentials</b>
        <div><i>Bed</i><i>Light</i><i>Kitchen</i></div>
        <span>Desk already owned</span>
      </div>
    ),
    electra: (
      <div className={styles.previewUtilities}>
        <b>Service starts</b>
        <span>Power<i /></span><span>Internet<i /></span><span>Water<i /></span>
      </div>
    ),
    themis: (
      <div className={styles.previewChecklist}>
        <b>Address checklist</b>
        <span><i />Payroll draft</span><span><i />Insurance draft</span><span><i />Mail draft</span>
      </div>
    ),
    aurora: (
      <div className={styles.previewCalendar}>
        <b>First week</b>
        <div><i>M</i><i>T</i><i>W</i><i>T</i><i>F</i></div>
        <span>Orientation protected</span>
      </div>
    ),
  }[node.id];

  return (
    <div className={`${styles.preview} ${failed ? styles.previewFailed : ""}`}>
      <div className={styles.previewBar}>
        <span className={styles.previewDots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className={styles.previewAddress}>representative.fixture</span>
        <span className={styles.fixtureTag}>Fixture</span>
      </div>
      <div className={`${styles.previewBody} ${styles[`preview_${node.id}`]}`}>
        {failed ? (
          <div className={styles.previewUnavailable}>
            <b>Candidate unavailable</b>
            <span>No external action was taken</span>
          </div>
        ) : preview}
      </div>
    </div>
  );
}

function WalletCard({
  name,
  detail,
  accent,
  symbol,
  selected,
  onClick,
}: RelocationMissionFixture["wallet"][number] & {
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.walletCard} ${styles[`wallet_${accent}`]} ${selected ? styles.walletSelected : ""}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className={styles.walletArt} aria-hidden="true">
        <i>{symbol}</i>
        <b />
      </span>
      <span className={styles.walletText}>
        <strong>{name}</strong>
        <small>{detail}</small>
      </span>
      <span className={styles.walletCheck} aria-hidden="true">
        {selected ? <Icon name="check" size={13} /> : "+"}
      </span>
    </button>
  );
}

function ApprovalCard({
  compact = false,
  onAccept,
  onModify,
}: {
  compact?: boolean;
  onAccept: () => void;
  onModify: () => void;
}) {
  return (
    <section className={`${styles.approvalCard} ${compact ? styles.approvalCompact : ""}`}>
      <div className={styles.approvalHead}>
        <span className={styles.hingeIcon}>
          <OrbitalMark compact />
        </span>
        <div>
          <span className={styles.eyebrow}>Decision required</span>
          <h3>Choose the alternate apartment?</h3>
        </div>
      </div>
      {!compact && (
        <>
          <p>
            The representative alternate keeps the commute and light constraints,
            and moves the planned total to <strong>$7,640</strong>.
          </p>
          <div className={styles.recommendation}>
            <span>Recommended</span>
            <b>Mission fixture · Candidate B</b>
            <small>Upper floor · 24 min commute · $3,180 move-in</small>
          </div>
          <details>
            <summary>Evidence and consequence</summary>
            <p>
              Fixture attributes match the mandate. Accepting updates dependent
              drafts only. Nothing is booked, signed, bought, or sent.
            </p>
          </details>
        </>
      )}
      <div className={styles.approvalActions}>
        <button type="button" className={styles.secondaryButton} onClick={onModify}>
          Modify
        </button>
        <button type="button" className={styles.primaryButton} onClick={onAccept}>
          Accept{!compact && " recommendation"}
          <Icon name="arrow" size={15} />
        </button>
      </div>
    </section>
  );
}

/**
 * Project a companion WebMCP invocation into the existing activity surface.
 *
 * Two entries per invocation so both halves stay filterable with the existing controls: the
 * request under "Actions", and the returned result under "Evidence" (or "Errors"). Nothing here
 * is invented — an entry only exists because a real cross-origin call was made.
 */
function companionActivity(records: CompanionRecord[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const record of records) {
    const time = record.startedAt.slice(11, 16);
    items.push({
      id: `${record.id}-request`,
      time,
      kind: "Actions",
      title: `Companion tool requested · ${record.toolName}`,
      detail: `Cross-origin WebMCP call to ${
        record.outcome.status === "ok" ? record.outcome.evidence.origin : "the configured companion origin"
      } with bounded input ${JSON.stringify(record.input ?? {})}.`,
    });

    if (record.outcome.status !== "ok") {
      items.push({
        id: `${record.id}-result`,
        time,
        kind: "Errors",
        title: `Companion tool ${record.outcome.status} · ${record.toolName}`,
        detail: record.outcome.reason,
      });
      continue;
    }

    const evidence = record.outcome.evidence;
    items.push({
      id: `${record.id}-result`,
      time,
      kind: "Evidence",
      title: `Companion evidence · ${record.toolName}`,
      detail: [
        `Origin ${evidence.origin} · trust ${evidence.trust} · ${evidence.resultBytes} bytes${
          evidence.truncated ? " (excerpt truncated)" : ""
        }.`,
        evidence.digest ? `Digest sha-256 ${evidence.digest}.` : "Digest unavailable in this context.",
        `Excerpt: ${evidence.excerpt}`,
        record.persistence.persisted
          ? `Recorded as mission event evidence.recorded${
              record.persistence.sequence !== undefined ? ` #${record.persistence.sequence}` : ""
            }.`
          : `Not persisted: ${record.persistence.reason ?? "no live data source"}.`,
      ].join(" "),
    });
  }
  return items;
}

function ActivityStream({
  items,
  filter,
  setFilter,
}: {
  items: ActivityItem[];
  filter: ActivityKind | "All";
  setFilter: (filter: ActivityKind | "All") => void;
}) {
  const visible = items.filter((item) => filter === "All" || item.kind === filter);

  return (
    <div className={styles.activityContent}>
      <div className={styles.filterRow} aria-label="Filter activity">
        {activityFilters.map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <ol className={styles.activityList}>
        {visible.map((item, index) => (
          <li key={item.id} className={styles.activityItem}>
            <div className={styles.activityTime}>{item.time}</div>
            <span
              className={`${styles.activityGlyph} ${styles[`activity_${item.kind}`]}`}
              aria-hidden="true"
            />
            <details open={index === visible.length - 1}>
              <summary>
                <span>{item.kind}</span>
                {item.title}
              </summary>
              <p>{item.detail}</p>
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Build-time public origin of the WebMCP companion site.
 *
 * `NEXT_PUBLIC_*` is inlined by Next.js, so the canvas can read it directly without threading it
 * through the server component. When it is absent the companion affordance renders a truthful
 * "not configured" state, embeds nothing, and registers nothing.
 */
const CONFIGURED_COMPANION_ORIGIN = process.env.NEXT_PUBLIC_CARDEA_COMPANION_ORIGIN ?? null;

export function CardeaCanvas({
  mission,
  initialStage,
  initialTakeover = null,
  initialMobileView,
  initialTheme,
  companionOrigin = CONFIGURED_COMPANION_ORIGIN,
}: {
  mission: RelocationMissionFixture;
  initialStage: JourneyStage;
  initialTakeover?: string | null;
  initialMobileView?: "mission" | "approval" | "activity";
  initialTheme: "auto" | "light" | "dark";
  /**
   * Override the configured companion origin. Defaults to the public env value.
   * Data mode and durable persistence come from the mission seam, not from props.
   */
  companionOrigin?: string | null;
}) {
  const [localStage, setStage] = useState<JourneyStage>(initialStage);
  const [dismissedMissionId, setDismissedMissionId] = useState<string | null>(null);
  const [selectedWallet, setSelectedWallet] = useState(
    new Set(["personal", "work", "home", "travel"]),
  );
  const [freePassage, setFreePassage] = useState(false);
  const [draftGoal, setDraftGoal] = useState(mission.prompt);
  const [missionSubmitting, setMissionSubmitting] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [pausedNode, setPausedNode] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [mention, setMention] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [shopifyOpen, setShopifyOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [takeoverNode, setTakeoverNode] = useState<string | null>(initialTakeover);
  const [takeoverSplit, setTakeoverSplit] = useState(70);
  const [filter, setFilter] = useState<ActivityKind | "All">("All");
  const [notice, setNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryRefs, setMemoryRefs] = useState<Record<string, string>>({});
  const [memoryTexts, setMemoryTexts] = useState<Record<string, string>>({});
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [memoryBusy, setMemoryBusy] = useState<string | null>(null);
  const [theme, setTheme] = useState(initialTheme);
  const [mobileTab, setMobileTab] = useState<"mission" | "approval" | "activity">(
    initialMobileView ?? (initialStage === "approval" ? "approval" : "mission"),
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setTakeoverNode(null);
        setActivityOpen(false);
        setComposerOpen(false);
        setExpandedNode(null);
        setCompanionOpen(false);
        setSettingsOpen(false);
      }
      if (event.key.toLowerCase() === "f" && !event.metaKey && !event.ctrlKey) {
        const target = event.target as HTMLElement | null;
        if (!target?.matches("input, textarea")) setFocusMode((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const nodes = useMemo(
    () =>
      mission.nodes.map((node) => {
        let status = node.status;
        let progress = node.progress;
        let commentary = node.commentary;
        if (localStage === "complete") {
          status = "complete";
          progress = 100;
          commentary = "This representative branch settled into the mission artifact.";
        } else if (node.id === "lyra" && localStage === "error") {
          status = "error";
          commentary = "The leading fixture candidate became unavailable. Recovery is waiting for direction.";
        } else if (node.id === "lyra" && localStage === "approval") {
          status = "needs-you";
          commentary = "The dependency reroute is ready, but the alternate apartment needs your judgment.";
        } else if (
          ["hestia", "electra", "hermes"].includes(node.id) &&
          (localStage === "error" || localStage === "approval")
        ) {
          commentary = "Dependency updated to the alternate address fixture.";
        }
        if (pausedNode === node.id) status = "paused";
        return { ...node, status, progress, commentary };
      }),
    [localStage, mission.nodes, pausedNode],
  );

  const { dataSource, dataMode, session, spine } = useMissionDataSource({
    getFixtureNodes: () =>
      nodes.map((node) => ({
        id: node.id,
        codename: node.codename,
        roleLabel: node.role,
        status: node.status,
      })),
    hasPendingFixtureApproval: () => localStage === "approval",
  });

  const stage: JourneyStage =
    localStage === "empty" &&
    dataMode.mode === "live" &&
    spine.missionId &&
    dismissedMissionId !== spine.missionId
      ? spine.missionStatus === "completed"
        ? "complete"
        : spine.mandateApproved
          ? "active"
          : "planning"
      : localStage;

  function returnToPrompt() {
    setDismissedMissionId(spine.missionId);
    setStage("empty");
  }

  /**
   * One truthful notice for every seam result: persisted work says so with its
   * committed state version, fixture work says it recorded nothing.
   */
  function reportResult(result: MissionActionResult, success: string) {
    if (!result.ok) {
      setNotice(result.failure?.message ?? "Cardea could not complete that action.");
      return false;
    }
    setNotice(
      result.persisted
        ? `${success} · persisted at state v${result.stateVersion ?? "?"}`
        : `${success} · representative fixture, nothing persisted`,
    );
    return true;
  }

  /**
   * Durable provenance for outbound companion results, through the same mission
   * seam every other action uses. Null in fixture mode, which is what makes the
   * companion panel say plainly that nothing was persisted.
   */
  const recordCompanionEvidence = useCompanionEvidenceRecorder({
    dataMode: dataMode.mode,
    missionId: spine.missionId,
  });

  const companion = useCompanionTools({
    origin: companionOrigin,
    recordEvidence: recordCompanionEvidence,
    fixtureReason: `${
      dataMode.notice ?? "Representative fixture mode"
    } · the companion result is shown here but no mission event was persisted.`,
    // Surface each completed invocation through the existing notice mechanism.
    onRecord: (record) =>
      setNotice(
        record.outcome.status === "ok"
          ? `Companion ${record.toolName} returned untrusted evidence · ${
              record.persistence.persisted
                ? `recorded as evidence.recorded${
                    record.persistence.sequence !== undefined
                      ? ` #${record.persistence.sequence}`
                      : ""
                  }`
                : `not persisted · ${record.persistence.reason ?? "no live mission"}`
            }`
          : `Companion ${record.toolName} ${record.outcome.status}: ${record.outcome.reason}`,
      ),
  });

  /**
   * Optional Shopify storefront capability. Entirely env-gated on the server:
   * with no store configured the panel says so and calls nothing, so this hook
   * costs one status request and changes no other behavior.
   *
   * It shares `recordCompanionEvidence`, so a storefront read lands in the
   * mission log through exactly the same `evidence.recorded` path as a
   * companion result, and is null in fixture mode for the same reason.
   */
  const shopify = useShopifyCapability({
    missionId: spine.missionId,
    recordEvidence: recordCompanionEvidence,
    fixtureReason: `${
      dataMode.notice ?? "Representative fixture mode"
    } · the storefront result is shown here but no mission event was persisted.`,
    onRecord: (record) =>
      setNotice(
        record.outcome.status === "ok"
          ? `Shopify ${record.capabilityId} returned untrusted evidence · ${
              record.persistence.persisted
                ? `recorded as evidence.recorded${
                    record.persistence.sequence !== undefined
                      ? ` #${record.persistence.sequence}`
                      : ""
                  }`
                : `not persisted · ${record.persistence.reason ?? "no live mission"}`
            }`
          : `Shopify ${record.capabilityId} failed: ${record.outcome.reason}`,
      ),
  });

  const activityItems = useMemo(
    () => [...mission.activity, ...companionActivity(companion.records)],
    [mission.activity, companion.records],
  );

  const selected = nodes.find((node) => node.id === selectedNode) ?? nodes[0];
  const waitingNodeId = spine.nodes.find((node) => node.status === "waiting")?.id ?? null;
  const visibleNodes = stage === "active" ? nodes.slice(0, 3) : nodes;
  const takeover = nodes.find((node) => node.id === takeoverNode);
  const isMissionStage = stage !== "empty" && stage !== "planning";

  function chooseNode(node: MissionNode) {
    setSelectedNode(node.id);
    if (focusMode) {
      setMention(node.codename);
      setComposerOpen(true);
      setFocusMode(false);
      setNotice(`Focus scoped to ${node.codename} · ${node.role}`);
    }
  }

  function toggleWallet(id: string) {
    setSelectedWallet((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function postMemory(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as {
      available?: boolean;
      error?: string;
      memoryRef?: { id?: string };
    };
    if (!response.ok) throw new Error(result.error ?? "memory_request_failed");
    return result;
  }

  async function saveMemory(memory: (typeof mission.memories)[number]) {
    if (dataMode.mode !== "live") {
      setNotice("Memory saved with explicit fixture consent · nothing persisted");
      return;
    }
    const text = memoryTexts[memory.id] ?? memory.text;
    setMemoryBusy(memory.id);
    try {
      const memoryRefId = memoryRefs[memory.id];
      const result = memoryRefId
        ? await postMemory("/api/memory/update", { memoryRefId, text })
        : await postMemory("/api/memory/promote", {
            text,
            source: memory.source,
            influence: memory.influence,
            ...(spine.missionId ? { missionId: spine.missionId } : {}),
            idempotencyKey: `cardea-${memory.id}-${spine.missionId ?? "session"}`,
          });
      if (!result.available || !result.memoryRef?.id) {
        throw new Error("supermemory_not_configured");
      }
      setMemoryRefs((current) => ({ ...current, [memory.id]: result.memoryRef!.id! }));
      setEditingMemoryId(null);
      setNotice(memoryRefId ? "Memory updated and versioned" : "Memory saved with explicit consent");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Memory unavailable: ${error.message.replaceAll("_", " ")}`
          : "Memory unavailable",
      );
    } finally {
      setMemoryBusy(null);
    }
  }

  async function forgetMemory(memory: (typeof mission.memories)[number]) {
    const memoryRefId = memoryRefs[memory.id];
    if (dataMode.mode !== "live" || !memoryRefId) {
      setNotice("Representative note forgotten locally · nothing persisted");
      return;
    }
    setMemoryBusy(memory.id);
    try {
      const result = await postMemory("/api/memory/forget", { memoryRefId });
      if (!result.available) throw new Error("supermemory_not_configured");
      setMemoryRefs((current) => {
        const next = { ...current };
        delete next[memory.id];
        return next;
      });
      setNotice("Memory forgotten and removed from future retrieval");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Memory unavailable: ${error.message.replaceAll("_", " ")}`
          : "Memory unavailable",
      );
    } finally {
      setMemoryBusy(null);
    }
  }

  function handlePrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("goal") ?? "").trim();
    if (!value) {
      setNotice("Tell Cardea what the mission should accomplish first.");
      return;
    }
    setDraftGoal(value.slice(0, 8_000));
    setStage("planning");
  }

  async function approveMandate() {
    if (missionSubmitting) return;
    setMissionSubmitting(true);
    try {
      if (!spine.missionId) {
        const created = await dataSource.createMission({
          goal: draftGoal,
          selectedContextCardIds: [...selectedWallet],
          freePassage,
        });
        if (!created.ok) {
          reportResult(created, "Mission created");
          return;
        }
      }
      const approved = await dataSource.approveMandate();
      if (reportResult(approved, "Mandate approved")) setStage("active");
    } finally {
      setMissionSubmitting(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitScopedInstruction();
    }
  }

  function submitScopedInstruction() {
    setNotice(
      mention
        ? `Representative redirect recorded for @${mention}`
        : "Representative instruction recorded",
    );
    setComposerOpen(false);
  }

  /** Every approval decision settles through the seam, fixture or live. */
  async function submitApproval(
    decision: ApprovalDecision,
    note?: string,
    options?: MissionActionOptions,
  ) {
    const result = await dataSource.resolveApproval({ decision, note }, options);
    if (result.ok) {
      if (decision === "accept") {
        setStage("memory");
        setMobileTab("mission");
      } else if (decision === "modify") {
        setMention("Lyra");
        setComposerOpen(true);
      } else {
        setStage("active");
      }
    }
    reportResult(
      result,
      decision === "accept"
        ? "Decision accepted"
        : decision === "modify"
          ? "Modification opened in the scoped prompt"
          : "Recommendation rejected",
    );
    return result;
  }

  async function changeNodeState(
    nodeId: string,
    action: NodeControlAction,
    options?: MissionActionOptions,
    /** Preserves each call site's existing fixture stage transition. */
    revertStage: JourneyStage = "planning",
  ) {
    const result = await dataSource.setNodeState({ nodeId, action }, options);
    if (result.ok) {
      setSelectedNode(nodeId);
      if (action === "pause") setPausedNode(nodeId);
      if (action === "resume") setPausedNode(null);
      if (action === "retry") setStage("active");
      if (action === "revert") setStage(revertStage);
    }
    reportResult(result, `${action} recorded for ${nodeId}`);
    return result;
  }

  function acceptApproval() {
    void submitApproval("accept");
  }

  function modifyApproval() {
    void submitApproval("modify");
  }

  useCardeaWebMCP({
    dataMode: dataMode.mode,
    spine,
    stage,
    selectedNodeId: selectedNode ?? "",
    nodes: nodes.map((node) => ({
      id: node.id,
      codename: node.codename,
      role: node.role,
      status: node.status,
    })),
    async createMission(goal, options) {
      const result = await dataSource.createMission({ goal }, options);
      if (result.ok) setStage("planning");
      reportResult(result, `Mission draft created: ${goal.slice(0, 120)}`);
      return result;
    },
    async updateMandate(instruction, options) {
      const result = await dataSource.updateMandate({ instruction }, options);
      if (result.ok) setStage("planning");
      reportResult(result, `Mandate change proposed: ${instruction.slice(0, 120)}`);
      return result;
    },
    async approveMandate(options) {
      const result = await dataSource.approveMandate(options);
      if (result.ok) setStage("planning");
      reportResult(result, "Mandate approved, planning dispatched");
      return result;
    },
    focusNode(nodeId) {
      if (!nodes.some((node) => node.id === nodeId)) return false;
      setSelectedNode(nodeId);
      setExpandedNode(nodeId);
      return true;
    },
    async redirectNode(nodeId, instruction, options) {
      const result = await dataSource.redirectNode({ nodeId, instruction }, options);
      if (result.ok) {
        const node = nodes.find((candidate) => candidate.id === nodeId);
        setSelectedNode(nodeId);
        if (node) setMention(node.codename);
        setComposerOpen(true);
      }
      reportResult(result, `Redirect recorded: ${instruction.slice(0, 120)}`);
      return result;
    },
    setNodeState(nodeId, action, options) {
      return changeNodeState(nodeId, action, options);
    },
    resolveApproval(decision, note, options) {
      return submitApproval(decision, note, options);
    },
    openTakeover(nodeId) {
      if (!nodes.some((node) => node.id === nodeId)) return false;
      setSelectedNode(nodeId);
      setTakeoverNode(nodeId);
      return true;
    },
  });

  return (
    <main
      id="fixture-disclosure"
      className={styles.product}
      data-stage={stage}
      data-theme={theme}
      data-selected={selected.id}
    >
      <div className={styles.desktopShell}>
        <header className={styles.topbar}>
          <a className={styles.brand} href="/canvas" aria-label="Cardea canvas home">
            <img src="/images/cardea/logo-mark.png" alt="" width={256} height={256} className={styles.brandLogo} />
            <span>Cardea</span>
          </a>
          <div className={styles.fixtureDisclosure}>
            <span className={styles.canvasLabel}>Mission workspace</span>
            <span className={styles.disclosureLong}>
              {dataMode.mode === "live"
                ? `Live mission spine · persisted${spine.missionId ? ` · state v${spine.stateVersion ?? "?"}` : ""}`
                : dataMode.notice ?? "Representative preview · no external action"}
            </span>
          </div>
          <div className={styles.topActions}>
            {dataMode.requestedMode === "live" && (
              session.status === "authenticated" ? (
                <button type="button" aria-label="Cardea session is signed in" disabled>
                  <Icon name="spark" />
                  <span>Signed in</span>
                </button>
              ) : (
                <Link href="/signin?next=/canvas" aria-label="Sign in to Cardea">
                  <Icon name="spark" />
                  <span>Sign in</span>
                </Link>
              )
            )}
            <button type="button" aria-label="Mission history">
              <Icon name="history" />
              <span>History</span>
            </button>
            <button
              type="button"
              aria-label="Connections and settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Icon name="settings" />
              <span>Connections</span>
            </button>
            <button
              type="button"
              aria-label="Toggle light and dark canvas material preview"
              onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
            >
              {theme === "dark" ? "☀" : "◐"}
            </button>
          </div>
        </header>

        {stage === "empty" && (
          <section className={styles.opening} aria-labelledby="opening-title">
            <OrbitalMark />
            <p className={styles.humanLine}>Your canvas beyond the prompt.</p>
            <h1 id="opening-title">What should Cardea take on?</h1>
            <form className={styles.openingComposer} onSubmit={handlePrompt}>
              <label className={styles.srOnly} htmlFor="mission-prompt">
                Describe your mission
              </label>
              <textarea id="mission-prompt" name="goal" defaultValue={draftGoal} rows={4} />
              <div className={styles.composerTools}>
                <div>
                  <button type="button" aria-label="Attach a file">+</button>
                  <button type="button" aria-label="Add a context source">@</button>
                  <button type="button" aria-label="Use a command">/</button>
                </div>
                <button type="submit" className={styles.promptSubmit}>
                  Shape the mandate
                  <Icon name="arrow" />
                </button>
              </div>
            </form>
            <span className={styles.openingHint}>Files · sources · voice · context wallet</span>
          </section>
        )}

        {stage === "planning" && (
          <section className={styles.mandateBackdrop} aria-labelledby="mandate-title">
            <div className={styles.mandateSheet}>
              <div className={styles.mandateHeading}>
                <div>
                  <span className={styles.eyebrow}>Cardea mandate · representative</span>
                  <h1 id="mandate-title">Arrive ready for the first day</h1>
                  <p>{draftGoal}</p>
                </div>
                <OrbitalMark compact />
              </div>
              <div className={styles.mandateGrid}>
                <div className={styles.mandateConstraints}>
                  <h2>Boundaries I will hold</h2>
                  <ul>
                    {mission.mandate.constraints.map((constraint) => (
                      <li key={constraint}>
                        <Icon name="check" size={16} />
                        {constraint}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={styles.branchPlan}>
                  <h2>Parallel plan</h2>
                  <div>
                    {mission.mandate.branches.map((branch, index) => (
                      <span key={branch}>
                        <b>{String(index + 1).padStart(2, "0")}</b>
                        {branch}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className={styles.walletSection}>
                <div className={styles.sectionHeading}>
                  <div>
                    <span className={styles.eyebrow}>Suggested context wallet</span>
                    <h2>Carry only what this mission needs</h2>
                  </div>
                  <span>{selectedWallet.size} selected</span>
                </div>
                <div className={styles.walletRow}>
                  {mission.wallet.map((card) => (
                    <WalletCard
                      key={card.id}
                      {...card}
                      selected={selectedWallet.has(card.id)}
                      onClick={() => toggleWallet(card.id)}
                    />
                  ))}
                </div>
              </div>
              <div className={styles.authorityRow}>
                <div>
                  <span className={styles.eyebrow}>Authority</span>
                  <strong>{mission.mandate.approvalBoundary}</strong>
                </div>
                <label className={styles.passageToggle}>
                  <span>
                    <b>Free Passage</b>
                    <small>Off by default. Hard stops always ask.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={freePassage}
                    onChange={(event) => setFreePassage(event.target.checked)}
                  />
                  <i aria-hidden="true" />
                </label>
              </div>
              <div className={styles.mandateFooter}>
                <button type="button" className={styles.secondaryButton} onClick={returnToPrompt}>
                  Revise prompt
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void approveMandate()}
                  disabled={missionSubmitting}
                >
                  {missionSubmitting ? "Starting mission…" : "Approve the mandate"}
                  <Icon name="arrow" />
                </button>
              </div>
            </div>
          </section>
        )}

        {isMissionStage && (
          <section className={styles.canvasViewport} aria-label="Relocation mission canvas">
            <div className={styles.breadcrumbs} aria-label="Canvas breadcrumb">
              <span>Relocation mission</span>
              <b>/</b>
              <span>{selected.role}</span>
              <b>/</b>
              <strong>{selected.codename}</strong>
            </div>

            {stage === "approval" && (
              <button
                type="button"
                className={styles.needsYouCapsule}
                onClick={() => setActivityOpen(true)}
              >
                <OrbitalMark compact />
                <span>
                  <small>Cardea Needs You</small>
                  Choose the alternate apartment
                </span>
                <b>1</b>
              </button>
            )}

            {(stage === "error" || stage === "approval") && (
              <div className={styles.rerouteNotice} role="status">
                <Icon name="route" />
                <span>
                  <b>Dependency rerouted</b>
                  Travel, home, utilities, and budget now follow Candidate B.
                </span>
              </div>
            )}

            <aside className={styles.toolbar} aria-label="Canvas tools">
              <button
                type="button"
                className={focusMode ? styles.toolActive : ""}
                aria-pressed={focusMode}
                onClick={() => setFocusMode((value) => !value)}
                data-tooltip="Focus (F)"
              >
                <Icon name="focus" />
              </button>
              <button
                type="button"
                className={memoryOpen || stage === "memory" ? styles.toolActive : ""}
                aria-pressed={memoryOpen || stage === "memory"}
                onClick={() => setMemoryOpen((value) => !value)}
                data-tooltip="Memory"
              >
                <Icon name="memory" />
              </button>
              <button
                type="button"
                className={activityOpen ? styles.toolActive : ""}
                aria-pressed={activityOpen}
                onClick={() => setActivityOpen((value) => !value)}
                data-tooltip="Activity"
              >
                <Icon name="spark" />
              </button>
              <button
                type="button"
                className={companionOpen ? styles.toolActive : ""}
                aria-pressed={companionOpen}
                onClick={() => setCompanionOpen((value) => !value)}
                data-tooltip="Companion origin"
              >
                <Icon name="companion" />
              </button>
              <button
                type="button"
                className={shopifyOpen ? styles.toolActive : ""}
                aria-pressed={shopifyOpen}
                onClick={() => setShopifyOpen((value) => !value)}
                data-tooltip="Shopify storefront"
              >
                <Icon name="storefront" />
              </button>
              <span />
              <button type="button" data-tooltip="Fit canvas" onClick={() => setNotice("Canvas fitted to mission")}>⌖</button>
            </aside>

            {stage === "active" && (
              <button
                type="button"
                className={styles.walletStack}
                onClick={() => setWalletOpen(true)}
                aria-label={`Open context wallet, ${selectedWallet.size} cards selected`}
              >
                <span className={styles.walletStackCards} aria-hidden="true">
                  <i>H</i><i>W</i><i>P</i>
                </span>
                <span><b>Context wallet</b><small>{selectedWallet.size} cards in use</small></span>
              </button>
            )}

            <div className={styles.canvasSurface}>
              <svg
                className={styles.connectors}
                viewBox={stage === "active" ? "0 0 1700 900" : "0 0 1200 720"}
                preserveAspectRatio="none"
                role="img"
                aria-label="Mission dependency connectors"
              >
                <title>Root mission branches into seven coordinated work streams</title>
                <defs>
                  <linearGradient id="activePath" x1="0" x2="1">
                    <stop offset="0" stopColor="#445CFF" stopOpacity=".22" />
                    <stop offset=".55" stopColor="#445CFF" />
                    <stop offset="1" stopColor="#FF6B4A" stopOpacity=".7" />
                  </linearGradient>
                </defs>
                {stage === "active" ? (
                  <>
                    <g className={`${styles.basePaths} ${styles.activeBasePaths}`}>
                      <path d="M850 94 C700 104 590 128 450 170" />
                      <path d="M850 94 C860 188 915 275 970 360" />
                      <path d="M850 94 C1080 84 1290 96 1530 140" />
                      <path d="M450 505 C610 565 790 492 970 420" />
                      <path d="M450 505 C300 640 110 730 -120 790" />
                      <path d="M450 505 C575 675 670 800 690 950" />
                      <path d="M970 675 C1090 760 1190 825 1260 950" />
                    </g>
                    <g className={`${styles.pulsePaths} ${styles.activePulsePaths}`}>
                      <path pathLength="1" d="M850 94 C700 104 590 128 450 170" />
                      <path pathLength="1" d="M850 94 C860 188 915 275 970 360" />
                      <path pathLength="1" d="M850 94 C1080 84 1290 96 1530 140" />
                      <path pathLength="1" d="M450 505 C610 565 790 492 970 420" />
                    </g>
                  </>
                ) : (
                  <>
                    <g className={styles.basePaths}>
                      <path d="M600 92 C480 125 310 140 230 190" />
                      <path d="M600 92 C560 120 535 128 500 160" />
                      <path d="M600 92 C700 120 780 140 840 190" />
                      <path d="M230 340 C200 410 160 435 130 500" />
                      <path d="M230 340 C330 405 370 420 405 520" />
                      <path d="M500 340 C600 410 675 420 700 500" />
                      <path d="M840 340 C950 390 1020 410 1040 485" />
                    </g>
                    <g className={styles.pulsePaths}>
                      <path pathLength="1" d="M600 92 C480 125 310 140 230 190" />
                      <path pathLength="1" d="M600 92 C560 120 535 128 500 160" />
                      <path pathLength="1" d="M600 92 C700 120 780 140 840 190" />
                    </g>
                  </>
                )}
                {(stage === "error" || stage === "approval") && (
                  <g className={styles.reroutePaths}>
                    <path pathLength="1" d="M230 340 C300 385 390 395 500 420 C610 445 660 478 700 500" />
                    <path pathLength="1" d="M230 340 C350 390 420 430 405 520" />
                    <path pathLength="1" d="M230 340 C170 395 145 440 130 500" />
                  </g>
                )}
              </svg>

              <article className={styles.rootMission}>
                <div>
                  <OrbitalMark compact />
                  <span className={styles.eyebrow}>Root mission</span>
                </div>
                <h2>Phoenix → San Francisco</h2>
                <p>Ready for the first day, within 10 days and under $8,000.</p>
                <footer>
                  <span>7 branches</span>
                  <span>{stage === "complete" ? "100%" : "52%"} coordinated</span>
                </footer>
              </article>

              {visibleNodes.map((node) => {
                const failed = node.id === "lyra" && (stage === "error" || stage === "approval");
                const nodeStyle = { "--node-x": `${node.x}%`, "--node-y": `${node.y}%` } as CSSProperties;
                return (
                  <article
                    key={node.id}
                    data-node-id={node.id}
                    className={`${styles.browserNode} ${styles[`node_${node.status}`]} ${selectedNode === node.id ? styles.nodeSelected : ""} ${expandedNode === node.id ? styles.nodeExpanded : ""}`}
                    style={nodeStyle}
                  >
                    <button
                      type="button"
                      className={styles.nodeSelect}
                      onClick={() => chooseNode(node)}
                      aria-label={`${focusMode ? "Focus" : "Select"} ${node.codename}, ${node.role}`}
                    >
                      <div className={styles.nodeHeading}>
                        <div>
                          <h3>{node.codename} <span>· {node.role}</span></h3>
                          <p>{node.task}</p>
                        </div>
                        <StatusBadge status={node.status} />
                      </div>
                      <FixturePreview node={node} failed={failed} />
                      <div className={styles.progressTrack} aria-label={`${node.progress}% complete`}>
                        <span style={{ width: `${node.progress}%` }} />
                      </div>
                      <p className={styles.nodeCommentary}>{node.commentary}</p>
                    </button>
                    <div className={styles.nodeFooter}>
                      <button
                        type="button"
                        aria-expanded={expandedNode === node.id}
                        onClick={() => {
                          setSelectedNode(node.id);
                          setExpandedNode((current) => current === node.id ? null : node.id);
                        }}
                      >
                        {expandedNode === node.id ? "Collapse" : "Inspect live work"}
                      </button>
                      {expandedNode === node.id && (
                        <span>Fixture state · {node.progress}% prepared · no external action</span>
                      )}
                    </div>
                    {node.id === "lyra" && stage === "approval" && (
                      <div className={styles.nodeApprovalMirror}>
                        <ApprovalCard compact onAccept={acceptApproval} onModify={modifyApproval} />
                      </div>
                    )}
                  </article>
                );
              })}

              {(stage === "memory" || memoryOpen) && (
                <aside className={styles.memoryCluster} aria-label="Mission memory notes">
                  <div className={styles.memoryLabel}>
                    <Icon name="memory" size={16} />
                    Memory at work
                  </div>
                  {mission.memories.map((memory, index) => (
                    <article key={memory.id} style={{ "--note-index": index } as CSSProperties}>
                      <span>{memoryRefs[memory.id] ? "Saved memory" : index === 0 ? "Proposed memory" : "Mission memory"}</span>
                      {editingMemoryId === memory.id ? (
                        <textarea
                          aria-label={`Edit memory: ${memory.text}`}
                          value={memoryTexts[memory.id] ?? memory.text}
                          onChange={(event) =>
                            setMemoryTexts((current) => ({
                              ...current,
                              [memory.id]: event.target.value.slice(0, 8_000),
                            }))
                          }
                        />
                      ) : (
                        <p>{memoryTexts[memory.id] ?? memory.text}</p>
                      )}
                      <small>{memory.source}</small>
                      <em>{memory.influence}</em>
                      <footer>
                        <button
                          type="button"
                          onClick={() => setEditingMemoryId((current) => current === memory.id ? null : memory.id)}
                        >
                          {editingMemoryId === memory.id ? "Cancel" : "Edit"}
                        </button>
                        <button type="button" disabled={memoryBusy === memory.id} onClick={() => void forgetMemory(memory)}>Forget</button>
                        <button type="button" disabled={memoryBusy === memory.id} onClick={() => void saveMemory(memory)}>
                          {memoryBusy === memory.id ? "Saving…" : memoryRefs[memory.id] ? "Update" : "Save"}
                        </button>
                      </footer>
                    </article>
                  ))}
                </aside>
              )}

              {stage === "complete" && (
                <section className={styles.completionArtifact}>
                  <div className={styles.completionSeal}>
                    <Icon name="check" size={26} />
                  </div>
                  <span className={styles.eyebrow}>Mission artifact · representative</span>
                  <h2>The move is prepared for your handoff.</h2>
                  <p>Seven branches settled into one replayable record. No external action was taken.</p>
                  <div className={styles.completionStats}>
                    <span><b>$7,640</b>planned total</span>
                    <span><b>3</b>decisions recorded</span>
                    <span><b>0</b>bookings or purchases</span>
                  </div>
                  <div className={styles.artifactRows}>
                    <span><Icon name="check" size={15} />Alternate apartment selected in fixture</span>
                    <span><Icon name="check" size={15} />Arrival and delivery windows aligned</span>
                    <span><Icon name="check" size={15} />Reviewable admin and utility drafts prepared</span>
                  </div>
                  <button type="button" className={styles.primaryButton} onClick={returnToPrompt}>Start another mission</button>
                </section>
              )}
            </div>

            <aside className={styles.minimap} aria-label="Canvas minimap">
              <span className={styles.minimapViewport} />
              {nodes.map((node) => <i key={node.id} style={{ left: `${node.x + 7}%`, top: `${node.y + 10}%` }} />)}
            </aside>

            {selectedNode && <div className={styles.selectionControls} aria-label={`Controls for ${selected.codename}`}>
              <span><b>{selected.codename}</b> · {selected.role}</span>
              <button
                data-action="pause"
                type="button"
                onClick={() =>
                  void changeNodeState(
                    selected.id,
                    pausedNode === selected.id ? "resume" : "pause",
                  )
                }
              >
                <Icon name={pausedNode === selected.id ? "play" : "pause"} size={15} />
                {pausedNode === selected.id ? "Resume" : "Pause"}
              </button>
              <button data-action="redirect" type="button" onClick={() => { setMention(selected.codename); setComposerOpen(true); }}>
                <Icon name="route" size={15} />Redirect
              </button>
              <button data-action="retry" type="button" onClick={() => void changeNodeState(selected.id, "retry")}>
                <Icon name="redo" size={15} />Retry
              </button>
              <button data-action="revert" type="button" onClick={() => void changeNodeState(selected.id, "revert", undefined, "active")}>
                <Icon name="history" size={15} />Revert
              </button>
              <button data-action="takeover" type="button" className={styles.takeoverButton} onClick={() => setTakeoverNode(selected.id)}>
                <Icon name="takeover" size={15} />Take over
              </button>
            </div>}

            <div className={`${styles.promptPill} ${composerOpen ? styles.promptExpanded : ""}`}>
              {!composerOpen ? (
                <button type="button" onClick={() => setComposerOpen(true)}>
                  <OrbitalMark compact />
                  {mention ? <span className={styles.mentionChip}>@{mention}</span> : <span>Steer this mission</span>}
                  <kbd>⌘ K</kbd>
                </button>
              ) : (
                <div className={styles.expandedComposer}>
                  <div>
                    {mention && <span className={styles.mentionChip}>@{mention}</span>}
                    <button type="button" onClick={() => setMention(null)} aria-label="Clear focused node">×</button>
                  </div>
                  <label className={styles.srOnly} htmlFor="scoped-prompt">Scoped mission instruction</label>
                  <textarea
                    id="scoped-prompt"
                    autoFocus
                    placeholder={mention ? `Redirect @${mention}…` : "Steer the mission…"}
                    onKeyDown={handleComposerKeyDown}
                  />
                  <footer>
                    <span>@ node · / command · + attach</span>
                    <button type="button" onClick={submitScopedInstruction}>Send</button>
                  </footer>
                </div>
              )}
            </div>

            {activityOpen && (
              <aside className={styles.activityDrawer} aria-label="Mission activity">
                <header>
                  <div>
                    <span className={styles.eyebrow}>Chronological record</span>
                    <h2>Mission activity</h2>
                  </div>
                  <button type="button" aria-label="Close activity" onClick={() => setActivityOpen(false)}><Icon name="close" /></button>
                </header>
                {stage === "approval" && <ApprovalCard onAccept={acceptApproval} onModify={modifyApproval} />}
                <ActivityStream items={activityItems} filter={filter} setFilter={setFilter} />
              </aside>
            )}

            {companionOpen && (
              <CompanionPanel state={companion} onClose={() => setCompanionOpen(false)} />
            )}

            {shopifyOpen && <ShopifyPanel state={shopify} onClose={() => setShopifyOpen(false)} />}

            {walletOpen && (
              <section className={styles.walletOverlay} role="dialog" aria-modal="true" aria-labelledby="wallet-title">
                <button className={styles.walletBackdrop} type="button" aria-label="Close wallet" onClick={() => setWalletOpen(false)} />
                <div className={styles.walletPanel}>
                  <header>
                    <div>
                      <span className={styles.eyebrow}>Context wallet</span>
                      <h2 id="wallet-title">Choose what enters this mission.</h2>
                    </div>
                    <button type="button" aria-label="Close wallet" onClick={() => setWalletOpen(false)}><Icon name="close" /></button>
                  </header>
                  <p>Each pass carries only the memory, connections, authority, and limits you approve.</p>
                  <div className={styles.walletGallery}>
                    {mission.wallet.map((card) => (
                      <WalletCard
                        key={card.id}
                        {...card}
                        selected={selectedWallet.has(card.id)}
                        onClick={() => toggleWallet(card.id)}
                      />
                    ))}
                  </div>
                  <footer>
                    <span>{selectedWallet.size} selected</span>
                    <button type="button" onClick={() => setWalletOpen(false)}>Use these passes</button>
                  </footer>
                </div>
              </section>
            )}
          </section>
        )}

        {takeover && (
          <section className={styles.takeoverOverlay} role="dialog" aria-modal="true" aria-labelledby="takeover-title">
            <div
              className={styles.takeoverPanel}
              style={{ "--takeover-left": `${takeoverSplit}%` } as CSSProperties}
            >
              <header>
                <div>
                  <span className={styles.controlBadge}><Icon name="takeover" size={15} />You are controlling</span>
                  <h2 id="takeover-title">{takeover.codename} · {takeover.role}</h2>
                </div>
                <div>
                  <button type="button" onClick={() => setPausedNode(takeover.id)}><Icon name="pause" size={15} />Pause</button>
                  <button type="button" onClick={() => setPausedNode(null)}><Icon name="play" size={15} />Resume</button>
                  <button type="button" className={styles.returnButton} onClick={() => setTakeoverNode(null)}>Return to Cardea</button>
                </div>
              </header>
              <div className={styles.takeoverGrid}>
                <div className={styles.takeoverBrowser}>
                  <div className={styles.takeoverBrowserBar}>
                    <span className={styles.previewDots}><i /><i /><i /></span>
                    <span>representative.fixture/housing/compare</span>
                    <b>Fixture preview</b>
                  </div>
                  <div className={styles.takeoverPage}>
                    <span className={styles.takeoverDisclosure}>Structured representative state, not a live website</span>
                    <div className={styles.takeoverHero}>
                      <div aria-hidden="true"><i /><i /><i /></div>
                      <section>
                        <span>Candidate B</span>
                        <h3>Light above the city.</h3>
                        <p>Upper floor · 24 minute representative commute · planned move-in $3,180</p>
                        <button type="button" onClick={() => setNotice("Fixture candidate marked for comparison")}>Mark for comparison</button>
                      </section>
                    </div>
                    <div className={styles.takeoverDetails}>
                      <span><b>7 / 8</b>mandate fields matched</span>
                      <span><b>$7,640</b>projected mission total</span>
                      <span><b>0</b>external actions taken</span>
                    </div>
                  </div>
                </div>
                <label className={styles.resizeHandle}>
                  <span className={styles.srOnly}>Resize browser and activity split</span>
                  <input
                    type="range"
                    min="55"
                    max="80"
                    value={takeoverSplit}
                    onChange={(event) => setTakeoverSplit(Number(event.target.value))}
                  />
                  <i aria-hidden="true" />
                </label>
                <aside className={styles.takeoverActivity}>
                  <div className={styles.takeoverActivityHead}>
                    <span className={styles.eyebrow}>Visible activity</span>
                    <h3>What changed</h3>
                  </div>
                  <ActivityStream items={activityItems} filter={filter} setFilter={setFilter} />
                  <div className={styles.takeoverActions}>
                    <button type="button" onClick={() => { setMention(takeover.codename); setComposerOpen(true); setTakeoverNode(null); }}><Icon name="route" size={15} />Redirect</button>
                    <button type="button" onClick={() => setNotice("Safe representative retry completed")}><Icon name="redo" size={15} />Retry</button>
                    <button type="button" onClick={() => { setStage("active"); setTakeoverNode(null); }}><Icon name="history" size={15} />Revert</button>
                  </div>
                </aside>
              </div>
            </div>
          </section>
        )}

        {notice && (
          <div className={styles.toast} role="status">
            <OrbitalMark compact />
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setNotice("")}><Icon name="close" size={15} /></button>
          </div>
        )}
      </div>

      <div className={styles.mobileShell}>
        <header className={styles.mobileHeader}>
          <a href="/canvas" aria-label="Cardea canvas home"><img src="/images/cardea/logo-mark.png" alt="" width={256} height={256} className={styles.brandLogo} /><span>Cardea</span></a>
          <div>
            <button type="button" aria-label="Connections" onClick={() => setSettingsOpen(true)}>
              <Icon name="settings" size={16} />
            </button>
            <button type="button" aria-label="Notifications">◎<b>{stage === "approval" ? 1 : 0}</b></button>
          </div>
        </header>
        <section className={styles.mobileMissionHead}>
          <span className={styles.eyebrow}>
            {dataMode.mode === "live"
              ? "Live mission spine · persisted"
              : "Representative relocation mission"}
          </span>
          <h1>Phoenix → San Francisco</h1>
          <div><span style={{ width: stage === "complete" ? "100%" : "58%" }} /></div>
          <p>{stage === "complete" ? "Mission artifact ready" : "7 branches · 3 active · 1 dependency changed"}</p>
        </section>

        <div className={styles.mobileTabs} role="tablist" aria-label="Mission views">
          <button type="button" role="tab" aria-selected={mobileTab === "mission"} onClick={() => setMobileTab("mission")}>Monitor</button>
          <button type="button" role="tab" aria-selected={mobileTab === "approval"} onClick={() => setMobileTab("approval")}>Needs You {stage === "approval" && <b>1</b>}</button>
          <button type="button" role="tab" aria-selected={mobileTab === "activity"} onClick={() => setMobileTab("activity")}>Activity</button>
        </div>

        <div className={styles.mobileContent}>
          {mobileTab === "mission" && (
            <>
              {(stage === "error" || stage === "approval") && (
                <div className={styles.mobileReroute}>
                  <Icon name="route" />
                  <span><b>Housing changed</b>Four dependent branches rerouted to Candidate B.</span>
                </div>
              )}
              <div className={styles.mobileBranchList}>
                {nodes.map((node) => (
                  <button type="button" key={node.id} onClick={() => { setSelectedNode(node.id); setMention(node.codename); }}>
                    <span className={styles.mobileNodeOrb}>{node.codename.slice(0, 1)}</span>
                    <span><b>{node.codename} · {node.role}</b><small>{node.task}</small></span>
                    <StatusBadge status={node.status} />
                  </button>
                ))}
              </div>
            </>
          )}
          {mobileTab === "approval" && (
            <div className={styles.mobileApprovalView}>
              {stage === "approval" ? (
                <ApprovalCard onAccept={acceptApproval} onModify={modifyApproval} />
              ) : (
                <div className={styles.mobileEmptyState}><Icon name="check" size={24} /><h2>No decisions waiting</h2><p>Cardea will bring consequential choices here.</p></div>
              )}
            </div>
          )}
          {mobileTab === "activity" && <ActivityStream items={activityItems} filter={filter} setFilter={setFilter} />}
        </div>

        <form className={styles.mobileQuickReply} onSubmit={(event) => { event.preventDefault(); setNotice("Representative quick reply recorded"); }}>
          {mention && <span className={styles.mentionChip}>@{mention}</span>}
          <label className={styles.srOnly} htmlFor="mobile-reply">Quick reply</label>
          <input id="mobile-reply" placeholder={mention ? `Redirect @${mention}` : "Quick reply to Cardea"} />
          <button type="submit" aria-label="Send quick reply"><Icon name="arrow" /></button>
        </form>
      </div>

      {settingsOpen && (
        <IntegrationPanel
          missionId={spine.missionId}
          waitingNodeId={waitingNodeId}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}
