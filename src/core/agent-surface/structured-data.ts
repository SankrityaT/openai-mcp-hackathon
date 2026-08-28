/**
 * JSON-LD for the homepage.
 *
 * A `@graph` of three linked nodes rather than one blob: the thing you can use
 * (`SoftwareApplication`), the site it lives on (`WebSite`), and who publishes
 * it (`Organization`). They reference each other by `@id` so a consumer can
 * resolve "who makes this" without guessing.
 *
 * Only claims that are true of the deployed product appear here. Notably there
 * is no `PostalAddress` and no contact email or telephone: Cardea is a
 * hackathon submission with no business address, and publishing a personal
 * email as an organizational contact point is a disclosure decision that is
 * not this module's to make. Schema completeness is not worth a fabricated
 * fact, and the omission is recorded rather than papered over.
 */

import {
  ISSUES_URL,
  REPOSITORY_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  WHEN_TO_USE,
} from "./site";

export type JsonLdGraph = {
  "@context": "https://schema.org";
  "@graph": Record<string, unknown>[];
};

export function homepageJsonLd(origin: string): JsonLdGraph {
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${origin}/#application`,
        name: SITE_NAME,
        alternateName: SITE_TAGLINE,
        description: SITE_DESCRIPTION,
        url: origin,
        applicationCategory: "BusinessApplication",
        // A browser app: no download, no platform-specific build.
        operatingSystem: "Web browser",
        browserRequirements: "Requires JavaScript and a WebMCP-capable browser for agent tools.",
        featureList: [...WHEN_TO_USE],
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        },
        publisher: { "@id": organizationId },
        isPartOf: { "@id": websiteId },
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        url: origin,
        inLanguage: "en",
        publisher: { "@id": organizationId },
      },
      {
        "@type": "Organization",
        "@id": organizationId,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        url: origin,
        logo: {
          "@type": "ImageObject",
          url: `${origin}/images/cardea/logo-mark.png`,
        },
        sameAs: [REPOSITORY_URL],
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "technical support",
            url: ISSUES_URL,
            availableLanguage: ["English"],
          },
        ],
      },
    ],
  };
}

/**
 * Serializes the graph for an inline `<script type="application/ld+json">`.
 *
 * `<` is escaped so no string in the graph can close the script element early;
 * the escape is valid JSON and parses back to the same text.
 */
export function serializeJsonLd(graph: JsonLdGraph): string {
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}
