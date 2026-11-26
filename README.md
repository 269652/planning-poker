# Planning Poker

Realtime Scrum planning poker built with **Next.js 16 + WebSockets**, with **Jira** integration:
import real tickets from a board or sprint, estimate them together, and have the agreed
story points written back to Jira, together with an anonymous summary of the rounds.

* Everyone is connected over a WebSocket and sees changes instantly (joins, who has voted, reveal, next round, results).
* Deck: `0 1 2 3 5 8 13 21 34 55 89 100` plus `?` and `☕` (coffee).
* A ticket can run **multiple rounds** until the team agrees. Every round, its statistics and
  the convergence trend are recorded and visualised.
* Votes are **secret until the host reveals** – hidden votes are never sent to other clients, not just hidden in the UI.

## Quick start

Requires Node.js ≥ 20.9.

```bash
git clone <this repo> && cd planning-poker
npm install
npm run demo        # dev server with a built-in mock Jira board, no credentials needed
```

Open <http://localhost:3000>, create a room, and share the invite link (or the 8-character room code).
Open it in a second browser/profile to play both sides.

### Without the mock (manual tickets only)

```bash
npm run dev         # development, hot reload
```

### Production

```bash
npm run build
npm start           # NODE_ENV=production, serves UI + WebSocket + API on one port
```

### With your real Jira

```bash
cp .env.example .env.local   # then fill in JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
npm run dev
```

Details, required permissions and Server/Data Center setup: [docs/JIRA.md](docs/JIRA.md).

## How a session works

1. The **host** (first person to join; transferable) creates a room, adds tickets manually or imports them
   from a Jira board backlog/sprint, and picks a ticket.
2. Voters pick a card. Others only see *that* you voted, not *what*.
3. The host **reveals**. Statistics appear (min/max, median, mean, spread in card steps, most-voted card).
4. If the team **agrees** (per the room's rule), the host accepts the estimate. If not, the team
   discusses and the host starts the **next round** – as many as needed.
   The host can always set a final value manually (recorded as an *override*).
5. On acceptance the estimate is saved on the ticket; for Jira tickets it is **written back**
   (story points field + a comment summarising the rounds). Failures are shown and can be retried.
6. A finished ticket can be re-estimated (**reopen**); its history is kept.

The exact rules (agreement, convergence score, trends) are specified in [docs/MECHANICS.md](docs/MECHANICS.md).

## Documentation

| Document | Contents |
| --- | --- |
| [docs/MECHANICS.md](docs/MECHANICS.md) | Deck, round lifecycle, agreement rules, statistics, convergence score & trends, roles, persistence |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | WebSocket messages, error codes, HTTP API |
| [docs/JIRA.md](docs/JIRA.md) | Configuration (env vars), Cloud vs Server/DC, which Jira endpoints are used, write-back semantics, security |

## Configuration

All settings are environment variables (also read from `.env.local`); see [`.env.example`](.env.example).
`PORT`, `HOST`, `DATA_DIR` configure the server; the `JIRA_*` variables are documented in [docs/JIRA.md](docs/JIRA.md).

## Project layout

```
server.ts               custom server: Next.js + WebSocket (/ws) + REST (/api) on one port
src/core/               pure domain logic (no I/O): deck, stats, convergence, Room state machine, protocol
src/jira/               Jira gateway: REST client, mock, comment formatter, env config
src/server/             registry (+ persistence), WebSocket hub, HTTP API
src/app, src/components Next.js UI (app router)
src/ui/                 client helpers (socket hook, formatting)
tests/                  vitest suites (domain, Jira client, server integration with real sockets, docs alignment)
docs/                   documentation
```

## Development

```bash
npm test            # all tests (vitest)
npm run typecheck   # tsc --noEmit
```

The project was built test-first: each module began with failing tests (red) before its implementation.
`tests/docs.test.ts` fails if a protocol message, error code, HTTP route, env var or card is missing from the docs,
so change code and docs together.

## Limitations

* Single server instance: rooms live in that process's memory (persisted to `DATA_DIR/rooms.json` so a restart keeps them).
  Horizontal scaling would need a shared store / pub-sub.
* The host role is only transferred by the host (*make host*). If the host's browser storage is lost, nobody else can take over that room — start a new room (an automatic takeover is not implemented).
* Rooms are never pruned automatically; delete `data/rooms.json` to reset.
* No TLS of its own – put it behind a reverse proxy (and make sure it forwards WebSocket upgrades on `/ws`) when exposing it beyond a trusted network.
* Jira credentials are server-wide (one service account / token); see the security notes in [docs/JIRA.md](docs/JIRA.md).
