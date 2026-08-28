"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "./takeover-panel.module.css";
import { RemoteBrowserNode } from "./remote-browser-node";
import type { CompanionInput, CompanionToolSummary } from "@/webmcp/companion-tools";
import type { CompanionRecord, CompanionToolsState } from "@/webmcp/use-companion-tools";

/**
 * The second human-judgment surface: a full work takeover that hosts the outbound WebMCP
 * companion beside a tool rail. Presentational and props-driven, exactly like `ApprovalCard`.
 * The board supplies `companion` (from `useCompanionTools`) and this component reads it and
 * calls `discover()` / `run()`; it never fetches or subscribes on its own.
 *
 * The companion iframe is deliberately NOT `sandbox`ed: `sandbox` without `allow-same-origin`
 * would place the document in an opaque origin, which breaks the companion's `exposedTo` origin
 * match and defeats the allowlist the whole outbound loop depends on. Isolation instead comes
 * from the origin boundary itself, Cardea's CSP `frame-src`, and the companion's own
 * `frame-ancestors`. Neither side relaxes `document.domain`.
 */

const MAX_RAIL_RECORDS = 6;

type SchemaField = {
  key: string;
  kind: "string" | "integer" | "boolean" | "list";
  required: boolean;
};

/**
 * Read a bounded form shape from a tool's advertised input schema. Replicated from
 * `companion-panel.tsx` on purpose (see FILES YOU OWN): the schema is companion-supplied and
 * therefore untrusted, used only to lay out inputs, never to widen what the adapter transmits.
 */
function readFields(schema: unknown): SchemaField[] {
  if (!schema || typeof schema !== "object") return [];
  const record = schema as { properties?: unknown; required?: unknown };
  if (!record.properties || typeof record.properties !== "object") return [];
  const required = new Set(
    Array.isArray(record.required) ? record.required.filter((key) => typeof key === "string") : [],
  );
  return Object.entries(record.properties as Record<string, unknown>)
    .slice(0, 8)
    .map(([key, definition]) => {
      const type = (definition as { type?: unknown } | null)?.type;
      const kind: SchemaField["kind"] =
        type === "integer" || type === "number"
          ? "integer"
          : type === "boolean"
            ? "boolean"
            : type === "array"
              ? "list"
              : "string";
      return { key: key.slice(0, 80), kind, required: required.has(key) };
    });
}

function discoveryReason(discovery: CompanionToolsState["discovery"]): string {
  switch (discovery.status) {
    case "ready":
      return "";
    case "not-configured":
    case "unsupported":
    case "empty":
    case "error":
      return discovery.reason;
    default:
      return "";
  }
}

function ToolRow({
  tool,
  open,
  busy,
  onToggle,
  onRun,
}: {
  tool: CompanionToolSummary;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onRun: (input: CompanionInput) => void;
}) {
  const fields = useMemo(() => readFields(tool.inputSchema), [tool.inputSchema]);
  const [values, setValues] = useState<Record<string, string>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const input: CompanionInput = {};
    for (const field of fields) {
      const raw = (values[field.key] ?? "").trim();
      if (!raw) continue;
      if (field.kind === "integer") input[field.key] = Number(raw);
      else if (field.kind === "boolean") input[field.key] = raw === "true";
      else if (field.kind === "list") {
        input[field.key] = raw.split(",").map((part) => part.trim()).filter(Boolean);
      } else input[field.key] = raw;
    }
    onRun(input);
  }

  return (
    <li className={styles.tool}>
      <button
        type="button"
        className={styles.toolHead}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className={styles.toolName}>{tool.name}</span>
        <span className={tool.readOnly ? styles.toolRead : styles.toolWrite}>
          {tool.readOnly ? "read" : "write"}
        </span>
      </button>
      {tool.description && <p className={styles.toolDescription}>{tool.description}</p>}
      {open && (
        <form className={styles.toolForm} onSubmit={submit}>
          {fields.length === 0 ? (
            <p className={styles.toolEmpty}>No input</p>
          ) : (
            fields.map((field) => (
              <label key={field.key} className={styles.toolField}>
                <span>
                  {field.key}
                  {field.required ? " *" : ""}
                </span>
                <input
                  type={field.kind === "integer" ? "number" : "text"}
                  value={values[field.key] ?? ""}
                  placeholder={field.kind === "list" ? "comma separated" : field.kind}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              </label>
            ))
          )}
          <button type="submit" className={styles.runButton} disabled={busy}>
            {busy ? "Running…" : "Run"}
          </button>
        </form>
      )}
    </li>
  );
}

function RecordRow({ record }: { record: CompanionRecord }) {
  const { outcome } = record;
  return (
    <li className={styles.record}>
      <div className={styles.recordHead}>
        <span>{record.toolName}</span>
        <span data-ok={outcome.status === "ok" || undefined}>
          {outcome.status === "ok" ? "ok" : outcome.status}
        </span>
      </div>
      {outcome.status === "ok" ? (
        <>
          <p className={styles.recordTelemetry}>
            untrusted evidence · {outcome.evidence.origin} ·{" "}
            {outcome.evidence.digest ? `sha-256 ${outcome.evidence.digest.slice(0, 16)}` : "digest unavailable"}
          </p>
          <p className={styles.recordTelemetry}>
            {record.persistence.persisted
              ? `persisted as evidence.recorded${
                  record.persistence.sequence !== undefined ? ` #${record.persistence.sequence}` : ""
                }`
              : `not persisted · ${record.persistence.reason ?? "no data source"}`}
          </p>
        </>
      ) : (
        <p className={styles.recordTelemetry}>{outcome.reason}</p>
      )}
    </li>
  );
}

/** One recorded step of a node's work, mapped by the board from mission events. */
export type TakeoverWorkRow = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  trust: string;
  at: string;
};

export type TakeoverPanelProps = {
  nodeCodename: string;
  /**
   * Present only when the node genuinely works the outbound WebMCP
   * companion. Every other node opens to its own work record instead;
   * showing the companion store for a calendar or mailbox node would
   * claim work that never touched it.
   */
  companion?: CompanionToolsState | null;
  surfaceLabel?: string;
  objective?: string | null;
  statusLabel?: string | null;
  work?: TakeoverWorkRow[];
  /** The page a web-lookup node read; enables the embedded live browser. */
  liveViewUrl?: string | null;
  /** Mission node id, keying the takeover's own browser session. */
  nodeId?: string;
  onClose: () => void;
};

function WorkRows({ rows }: { rows: TakeoverWorkRow[] }) {
  return (
    <ul className={styles.workList}>
      {rows.map((row) => (
        <li key={row.id} className={styles.workRow}>
          <div className={styles.workRowHead}>
            <span className={styles.workRowTitle}>{row.title}</span>
            <span className={styles.workRowKind}>{row.kind}</span>
          </div>
          {row.detail && <p className={styles.workRowDetail}>{row.detail}</p>}
          <p className={styles.workRowTelemetry}>
            {row.trust} · {new Date(row.at).toLocaleTimeString()}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * The DESIGN.md browser-node anatomy: expanded mode is a split with the live
 * browser on the left and the activity rail (objective, state, tools,
 * evidence) on the right. The left pane is Cardea's real remote browser
 * opened on the page this node read; its own badge carries the honest
 * control claim.
 */
function BrowserBody({
  nodeCodename,
  nodeId,
  url,
  objective,
  statusLabel,
  work,
}: {
  nodeCodename: string;
  nodeId: string;
  url: string;
  objective?: string | null;
  statusLabel?: string | null;
  work?: TakeoverWorkRow[];
}) {
  const rows = work ?? [];
  return (
    <div className={`${styles.body} ${styles.bodyBrowser}`}>
      <section className={styles.left} aria-label="Live browser">
        <RemoteBrowserNode url={url} nodeId={`takeover-${nodeId}`} title={nodeCodename} />
      </section>
      <aside className={styles.right} aria-label="Node activity">
        {statusLabel && <span className={styles.workStatus}>{statusLabel}</span>}
        {objective && <p className={styles.workObjective}>{objective}</p>}
        {rows.length === 0 ? (
          <p className={styles.workEmpty}>
            Nothing recorded yet. Tool runs and evidence land here as the node works.
          </p>
        ) : (
          <WorkRows rows={rows} />
        )}
      </aside>
    </div>
  );
}

function WorkBody({
  surfaceLabel,
  objective,
  statusLabel,
  work,
}: {
  surfaceLabel?: string;
  objective?: string | null;
  statusLabel?: string | null;
  work?: TakeoverWorkRow[];
}) {
  const rows = work ?? [];
  return (
    <div className={styles.body}>
      <section className={styles.workPane} aria-label="Node work record">
        <div className={styles.frameHead}>
          <span>{surfaceLabel ?? "Work record"}</span>
          {statusLabel && <span className={styles.workStatus}>{statusLabel}</span>}
        </div>
        {objective && <p className={styles.workObjective}>{objective}</p>}
        {rows.length === 0 ? (
          <p className={styles.workEmpty}>
            Nothing recorded yet. Tool runs and evidence land here as the node works.
          </p>
        ) : (
          <WorkRows rows={rows} />
        )}
      </section>
    </div>
  );
}

export function TakeoverPanel({
  nodeCodename,
  companion,
  surfaceLabel,
  objective,
  statusLabel,
  work,
  liveViewUrl,
  nodeId,
  onClose,
}: TakeoverPanelProps) {
  const [openTool, setOpenTool] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const headingId = "takeover-title";
  const discovery = companion?.discovery;
  const reason = discovery ? discoveryReason(discovery) : "";
  const canDiscover =
    Boolean(companion?.origin) &&
    (discovery?.status === "empty" || discovery?.status === "error");

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [onClose]);

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const root = panelRef.current;
    if (!root) return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null || element === document.activeElement);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const recent = (companion?.records ?? []).slice(-MAX_RAIL_RECORDS).reverse();

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={trapTab}
      >
        <header className={styles.header}>
          <h2 id={headingId}>{nodeCodename} work surface</h2>
          <button ref={closeRef} type="button" className={styles.closeButton} onClick={onClose} aria-label="Close work surface">
            ×
          </button>
        </header>

        {!companion && liveViewUrl ? (
          <BrowserBody
            nodeCodename={nodeCodename}
            nodeId={nodeId ?? nodeCodename}
            url={liveViewUrl}
            objective={objective}
            statusLabel={statusLabel}
            work={work}
          />
        ) : !companion ? (
          <WorkBody
            surfaceLabel={surfaceLabel}
            objective={objective}
            statusLabel={statusLabel}
            work={work}
          />
        ) : (
          <div className={styles.body}>
            <section className={styles.left} aria-label="Live companion">
              <div className={styles.frameHead}>
                <span>
                  WebMCP · {companion.origin ? new URL(companion.origin).host : "not configured"}
                </span>
              </div>
              <div className={styles.frameShell}>
                {companion.origin ? (
                  <iframe
                    title="Cardea WebMCP companion"
                    src={`${companion.origin}/`}
                    allow="tools; camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className={styles.frameEmpty}>No companion origin is configured.</div>
                )}
              </div>
            </section>

            <aside className={styles.right} aria-label="Tool rail">
              <div className={styles.discoveryRow}>
                <span className={styles.discoveryState} data-status={companion.discovery.status}>
                  {companion.discovery.status}
                </span>
                {canDiscover && (
                  <button type="button" className={styles.discoverButton} onClick={companion.discover}>
                    Discover tools
                  </button>
                )}
              </div>
              {reason && <p className={styles.discoveryReason}>{reason}</p>}

              {companion.tools.length > 0 && (
                <ul className={styles.toolList}>
                  {companion.tools.map((tool) => (
                    <ToolRow
                      key={tool.name}
                      tool={tool}
                      open={openTool === tool.name}
                      busy={companion.busy === tool.name}
                      onToggle={() => setOpenTool((current) => (current === tool.name ? null : tool.name))}
                      onRun={(input) => companion.run(tool.name, input)}
                    />
                  ))}
                </ul>
              )}

              {recent.length > 0 && (
                <div className={styles.records}>
                  <h3 className={styles.recordsLabel}>Recent runs</h3>
                  <ul>
                    {recent.map((record) => (
                      <RecordRow key={record.id} record={record} />
                    ))}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
