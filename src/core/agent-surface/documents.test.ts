import assert from "node:assert/strict";
import { test } from "node:test";
import { homepageMarkdown, llmsTxt, notFoundMarkdown } from "./documents";
import {
  HERO_SUBHEAD,
  LANDING_NARRATIVE,
  PUBLIC_ROUTES,
  SITE_DESCRIPTION,
  SITE_NAME,
  WEBMCP_TOOLS,
  WHEN_TO_USE,
  WORKING_STACK,
} from "./site";

const ORIGIN = "https://cardea-two.vercel.app";

test("every document starts with a single H1 and ends with one newline", () => {
  for (const body of [homepageMarkdown(ORIGIN), llmsTxt(ORIGIN), notFoundMarkdown(ORIGIN)]) {
    assert.match(body, /^# /, "must open with an H1");
    assert.equal(body.match(/^# /gm)?.length, 1, "exactly one H1");
    assert.ok(body.endsWith("\n"), "must end with a newline");
    assert.ok(!body.endsWith("\n\n"), "must not end with a blank line");
  }
});

test("the homepage markdown mirrors the page copy rather than restating it", () => {
  const body = homepageMarkdown(ORIGIN);
  assert.ok(body.includes(SITE_NAME));
  assert.ok(body.includes(SITE_DESCRIPTION), "the shared description must appear verbatim");
  assert.ok(body.includes(HERO_SUBHEAD), "the shared hero subhead must appear verbatim");
  for (const company of WORKING_STACK) {
    assert.ok(body.includes(company.name), `stack entry missing: ${company.name}`);
    assert.ok(body.includes(company.href), `stack link missing: ${company.name}`);
  }
});

test("the homepage markdown carries the whole landing narrative", () => {
  const body = homepageMarkdown(ORIGIN);
  for (const section of LANDING_NARRATIVE) {
    assert.ok(body.includes(`## ${section.title}`), `missing section: ${section.title}`);
    assert.ok(body.includes(section.body), `missing body for: ${section.title}`);
    for (const item of section.items) {
      assert.ok(body.includes(item.text), `missing item: ${item.lead}`);
    }
  }
});

test("the homepage markdown points agents at the other machine-readable surfaces", () => {
  const body = homepageMarkdown(ORIGIN);
  assert.ok(body.includes(`${ORIGIN}/llms.txt`));
  assert.ok(body.includes(`${ORIGIN}/sitemap.xml`));
});

test("llms.txt carries explicit when-to-use guidance, not marketing copy", () => {
  const body = llmsTxt(ORIGIN);
  assert.match(body, /^## When to use Cardea$/m);
  assert.match(body, /^## When not to use Cardea$/m);
  for (const job of WHEN_TO_USE) {
    assert.ok(body.includes(job), `missing best-fit job: ${job.slice(0, 40)}…`);
  }
});

test("llms.txt tells an agent how to actually call Cardea, naming every real tool", () => {
  const body = llmsTxt(ORIGIN);
  assert.match(body, /^## How an agent calls Cardea$/m);
  assert.ok(body.includes(`${ORIGIN}/app`), "must name the canvas URL");
  assert.match(body, /WebMCP/);
  for (const tool of WEBMCP_TOOLS) {
    assert.ok(body.includes(`\`${tool.name}\``), `missing tool: ${tool.name}`);
    assert.ok(body.includes(tool.description), `missing description for ${tool.name}`);
  }
});

test("llms.txt does not claim an HTTP agent API Cardea does not have", () => {
  const body = llmsTxt(ORIGIN);
  assert.match(body, /no public agent HTTP API/i);
});

test("llms.txt links every public route", () => {
  const body = llmsTxt(ORIGIN);
  for (const route of PUBLIC_ROUTES) {
    const href = `${ORIGIN}${route.path === "/" ? "" : route.path}`;
    assert.ok(body.includes(`(${href})`), `missing route link: ${route.path}`);
  }
});

test("the 404 body is a recovery map, not just a refusal", () => {
  const body = notFoundMarkdown(ORIGIN);
  assert.match(body, /^# 404 Not Found$/m);
  assert.match(body, /^## Where to look next$/m);
  assert.ok(body.includes(`${ORIGIN}/llms.txt`));
  assert.ok(body.includes(`${ORIGIN}/sitemap.xml`));
  for (const route of PUBLIC_ROUTES) {
    const href = `${ORIGIN}${route.path === "/" ? "" : route.path}`;
    assert.ok(body.includes(`(${href})`), `missing route link: ${route.path}`);
  }
});

test("documents are built against the origin they are given, not a hardcoded host", () => {
  const preview = "https://cardea-preview.example.com";
  for (const body of [homepageMarkdown(preview), llmsTxt(preview), notFoundMarkdown(preview)]) {
    assert.ok(body.includes(preview), "must use the supplied origin");
    assert.ok(!body.includes("cardea-two.vercel.app"), "must not hardcode production");
  }
});

test("the homepage markdown clears the 500-character bar agents are scored against", () => {
  assert.ok(homepageMarkdown(ORIGIN).length > 500);
});
