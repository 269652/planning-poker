# WebSocket protocol

Endpoint: `ws(s)://<host>/ws`. JSON text frames, max 64 KiB. Schemas: `src/server/protocol.ts` (validated with zod).
Cross-origin browser upgrades are rejected (403) unless the origin is listed in `ALLOWED_ORIGINS`.

## Identity

The browser generates a secret `clientKey` (≥ 16 chars, kept in `localStorage`) and sends it in `join`.
The server derives the public participant id `sha256(roomId + ":" + clientKey)[0..16]`. Only this hash appears in
views, so seeing an id (for example the host's) does not allow impersonation. Reconnecting with the same key restores
the participant, role and host status. Several tabs with the same key share one participant.

## Client → server

| Message | Fields | Notes |
| --- | --- | --- |
| `join` | `roomId` (`[A-Za-z0-9_-]{3,40}`), `roomName?`, `clientKey`, `name`, `role?` | Must be first. Creates the room if it does not exist; the first participant becomes host. |
| `action` | `action` | See below. |
| `jira` | `reqId`, `op`, … | See below. |
| `ping` | | Answered with `pong`. |

### Actions (`action.type`)

| Type | Fields | Who |
| --- | --- | --- |
| `rename` | `name` | self |
| `setRole` | `role` (`voter`/`observer`), `target?` | self; `target` ≠ self: host |
| `transferHost` | `to` | host |
| `setSettings` | `autoReveal?`, `writeBack?` (`auto`/`manual`) | host |
| `addTicket` | `ticket: { title, key?, description? }` | host (always a *manual* ticket) |
| `removeTicket` / `selectTicket` / `reopen` | `ticketId` | host |
| `vote` | `card` (0…100 Fibonacci, `"?"`, `"coffee"`) | voter |
| `retract` | | voter |
| `reveal` / `revote` / `skip` | | host |
| `accept` | `value?` (required without consensus) | host |

Importing tickets and the internal Jira state transitions (`importTickets`, `jiraWriteStart`, `jiraWriteResult`) are **not** accepted from clients.

### Jira operations (`jira.op`)

| `op` | Fields | Who | `data` |
| --- | --- | --- | --- |
| `status` | | anyone | `{ enabled, mode: "real"\|"mock"\|null, writeBack }` |
| `boards` | `query?` | host | `[{ id, name, type }]` |
| `sprints` | `boardId` | host | `[{ id, name, state }]` |
| `import` | `boardId`, `sprintId?`, `jql?` | host | `{ count }` – tickets appear via `state` |
| `writeBack` | `ticketId` | host | `{}` – write (or retry) the agreed estimate |

## Server → client

| Message | Fields |
| --- | --- |
| `state` | `version`, `view` – the full room projection for *this* client, sent to every client after each change |
| `error` | `code` (`bad_request`, `not_joined`, `forbidden`, `invalid`, `invalid_state`, `no_consensus`, `not_found`, `internal`), `message` – only to the sender |
| `jiraResult` | `reqId`, `ok`, `data?` / `error?` |
| `pong` | |

### `view` and vote secrecy

`view` (`src/core/view.ts`) contains `id, name, you, hostId, settings, participants[], tickets[], currentTicketId`.
While a round is unrevealed, `participants[].hasVoted` is visible to everyone but `participants[].vote` only to its owner,
and the round's `votes`, `voters` and `stats` are `null`. After the reveal everything is included. Per ticket the view carries
`rounds[]` and the computed `convergence`.

## Connection management

Server pings every 30 s and terminates sockets that miss a pong. The client reconnects with exponential backoff (0.5 s → 8 s)
and re-sends `join`, which restores state.
