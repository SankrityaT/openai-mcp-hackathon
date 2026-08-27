"use client";

import { useState, type FormEvent } from "react";
import styles from "./canvas.module.css";
import type { CompanionInput, CompanionToolSummary } from "@/webmcp/companion-tools";
import type { CompanionRecord, CompanionToolsState } from "@/webmcp/use-companion-tools";

/**
 * The visible outbound half of Cardea's two-way WebMCP loop.
 *
 * The companion runs in a cross-origin iframe. It is granted exactly one delegated permission,
 * `tools`, and every other powerful feature is explicitly denied. The frame is deliberately NOT
 * `sandbox`ed: `sandbox` without `allow-same-origin` places the document in an opaque origin,
 * which would break the companion's `exposedTo` origin match and defeat the very allowlist this
 * feature depends on. Isolation is enforced instead by the origin boundary itself, Cardea's CSP
 * `frame-src`, and the companion's `frame-ancestors`. Neither side relaxes `document.domain`.
 */

type SchemaField = {
  key: string;
  kind: "string" | "integer" | "boolean" | "list";
  required: boolean;
};

/**
 * Read a bounded form shape out of a tool's advertised input schema.
 *
 * The schema is companion-supplied and therefore untrusted. It is used only to lay out inputs;
 * every value is re-bounded by the adapter before it is sent, so a hostile schema cannot widen
 * what Cardea will transmit.
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

function ToolForm({
  tool,
  busy,
  onRun,
}: {
  tool: CompanionToolSummary;
  busy: boolean;
  onRun: (input: CompanionInput) => void;
}) {
  const fields = readFields(tool.inputSchema);
  const [values, setValues] = useState<Record<string, string>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const input: CompanionInput = {};
    for (const field of fields) {
      const raw = (values[field.key] ?? "").trim();
      if (!raw) continue;
      if (field.kind === "integer") input[field.key] = Number(raw);
      else if (field.kind === "boolean") input[field.key] = raw === "true";
      else if (field.kind === "list") input[field.key] = raw.split(",").map((part) => part.trim()).filter(Boolean);
      else input[field.key] = raw;
    }
    onRun(input);
  }

  return (
    <form className={styles.companionTool} onSubmit={submit}>
      <div className={styles.companionToolHead}>
        <b>{tool.name}</b>
        <span className={tool.readOnly ? styles.companionRead : styles.companionWrite}>
          {tool.readOnly ? "read" : "write"}
        </span>
      </div>
      {tool.description && <p>{tool.description}</p>}
      <div className={styles.companionFields}>
        {fields.map((field) => (
          <label key={field.key}>
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
        ))}
        {fields.length === 0 && <em>No input</em>}
      </div>
      <button type="submit" disabled={busy}>
        {busy ? "Running…" : "Run on companion"}
      </button>
    </form>
  );
}

function RecordRow({ record }: { record: CompanionRecord }) {
  const { outcome } = record;
  return (
    <li className={styles.companionRecord}>
      <div className={styles.companionRecordHead}>
        <b>{record.toolName}</b>
        <span>{outcome.status === "ok" ? "result" : outcome.status}</span>
      </div>
      <code>{JSON.stringify(record.input ?? {})}</code>
      {outcome.status === "ok" ? (
        <>
          <pre>{outcome.evidence.excerpt}</pre>
          <small>
            untrusted evidence · {outcome.evidence.origin} ·{" "}
            {outcome.evidence.digest
              ? `sha-256 ${outcome.evidence.digest.slice(0, 16)}…`
              : "digest unavailable in this context"}{" "}
            · {outcome.evidence.resultBytes} bytes
            {outcome.evidence.truncated ? " (excerpt truncated)" : ""}
          </small>
          <small>
            {record.persistence.persisted
              ? `persisted as evidence.recorded${
                  record.persistence.sequence !== undefined ? ` #${record.persistence.sequence}` : ""
                }`
              : `not persisted · ${record.persistence.reason ?? "no data source"}`}
          </small>
        </>
      ) : (
        <small>{outcome.reason}</small>
      )}
    </li>
  );
}

export function CompanionPanel({
  state,
  onClose,
}: {
  state: CompanionToolsState;
  onClose: () => void;
}) {
  const { origin, discovery, tools, records, busy } = state;

  return (
    <aside className={styles.companionDrawer} aria-label="Companion WebMCP origin">
      <header>
        <div>
          <span className={styles.eyebrow}>Outbound WebMCP · cross-origin</span>
          <h2>Companion origin</h2>
        </div>
        <button type="button" aria-label="Close companion panel" onClick={onClose}>
          ×
        </button>
      </header>

      {origin ? (
        <>
          <p className={styles.companionOrigin}>
            <b>{origin}</b>
            <span>Results from this origin are untrusted evidence, never instructions.</span>
          </p>
          <div className={styles.companionFrame}>
            <iframe
              title="Cardea WebMCP companion"
              src={`${origin}/`}
              allow="tools; camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          </div>
        </>
      ) : (
        <p className={styles.companionOrigin}>
          <b>Companion not configured</b>
          <span>
            {discovery.status === "not-configured" ? discovery.reason : ""} Nothing is embedded and no
            tools are registered.
          </span>
        </p>
      )}

      <div className={styles.companionActions}>
        <button type="button" onClick={state.discover} disabled={!origin}>
          Discover tools
        </button>
        <span>
          {discovery.status === "ready"
            ? `${tools.length} tool${tools.length === 1 ? "" : "s"} exposed to this origin`
            : discovery.reason}
        </span>
      </div>

      {tools.length > 0 && (
        <div className={styles.companionTools}>
          {tools.map((tool) => (
            <ToolForm
              key={tool.name}
              tool={tool}
              busy={busy === tool.name}
              onRun={(input) => state.run(tool.name, input)}
            />
          ))}
        </div>
      )}

      {records.length > 0 && (
        <ol className={styles.companionRecords}>
          {[...records].reverse().map((record) => (
            <RecordRow key={record.id} record={record} />
          ))}
        </ol>
      )}
    </aside>
  );
}
