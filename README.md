# Planning Poker

Realtime Scrum planning poker that runs **entirely in the browser** — a static site (e.g. GitHub Pages), no server.
Import real tickets from a Jira board, estimate them together, and have the agreed story points written back to Jira
with an anonymous summary of the rounds.

* **The host's browser runs the room.** Everyone else connects to it peer-to-peer over **WebRTC**; the invite link
  (`…/room/#ABCD2345`) contains everything needed to find the host.
* **Only the host needs Jira**: a small local **Jira helper** on the host's computer holds the credentials (from a `.env` file)
  and lets the page talk to Jira. Guests need nothing but the link.
* Deck: `0 1 2 3 5 8 13 21 34 55 89 100` plus `?` and `☕` (coffee).
* A ticket can run **multiple rounds** until the team agrees. Every round, its statistics and the convergence trend
  are recorded and visualised.
* Votes are **secret until the host reveals** – hidden votes never leave the host's browser, not just hidden in the UI.

## Quick start

Requires Node.js ≥ 20.9 to develop; the helper needs Node ≥ 18.

```bash
git clone <this repo> && cd planning-poker
npm install
npm run dev                # http://localhost:3000 — in development you can also create a demo room with fake Jira data
```

To host with your real Jira, create a `.env` (see [`.env.example`](.env.example)) and start the helper in a second terminal:

```bash
npm run jira-helper        # allows http://localhost:3000; for the published site add: -- --origin https://you.github.io
```

Open the start page: it shows whether the helper is connected. Create a room, share the invite link, and open it in a
second browser/profile to play both sides.

### Static build and GitHub Pages

```bash
npm run build              # static export into ./out (set NEXT_PUBLIC_BASE_PATH=/repo-name for a project page)
npm run preview            # serves ./out like GitHub Pages would, on http://localhost:4173
```

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) tests, builds and deploys on every push to `main` or the
current default branch (or manually via *Run workflow*). One-time setup: repository *Settings → Pages → Source: GitHub Actions*.

## How a session works

0. The **start page** explains that hosting needs the local Jira helper, shows its state (and how to start it), and lists
   your sessions grouped by Jira board — rooms you host (stored in this browser) and rooms you joined.
1. The **host** creates a room — bound to a Jira board picked with an autocomplete — then adds tickets manually or imports them:
   from the backlog, a sprint, all open issues of the board (kanban boards), or by **searching** text or an issue key.
   Picked tickets join the session's queue in order; in an idle session the first one starts immediately.
2. Everyone sees the current ticket as a Jira-style issue card (type, key, status, formatted description) in the middle,
   the queue (*Now estimating*, *Up next*, *Estimated*) on the left and the card deck on the right.
   Voters pick a card. Others see *that* you voted, not *what* — but every card value gets its own procedural back for
   the round, so the table shows who picked the **same** card before the reveal. Anyone can **raise a hand** (✋) to ask
   to speak before the team moves on.
3. The host **reveals**. Statistics appear (min/max, median, mean, spread in card steps, most-voted card).
4. If the team **agrees** (per the room's rule), the host accepts the estimate. If not, the team
   discusses and the host starts the **next round** – as many as needed.
   The host can always set a final value manually (recorded as an *override*).
5. On acceptance the estimate is saved on the ticket; for Jira tickets the host's browser **writes it back**
   (story points field + a comment summarising the rounds). Everyone gets a toast when the write-back succeeds or
   fails; failures can be retried. The host then continues with **Next ticket** (or skips ahead) until the queue is empty.
6. A finished ticket can be re-estimated (**reopen**); its history is kept.

The exact rules (agreement, convergence score, trends) are specified in [docs/MECHANICS.md](docs/MECHANICS.md).

## Documentation

| Document | Contents |
| --- | --- |
| [docs/MECHANICS.md](docs/MECHANICS.md) | Deck, round lifecycle, ticket queue, agreement rules, statistics, convergence score & trends, roles, persistence |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | WebRTC transport (PeerJS), messages, error codes |
| [docs/JIRA.md](docs/JIRA.md) | The local Jira helper (`.env`, origins, allowed endpoints), import, write-back, security |

## The living background

Behind the UI lives a slime mould (*Physarum*): ~65,000 agents simulated on the GPU (three.js) that follow each other's
trails and grow vein networks. It treats the UI as bodies — it cannot enter panels, but their edges smell like food, so it
wraps around them and gathers where you work (hovered and focused panels smell stronger). It scrolls with the page.

* **Cursor** – food: the veins reach for it. **Clicks** startle it (agents scatter, then return) and leave food behind.
  **Typing** sends small ripples from the caret. **Cards** send a wave in the card's colour. **Raising a hand** makes it
  reach for that person in the People list.
* **The room's mood** – agreement calms it into long golden veins; a split vote makes it restless and violet; a Jira
  write-back sends a golden shimmer; someone joining makes it sparkle. On its own it drifts slowly between dense
  networks, long veins and dotted swarms.
* It is never still: the veins breathe (swell and glow on a slow rhythm) and the organism keeps changing character.
* It follows the light/dark theme, runs at 30 fps, pauses in hidden tabs, and is skipped without WebGL. With *reduced
  motion* (on Windows: animation effects turned off) it stays alive in a calm mode — softer ripples, no twinkling.
  `?debug` adds a pixel probe to the canvas (`data-organism`).

## Project layout

```
src/core/               pure domain logic: deck, stats, convergence, Room state machine, protocol, room codes
src/host/engine.ts      runs a room in the host's browser (validation, personalised views, Jira import/write-back)
src/net/peer.ts         WebRTC transport (PeerJS): host registration, guest connections, reconnects
src/jira/               Jira REST client (browser), mock (demo/tests), helper client, comment formatter
src/app, src/components Next.js UI (static export)
src/scenes/             the living background: organism (GPU simulation), runtime (DOM, cursor, events), moods
src/ui/                 client helpers (room hook, storage, formatting, queue, toasts, markup, card patterns)
public/jira-helper.mjs  the local Jira helper (dependency-free Node script, also downloadable from the site)
tools/preview.mjs       static preview server for ./out
tests/                  vitest suites (domain, host engine, Jira client, helper, storage, docs alignment)
```

## Development

```bash
npm test            # all tests (vitest)
npm run typecheck   # tsc --noEmit
```

The project was built test-first: each module began with failing tests (red) before its implementation.
`tests/docs.test.ts` fails if a protocol message, error code, env var, card or npm script is missing from the docs,
so change code and docs together.

## Limitations

* The room lives in the host's browser: it is reachable only while the host has it open, and it is lost if the host
  clears the site's data. The host role cannot be handed over.
* WebRTC uses public STUN only (no TURN relay); very restrictive networks can prevent guests from connecting.
* Signaling uses the free public PeerJS server (no uptime guarantee). It sees connection metadata (IP addresses), not room data.
* Jira access requires the helper on the host's machine; it allows only the configured site(s) and the endpoints the app needs.
