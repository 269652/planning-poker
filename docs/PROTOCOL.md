# Protocol

Everything runs on one port. Next.js serves the UI; this server adds `/ws` (WebSocket) and `/api/*` (JSON).
Types are defined in `src/core/protocol.ts`; the parser validates every incoming message
(size ≤ 64 KiB, strict shapes) and unknown/invalid input yields a `BAD_MESSAGE` error without closing the socket.

## WebSocket `/ws`

Messages are JSON objects with a `type`. The first message must be `join`.

### Client → server

| `type` | Fields | Who | Effect |
| --- | --- | --- | --- |
| `join` | `roomId`, `name` (≤40), `role?` (`voter`\|`observer`), `token?` | anyone | Joins; with a known `token` resumes the same participant. |
| `vote` | `card` (`0…100`, `"?"`, `"coffee"`) | voter | Sets/changes own vote while round is `voting`. |
| `reveal` | – | host | Reveals the round, computes statistics. |
| `nextRound` | – | host | Starts a new round after a reveal. |
| `finalize` | `value?` (numeric card) | host | Accepts the agreed estimate, or overrides with `value`. Starts Jira write-back for Jira tickets. |
| `reopen` | `ticketId` | host | Re-estimates a ticket (new round, history kept). |
| `selectTicket` | `ticketId` | host | Makes it the current ticket (opens round 1 if needed). |
| `removeTicket` | `ticketId` | host | Removes a ticket. |
| `addTicket` | `title`, `description?` | host | Adds a manual ticket. |
| `importJira` | `issueKeys` (1–200 keys like `PROJ-1`) | host | Server fetches the issues from Jira and adds new ones. |
| `retryWriteback` | `ticketId` | host | Retries a failed Jira write-back. |
| `setRule` | `rule` (`unanimous`\|`adjacent`) | host | Changes the agreement rule for future reveals. |
| `promote` | `participantId` | host | Transfers the host role. |
| `ping` | – | anyone | Keep-alive; answered with `pong`. |

### Server → client

| `type` | Fields | Meaning |
| --- | --- | --- |
| `welcome` | `token`, `you` | Sent once after `join`. Store `token` (secret) to reconnect; `you` is your participant id. |
| `state` | `room` (a `RoomView`) | The full, **personalised** room state, sent to every participant after every change. |
| `error` | `code`, `message` | The request failed; the connection stays open. |
| `pong` | – | Reply to `ping`. |

`RoomView` (see `src/core/room.ts`): `id`, `name`, `rule`, `you`, `hostId`, `currentTicketId`, `participants[]`
(`id`, `name`, `role`, `connected`, `isHost`, `hasVoted`) and `tickets[]`. Each ticket has its metadata, `estimate`,
`resolution`, `writeback`, `rounds[]` and `convergence`. Each round has `voted` (ids), `myVote`, and – only once revealed –
`votes` and `stats`. Hidden values are never transmitted.

The browser reconnects with exponential backoff (0.5 s … 8 s) and re-joins with its token.

### Error codes

| Code | Meaning |
| --- | --- |
| `BAD_MESSAGE` | Malformed JSON, unknown type or invalid fields. |
| `NOT_JOINED` | A command was sent before `join`. |
| `NOT_FOUND` | Unknown room, ticket or participant. |
| `FORBIDDEN` | Host-only action, or an observer tried to vote. |
| `NO_TICKET` | No ticket is currently selected. |
| `BAD_PHASE` | Action not allowed in the current round state (e.g. vote after reveal, next round before reveal). |
| `INVALID` | Invalid value (not a deck card, empty name/title, already joined…). |
| `NO_VOTES` | Reveal with no votes. |
| `NO_AGREEMENT` | `finalize` without value, but the round did not agree. |
| `DUPLICATE` | Ticket key already on the board. |
| `JIRA` | Jira is not configured or the call to Jira failed (message includes the reason). |
| `INTERNAL` | Unexpected server error (logged server-side). |

## HTTP API

Responses are JSON. Routes marked *host* require the header `x-participant-token: <token from welcome>` and the caller to be the host
(`401` without a valid token, `403` for non-hosts).

| Route | Auth | Description |
| --- | --- | --- |
| `POST /api/rooms` | – | Body `{ "name": string, "rule"?: "unanimous"\|"adjacent" }` → `201 { id, name }`; `400` without a name. |
| `GET /api/rooms/:id` | – | `{ id, name }` or `404`. |
| `GET /api/rooms/:id/export` | host | Full state with all rounds and votes, without tokens. |
| `GET /api/jira/status` | – | `{ configured: boolean, kind: "jira"\|"mock"\|null }`. |
| `GET /api/rooms/:id/jira/boards` | host | `{ boards: [{ id, name, type }] }`. |
| `GET /api/rooms/:id/jira/boards/:boardId/sprints` | host | `{ sprints: [{ id, name, state }] }` (active and future). |
| `GET /api/rooms/:id/jira/boards/:boardId/issues` | host | `{ issues: [...] }` of the backlog, or of a sprint with `?sprintId=`. |

Jira routes return `503` when Jira is not configured and `502` when Jira itself fails.
