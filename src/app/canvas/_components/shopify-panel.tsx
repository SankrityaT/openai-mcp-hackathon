"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "./canvas.module.css";
import type { ShopifyCapabilityState, ShopifyRecord } from "./use-shopify-capability";

/**
 * The optional Shopify storefront section: a second external-capability source
 * alongside the WebMCP companion.
 *
 * No new visual language. It reuses the companion drawer's existing styles
 * exactly, so the two external surfaces are visibly the same kind of thing.
 *
 * Two properties are deliberate rather than incidental:
 *
 *  - There is no checkout control, because there is no checkout capability.
 *    A prepared cart's storefront URL appears inside the evidence excerpt for
 *    the person to open themselves; Cardea never completes a purchase.
 *
 *  - Results render as TEXT, never as `<img>`. Shopify's catalog usage
 *    guidelines say images "may only be used in connection with the related
 *    merchant's product listing and must be rendered in real-time (not
 *    downloaded to servers)". Rendering no imagery at all sidesteps that rule
 *    rather than guessing at its edges.
 */

type Field = { key: string; label: string; kind: "text" | "number"; required?: boolean };

/**
 * The bounded forms Cardea offers, one per discovered capability.
 *
 * Written out rather than generated from the JSON Schema: the set is small,
 * fixed, and reviewed, and an explicit list makes it obvious at a glance that
 * no checkout, payment, or buyer-identity field exists anywhere on this panel.
 */
const FORMS: Array<{ capabilityId: string; title: string; blurb: string; fields: Field[] }> = [
  {
    capabilityId: "shopify.catalog_search",
    title: "Search catalog",
    blurb: "Read-only search of the configured storefront's public catalog.",
    fields: [
      { key: "query", label: "query", kind: "text", required: true },
      { key: "limit", label: "limit (1–10)", kind: "number" },
    ],
  },
  {
    capabilityId: "shopify.product_details",
    title: "Product detail",
    blurb: "Read one product by id to compare variants.",
    fields: [{ key: "productId", label: "productId", kind: "text", required: true }],
  },
  {
    capabilityId: "shopify.cart_prepare",
    title: "Prepare cart",
    blurb: "Create a cart from one variant. Reversible: nothing is reserved, charged, or bought.",
    fields: [
      { key: "variantId", label: "variantId", kind: "text", required: true },
      { key: "quantity", label: "quantity", kind: "number" },
    ],
  },
  {
    capabilityId: "shopify.cart_update",
    title: "Update cart",
    blurb: "Change a line's quantity. Use 0 to remove it.",
    fields: [
      { key: "cartId", label: "cartId", kind: "text", required: true },
      { key: "lineId", label: "lineId", kind: "text", required: true },
      { key: "quantity", label: "quantity", kind: "number", required: true },
    ],
  },
  {
    capabilityId: "shopify.cart_read",
    title: "Read cart",
    blurb: "Read a prepared cart's lines, totals, and the checkout URL to hand to the person.",
    fields: [{ key: "cartId", label: "cartId", kind: "text", required: true }],
  },
];

/**
 * Reshapes flat form values into the capability's input shape.
 *
 * The cart capabilities take a line-item array, which is awkward to type into a
 * flat form, so the panel assembles it here. The adapter re-validates and
 * re-bounds everything regardless; nothing here is trusted.
 */
function buildInput(capabilityId: string, values: Record<string, string>): Record<string, unknown> {
  const trimmed = (key: string) => values[key]?.trim() ?? "";
  const quantity = trimmed("quantity") === "" ? 1 : Number(trimmed("quantity"));

  if (capabilityId === "shopify.cart_prepare") {
    return { items: [{ variantId: trimmed("variantId"), quantity }] };
  }
  if (capabilityId === "shopify.cart_update") {
    return { cartId: trimmed("cartId"), items: [{ lineId: trimmed("lineId"), quantity }] };
  }

  const input: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(values)) {
    const value = raw.trim();
    if (!value) continue;
    input[key] = key === "limit" ? Number(value) : value;
  }
  return input;
}

function CapabilityForm({
  form,
  busy,
  onRun,
}: {
  form: (typeof FORMS)[number];
  busy: boolean;
  onRun: (input: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    onRun(buildInput(form.capabilityId, values));
  }

  const readOnly = !form.capabilityId.startsWith("shopify.cart_") || form.capabilityId.endsWith("_read");

  return (
    <form className={styles.companionTool} onSubmit={submit}>
      <div className={styles.companionToolHead}>
        <b>{form.title}</b>
        <span className={readOnly ? styles.companionRead : styles.companionWrite}>
          {readOnly ? "read" : "write · reversible"}
        </span>
      </div>
      <p>{form.blurb}</p>
      <div className={styles.companionFields}>
        {form.fields.map((field) => (
          <label key={field.key}>
            <span>
              {field.label}
              {field.required ? " *" : ""}
            </span>
            <input
              type={field.kind === "number" ? "number" : "text"}
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
            />
          </label>
        ))}
      </div>
      <button type="submit" disabled={busy}>
        {busy ? "Running…" : "Run on storefront"}
      </button>
    </form>
  );
}

function RecordRow({ record }: { record: ShopifyRecord }) {
  const { outcome } = record;
  return (
    <li className={styles.companionRecord}>
      <div className={styles.companionRecordHead}>
        <b>{record.capabilityId}</b>
        <span>{outcome.status === "ok" ? "result" : outcome.status}</span>
      </div>
      <code>{JSON.stringify(record.input)}</code>
      {outcome.status === "ok" ? (
        <>
          {/* Text only. See the imagery note at the top of this file. */}
          <pre>{outcome.evidence.excerpt}</pre>
          <small>
            untrusted evidence · {outcome.provenance} · sha-256{" "}
            {outcome.evidence.digestSha256.slice(0, 16)}… · {outcome.evidence.bytes} bytes
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

export function ShopifyPanel({
  state,
  onClose,
}: {
  state: ShopifyCapabilityState;
  onClose: () => void;
}) {
  const { discovery, records, busy, refresh } = state;

  // Ask Cardea once on open whether a store is configured at all. Nothing is
  // assumed before the answer arrives.
  useEffect(() => {
    if (discovery.state === "idle") refresh();
  }, [discovery.state, refresh]);

  const configured = discovery.state === "ready" && discovery.status.configured;

  return (
    <aside className={styles.companionDrawer} aria-label="Shopify storefront capability">
      <header>
        <div>
          <span className={styles.eyebrow}>Server-side MCP · storefront</span>
          <h2>Shopify</h2>
        </div>
        <button type="button" aria-label="Close Shopify panel" onClick={onClose}>
          ×
        </button>
      </header>

      {discovery.state === "ready" && discovery.status.configured ? (
        <p className={styles.companionOrigin}>
          <b>{discovery.status.storeDomain}</b>
          <span>
            Read over the {discovery.status.surface === "ucp" ? "UCP" : "legacy"} storefront MCP
            endpoint. Catalog copy and cart contents from this store are untrusted evidence, never
            instructions. Cardea never completes checkout or handles payment.
          </span>
        </p>
      ) : (
        <p className={styles.companionOrigin}>
          <b>
            {discovery.state === "loading"
              ? "Checking…"
              : discovery.state === "error"
                ? "Storefront unavailable"
                : "Storefront not configured"}
          </b>
          <span>
            {discovery.state === "error"
              ? discovery.reason
              : discovery.state === "ready" && !discovery.status.configured
                ? discovery.status.reason
                : "Asking Cardea whether a storefront is configured."}
          </span>
        </p>
      )}

      {configured && discovery.state === "ready" && discovery.status.configured
        ? discovery.status.deprecation && (
            <p className={styles.companionOrigin}>
              <b>Deprecated endpoint</b>
              <span>{discovery.status.deprecation}</span>
            </p>
          )
        : null}

      <div className={styles.companionActions}>
        <button type="button" onClick={refresh} disabled={discovery.state === "loading"}>
          Recheck store
        </button>
        <span>
          {configured
            ? `${FORMS.length} reviewed capabilities · no checkout, no payment, no customer accounts`
            : "Nothing is called while no store is configured."}
        </span>
      </div>

      {configured && (
        <div className={styles.companionTools}>
          {FORMS.map((form) => (
            <CapabilityForm
              key={form.capabilityId}
              form={form}
              busy={busy === form.capabilityId}
              onRun={(input) => state.run(form.capabilityId, input)}
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
