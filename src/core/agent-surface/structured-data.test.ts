import assert from "node:assert/strict";
import { test } from "node:test";
import { homepageJsonLd, serializeJsonLd } from "./structured-data";
import { REPOSITORY_URL, SITE_DESCRIPTION, SITE_NAME } from "./site";

const ORIGIN = "https://cardea-two.vercel.app";

function nodeOfType(type: string) {
  const found = homepageJsonLd(ORIGIN)["@graph"].find((entry) => entry["@type"] === type);
  assert.ok(found, `missing ${type} node`);
  return found;
}

test("the graph declares the schema.org context and the three identity nodes", () => {
  const graph = homepageJsonLd(ORIGIN);
  assert.equal(graph["@context"], "https://schema.org");
  assert.deepEqual(
    graph["@graph"].map((entry) => entry["@type"]),
    ["SoftwareApplication", "WebSite", "Organization"],
  );
});

test("every node carries name, description, url, and a resolvable @id", () => {
  for (const type of ["SoftwareApplication", "WebSite", "Organization"]) {
    const node = nodeOfType(type);
    assert.equal(node.name, SITE_NAME);
    assert.equal(node.description, SITE_DESCRIPTION);
    assert.equal(node.url, ORIGIN);
    assert.match(String(node["@id"]), /^https:\/\/.+#.+$/);
  }
});

test("the application and site both resolve to the same publisher by @id", () => {
  const organizationId = nodeOfType("Organization")["@id"];
  assert.deepEqual(nodeOfType("SoftwareApplication").publisher, { "@id": organizationId });
  assert.deepEqual(nodeOfType("WebSite").publisher, { "@id": organizationId });
});

test("the organization carries a logo, sameAs, and a usable contact point", () => {
  const organization = nodeOfType("Organization");
  assert.deepEqual(organization.sameAs, [REPOSITORY_URL]);
  assert.match(String((organization.logo as Record<string, unknown>).url), /logo-mark\.png$/);
  const [contact] = organization.contactPoint as Record<string, unknown>[];
  assert.equal(contact["@type"], "ContactPoint");
  assert.ok(contact.contactType, "a contact point without a contactType is unusable");
  assert.match(String(contact.url), /^https:\/\//);
});

test("no contact detail is invented for a project that has none", () => {
  // Guards the deliberate omission documented in structured-data.ts: a
  // fabricated address or personal email would be worse than an incomplete
  // schema. If real details are ever added, this test is the place to update.
  const serialized = serializeJsonLd(homepageJsonLd(ORIGIN));
  assert.ok(!serialized.includes("PostalAddress"), "no address may be fabricated");
  assert.ok(!serialized.includes("telephone"), "no phone may be fabricated");
  assert.ok(!/"email"/.test(serialized), "no email may be fabricated");
});

test("the application node states it is free rather than leaving price unknown", () => {
  const application = nodeOfType("SoftwareApplication");
  assert.equal(application.isAccessibleForFree, true);
  const offers = application.offers as Record<string, unknown>;
  assert.equal(offers.price, "0");
  assert.equal(offers.priceCurrency, "USD");
});

test("serialization escapes < so no value can close the script element early", () => {
  const serialized = serializeJsonLd(homepageJsonLd(ORIGIN));
  assert.ok(!serialized.includes("<"), "a raw < would allow script breakout");
  assert.deepEqual(JSON.parse(serialized), homepageJsonLd(ORIGIN), "escaping must stay valid JSON");
});

test("the graph is built against the origin it is given", () => {
  const preview = "https://cardea-preview.example.com";
  const serialized = serializeJsonLd(homepageJsonLd(preview));
  assert.ok(serialized.includes(preview));
  assert.ok(!serialized.includes("cardea-two.vercel.app"));
});
