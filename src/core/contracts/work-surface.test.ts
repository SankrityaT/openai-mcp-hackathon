import assert from "node:assert/strict";
import test from "node:test";
import { deriveWorkSurface } from "./work-surface";
import {
  ASK_USER_CAPABILITY_ID,
  COMPOSIO_PROVIDER_ORIGIN,
  INTERNAL_FIXTURE_CAPABILITY_ID,
  INTERNAL_FIXTURE_ORIGIN,
  WEB_LOOKUP_CAPABILITY_ID,
  WEB_RESEARCH_CAPABILITY_ID,
} from "./safe-capabilities";

test("asking the person is neither a browser nor a webmcp surface", () => {
  // No page was opened, so `live` would be a false claim, and no site handed
  // Cardea any tools, so `webmcp` would be a bigger one.
  const surface = deriveWorkSurface([ASK_USER_CAPABILITY_ID]);
  assert.deepEqual(surface, { kind: "capture", domain: null });
});

test("an ask listed first decides the surface, per the existing list order rule", () => {
  const surface = deriveWorkSurface([ASK_USER_CAPABILITY_ID, WEB_RESEARCH_CAPABILITY_ID]);
  assert.deepEqual(surface, { kind: "capture", domain: null });
});

test("the web lookup capability derives a live capture, never a webmcp claim", () => {
  const surface = deriveWorkSurface([WEB_LOOKUP_CAPABILITY_ID]);
  // It really did open a browser, so `live` is true. It is still a capture:
  // no site handed Cardea structured tools, so `webmcp` would be a lie.
  assert.deepEqual(surface, { kind: "capture", domain: null, live: true });
});

test("a web lookup listed first decides the surface, per the existing list order rule", () => {
  const surface = deriveWorkSurface([WEB_LOOKUP_CAPABILITY_ID, INTERNAL_FIXTURE_CAPABILITY_ID]);
  assert.deepEqual(surface, { kind: "capture", domain: null, live: true });
});

test("the web research capability derives the same live capture as the lookup", () => {
  // It really did open a browser, and it opened several pages, so no single
  // domain can be named. Still a capture: no site handed Cardea any tools.
  const surface = deriveWorkSurface([WEB_RESEARCH_CAPABILITY_ID]);
  assert.deepEqual(surface, { kind: "capture", domain: null, live: true });
});

test("web research listed first decides the surface, per the existing list order rule", () => {
  const surface = deriveWorkSurface([WEB_RESEARCH_CAPABILITY_ID, "composio.gmail_fetch_emails"]);
  assert.deepEqual(surface, { kind: "capture", domain: null, live: true });
});

test("internal fixture capability maps to the internal webmcp surface", () => {
  const surface = deriveWorkSurface([INTERNAL_FIXTURE_CAPABILITY_ID]);
  assert.deepEqual(surface, {
    kind: "webmcp",
    origin: INTERNAL_FIXTURE_ORIGIN,
    label: "internal.cardea.local",
  });
});

test("a composio capability id maps to the composio webmcp surface", () => {
  const surface = deriveWorkSurface(["composio.gmail_fetch_emails"]);
  assert.deepEqual(surface, {
    kind: "webmcp",
    origin: COMPOSIO_PROVIDER_ORIGIN,
    label: "composio.dev",
  });
});

test("a companion capability with a supplied origin maps to that webmcp surface", () => {
  const surface = deriveWorkSurface(["companion.desktop_browser"], "https://companion.local:4173");
  assert.deepEqual(surface, {
    kind: "webmcp",
    origin: "https://companion.local:4173",
    label: "companion.local:4173",
  });
});

test("a companion capability without a supplied origin falls back to capture", () => {
  const surface = deriveWorkSurface(["companion.desktop_browser"]);
  assert.deepEqual(surface, { kind: "capture", domain: null });
});

test("a companion capability with a null origin falls back to capture", () => {
  const surface = deriveWorkSurface(["companion.desktop_browser"], null);
  assert.deepEqual(surface, { kind: "capture", domain: null });
});

test("unknown capability names fall back to capture", () => {
  const surface = deriveWorkSurface(["mystery.unrecognized_tool"]);
  assert.deepEqual(surface, { kind: "capture", domain: null });
});

test("an empty capability list falls back to capture", () => {
  const surface = deriveWorkSurface([]);
  assert.deepEqual(surface, { kind: "capture", domain: null });
});

test("the first recognized capability wins when the list is mixed", () => {
  const surface = deriveWorkSurface([
    "mystery.unrecognized_tool",
    "composio.googlecalendar_find_event",
    INTERNAL_FIXTURE_CAPABILITY_ID,
  ]);
  assert.deepEqual(surface, {
    kind: "webmcp",
    origin: COMPOSIO_PROVIDER_ORIGIN,
    label: "composio.dev",
  });
});

test("a recognized companion capability wins precedence even when it falls back to capture", () => {
  const surface = deriveWorkSurface([
    "companion.desktop_browser",
    "composio.googlecalendar_find_event",
  ]);
  assert.deepEqual(surface, { kind: "capture", domain: null });
});

test("no free text from the model influences the label, only catalogued origins", () => {
  const surface = deriveWorkSurface(["composio.some_future_unlisted_tool"]);
  assert.deepEqual(surface, {
    kind: "webmcp",
    origin: COMPOSIO_PROVIDER_ORIGIN,
    label: "composio.dev",
  });
});
