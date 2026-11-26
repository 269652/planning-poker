# Planning Poker

Realtime Scrum planning poker built with **Next.js + WebSockets**, with **Jira** integration:
plan real tickets from a board and have the agreed estimate written back to Jira.

- **Realtime** – every client holds a websocket; all changes are pushed instantly.
- **Deck** – Fibonacci cards `0 1 2 3 5 8 13 21 34 55 89 100`, plus `?` and `☕`.
- **Rounds until agreement** – a ticket can run any number of rounds. Every round (votes, voters, statistics) is recorded, and the app tracks whether the team is *converging* or *diverging*.
- **Honest voting** – other players' cards never leave the server before the reveal.
- **Jira** – import a board or sprint, estimate, and write story points plus a round-by-round comment back on agreement.

## Quick start

Requires Node.js ≥ 20.

```bash
git clone <this repository>
cd planning-poker
npm install
npm run dev          # http://localhost:3000
```

Try the Jira flow without a Jira account (in-memory demo boards):

```bash
JIRA_MODE=mock npm run dev
```

Production:

```bash
npm run build
npm start
```

Open the app, enter a name, **Create room**, then share the invite link with your team
(it also works across your LAN: the server binds `0.0.0.0` by default).

## Using it

1. The creator of a room is the **host**. Only the host controls the flow (select ticket, reveal, new round, accept, Jira import).
2. Add tickets manually or **Import from Jira…** (board → optional sprint → optional JQL).
3. Select a ticket. Everyone picks a card; you can change your pick until the reveal.
4. **Reveal cards.** Statistics (median, average, spread, agreement) and the distribution are shown.
5. No consensus? Discuss and **Start round N**. Repeat – the *Rounds & convergence* panel records every round.
6. On consensus, **Accept**. If the team cannot agree the host may **Force accept** a value (recorded as `forced`).
7. For Jira tickets the estimate and a summary comment are written to Jira (automatically or on demand).

Details of the rules: [docs/ESTIMATION.md](docs/ESTIMATION.md).

## Configuration

Copy `.env.example` to `.env.local`. All settings are optional; without Jira settings the app works with manual tickets.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP/WebSocket port | `3000` |
| `HOST` | Interface to bind | `0.0.0.0` |
| `ALLOWED_ORIGINS` | Extra origins allowed to open the websocket (comma separated) | same host only |
| `JIRA_MODE` | `mock` = in-memory demo Jira | unset |
| `JIRA_BASE_URL` | Jira base URL | – |
| `JIRA_EMAIL` + `JIRA_API_TOKEN` | Jira Cloud credentials (basic auth, REST v3) | – |
| `JIRA_PAT` | Jira Server/Data Center personal access token (bearer, REST v2) | – |
| `JIRA_API_VERSION` | `2` or `3` | `3` for email+token, `2` for PAT |
| `JIRA_STORY_POINTS_FIELD` | Story points custom field id, e.g. `customfield_10016` | auto-detected |
| `JIRA_DEFAULT_JQL` | Filter applied to imports | `statusCategory != Done` |

Setup guide and permissions: [docs/JIRA.md](docs/JIRA.md).

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | Dev server (Next.js dev + websocket) |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit and integration tests (vitest) |
| `npm run typecheck` | TypeScript check |

## Documentation

- [docs/ESTIMATION.md](docs/ESTIMATION.md) – deck, rules, rounds, agreement and convergence maths
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – layers, state machine, security model, limitations
- [docs/PROTOCOL.md](docs/PROTOCOL.md) – websocket messages
- [docs/JIRA.md](docs/JIRA.md) – Jira setup, endpoints used, write-back behaviour

## Known limitations

- Room state lives in server memory: restarting the server ends all sessions (the history of a session is not persisted). Empty rooms are dropped after 6 hours.
- One server process only (no shared state between instances).
- There is no login: anyone with a room link can join. The Jira credentials stay on the server, but any host of a room can browse boards the Jira user can see. Run it inside a trusted network or behind your own auth/proxy.
