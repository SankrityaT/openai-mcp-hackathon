# How people actually decide to buy, and how Cardea's research engine mirrors it

Grounded in consumer-behavior research (sources at the end), written to be
encoded into the planner and the consolidation worker. This is the brain the
discovery engine follows; the search-and-read capability is only its hands.

## The universal shape of a buying decision

1. A need is felt, framed by a situation ("grandma's 60th is next week").
2. A consideration set forms: people do not evaluate the market, they
   evaluate 3 to 5 candidates gathered from search, memory, and word of mouth.
3. Evaluation narrows to 2 or 3 on the factors that category cares about.
4. A risk check precedes commitment: reviews, return policy, warranty,
   refundability, someone else vouching.
5. Choice, then post-purchase reassurance seeking.

Involvement decides how much of this runs. Low-involvement purchases are
habitual and heuristic (acceptable price, familiar brand, strong rating,
done). High-involvement purchases get real research: comparison, specs,
weeks of touchpoints. Involvement rises with price, social visibility, and
the cost of being wrong.

Choice overload is real: more options reduce purchase and satisfaction (the
jam study's 24-versus-6). The engine therefore always converges to a top
pick, a runner-up, and a budget alternative. Never a listicle.

## Category playbooks

### Everyday household goods (low involvement)
- Deciders: acceptable price, rating strength and volume, "just works".
- Engine: one search pass, compare unit price across two or three retailers,
  surface the strongest well-reviewed option and stop. Do not over-research.

### Furniture, appliances, home (high involvement, research-online-buy-offline)
- People research for weeks across 5 to 10 touchpoints; reviews are trusted
  like personal recommendations; most still want to see the thing before
  buying. Deciders: fit and dimensions, style, delivery, returns.
- Engine: multi-source comparison (editorial reviews plus retailer pages),
  spec and dimension extraction, return policy surfaced as a risk reducer,
  and an honest "verify in person" checklist. Cardea prepares the shortlist
  and the questions; the person crosses the threshold.

### Personal care (ingredient-first)
- Deciders in order: price, ingredient quality, effectiveness. Ingredient
  literacy has overtaken brand trust; professional recommendations
  (dermatologist-style sources) outrank influencers, who barely move people.
- Engine: search includes ingredient and skin/need terms; read at least one
  credible editorial or professional source, not only retail pages; surface
  the ingredient story next to the price.

### Work purchases (business buying)
- Deciders: total cost of ownership, not sticker price (majority of buyers
  weigh TCO); warranty and support responsiveness; apples-to-apples specs.
- Engine: build the spec first so options quote against the same bar;
  extract warranty length and support terms; state the 3-year cost picture
  when evidence allows, and say so when it does not.

### Travel and flights
- Deciders: the price-time tradeoff (leisure travelers are price-sensitive,
  schedule quality is the counterweight), total trip cost including bags and
  fees, and timing. Airline pricing weaponizes anchoring and scarcity
  ("2 seats left"), so the engine's job is pressure-hygiene: cross-check an
  aggregator view against direct pricing, name the tradeoff plainly, and
  never repeat urgency language as fact.
- Engine: search aggregate views, read at least two sources, present the
  cheapest-reasonable and the best-schedule options with the tradeoff stated.

### Restaurants and local services (experience goods)
- Deciders: a four-star floor, review RECENCY (most people only trust the
  last three months), photos, and proximity. One bad recent review deters a
  fifth of customers.
- Engine: search "best X near <place the user named>", read review-bearing
  pages, weight recent signals, note proximity to the user's stated area,
  and include what the recent reviews actually say, not just the stars.

## Cross-cutting rules the engine encodes

1. Consideration set of three: top pick, runner-up, budget alternative.
2. Satisfice by default, maximize on request: one clear recommendation with
   reasons; depth available in the evidence, not forced on the person.
3. Risk reducers surfaced every time: returns, warranty, refundability,
   cancellation terms; reversible beats cheap when the gap is small.
4. Anchor hygiene: state the observed price range before the recommendation
   so the first number seen is the market, not one seller's anchor.
5. Recency weighting for experience goods; spec fidelity for considered
   goods; ingredient fidelity for personal care; TCO for work purchases.
6. Source diversity: never conclude from one site; say which sites the
   evidence came from and which refused to be read.
7. Location only from the user's own words, never inferred.
8. The engine researches and prepares; committing money stays behind the
   wallet ceiling and the approval hinge, and checkout belongs to the person.

## How this maps to the mission graph

- The planner classifies the purchase intent into a playbook and plans
  search steps whose queries and extraction targets follow it.
- Research nodes gather; the consolidator receives their recorded evidence
  (dataflow, not recall) and writes the brief in the playbook's output
  shape: price range first, top pick with reasons, runner-up, budget option,
  risk reducers, what to verify yourself, sources.
- Gated writes (calendar hold, email draft) and the live-browser handoff to
  the final purchase page close the loop.

## Sources

- Principles of Marketing (Lumen/BC Open Texts): low- vs high-involvement
  decision processes; https://courses.lumenlearning.com/clinton-marketing/chapter/reading-low-involvement-vs-high-involvement-decisions/
- Schwartz choice-overload literature and the Iyengar–Lepper jam study;
  https://www.gsb.stanford.edu/insights/are-consumers-turned-too-many-choices-not-yet
- Standard Insights, US skincare consumer habits (price 62 percent,
  ingredients 50 percent, effectiveness 46 percent); https://standard-insights.com/insights/us-skincare-and-cosmetics/
- Shell/industry reporting on ingredient-first personal-care buying;
  https://www.shell.com/business-customers/chemicals/resources/consumers-are-more-informed-about-personal-care-ingredients.html
- Porch Group Media and Salsify furniture-journey research (63 percent start
  online, 5 to 10 touchpoints, ROPO); https://porchgroupmedia.com/blog/furniture-marketing-trends-2/
- MarketingCharts and procurement guides on B2B TCO and warranty priorities;
  https://www.marketingcharts.com/industries/business-to-business-38385
- Airline pricing and booking-behavior research (anchoring, scarcity,
  price-sensitivity segmentation); https://www.sciencedirect.com/science/article/abs/pii/S0969699714000842
- BrightLocal and GatherUp local-review research (99 percent consult
  reviews, four-star floor, three-month recency window, photo effects);
  https://www.brightlocal.com/research/local-consumer-review-survey-2020/
