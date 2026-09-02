# Demo video script — target 2:40, hard cap 3:00

Built on timings measured against production, not guesses:
mandate opens in seconds, nodes appear ~60-80s after approve, full close 2.5-4.5 min.
**So the mission cannot run in real time inside the video.** Record the full run,
then cut. Every "CUT" below is a real edit, not a pause.

Start already signed in, on `/app`, with a mission already created in a second
tab so you can cut to a finished board if the live one runs slow.

---

## 0:00-0:15 — the thing working, immediately

No title card. No logo. Open on the canvas mid-mission: three node cards, two
live browser tiles showing real IKEA and Zinus pages, the closing bubble visible.

> "This is Cardea. I gave it one sentence, and it opened three browsers, read
> real product pages, and came back with two real prices. Everything you're
> seeing is live."

On-screen text: **13 WebMCP tools · real browsers · human approves**

---

## 0:15-0:50 — the agent driving it (the centerpiece)

Screen: ChatGPT side by side with Cardea. Paste the prompt, do not type it.

> "But I'm not clicking any of this. ChatGPT is."

Paste: *"Find me a queen bed frame under $300 with real prices from two
different stores."*

Show the tool call fire, then Cardea's mandate sheet opening on its own.

> "That's `create_mission`, one of thirteen tools Cardea hands to the agent
> through WebMCP. The agent isn't scraping my screen or guessing which button to
> click. The page handed over its own tools."

CUT. Speed-ramp the planning wait.

---

## 0:50-1:30 — parallel real work

Nodes fan out. Live tiles paint.

> "It planned three branches and ran them at once. Those are real headless
> Chrome sessions on Cloudflare, streamed onto the canvas. I can watch it work,
> and take over any one of them mid-run."

On-screen text: **real pages, not a fixture**

CUT the read time. Land on nodes completed.

---

## 1:30-2:05 — the hinge (the part that matters)

> "Here's the part I care about most."

Show the closing bubble: IKEA SLATTUM $149, Zinus from $289.

> "Two real prices, both under the budget I set. And when it *can't* verify
> something, it says so. On an earlier run, two big retailers served bot walls.
> Cardea refused to invent a recommendation, and told me which sites blocked it."

On-screen text: **it says "I couldn't verify that" instead of making it up**

---

## 2:05-2:35 — authority stays with the human

Show an approval card, then the mandate sheet.

> "Research runs on its own. Anything that spends, sends, or signs stops here,
> with the consequence spelled out. The agent can read this card and relay it to
> me. It cannot decide it for me. That boundary is the product."

If the `requestUserInteraction` browser confirm is available, show it firing.

---

## 2:35-2:50 — close

> "Cardea. You give it a goal, it does the work in the open, and you keep every
> decision that costs something."

On-screen text: **cardea-two.vercel.app**

---

## Recording notes

- Record in short clips per section so one retake doesn't cost the whole take.
- Have a completed mission in a second tab as a safety net.
- Paste all prompts. Never type live.
- Cut every load. Speed-ramp anything over ~3 seconds of nothing.
- No team story, no inspiration, no architecture diagram. That goes in the description.
- Audio must cover what you built and how you used WebMCP. Both are in the lines above.

## Do not claim on camera

- Do not say the agent "can't" approve. Say the decision stays with you, and that
  the browser enforces it where it can. Chrome does not expose that primitive yet.
- Do not show mobile. The wallet is unreachable under 900px.
- Do not imply Composio covers more than Gmail and Calendar.
