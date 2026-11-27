# Protocol

The site is static (e.g. GitHub Pages). A room **runs in the host's browser tab** (`src/host/engine.ts`); the host and
the guests exchange messages through a small **WebSocket relay** (`relay/`, deployed to Vercel). The relay keeps no room
state — it only forwards messages — so the room, the votes and the Jira connection stay with the host.

## Transport: the WebSocket relay

* **Connect** – `wss://<relay>/api/relay?room=CODE&role=host&key=SECRET` (host) or `?room=CODE&role=guest` (guest).
  The invite link `https://<site>/room/#ABCD2345` carries only the code (in the URL fragment, never sent to a server).
* **Envelopes** (JSON text frames; the app protocol below travels as a string in `data`):

| Direction | Message | Meaning |
| --- | --- | --- |
| guest → relay | `{ data }` | Forward to the host. |
| relay → guest | `{ type: "host", online }` | The host is (not) connected; on `online: true` the guest (re-)sends `join` with its token. |
| relay → guest | `{ type: "msg", data }` | A message from the host. |
| host → relay | `{ to: peer, data }` | Forward to one guest connection. |
| relay → host | `{ type: "open" | "close", peer }` | A guest connection appeared/disappeared (`peer` = random id per connection). |
| relay → host | `{ type: "msg", peer, data }` | A message from that guest. |
| both | `{ type: "ping" }` → `{ type: "pong" }` | Heartbeat every 25 s (keeps idle connections and the host's presence alive). |
| relay → both | `{ type: "error", message }` | Malformed envelope; the connection stays open. |

* **host key** – a random secret created with the room and kept in the host's browser. The relay stores only its SHA-256
  for the room (30 days after last use); a host connection with another key is closed with `4003`. The same key from a
  newer tab takes over and the older connection is closed with `4009`. Bad parameters are closed with `4400`.
* **Instances** – Vercel may serve the host and a guest from different function instances. By default the relay uses an
  in-memory bus, so a relay instance only knows its own connections: a guest told `{ type: "host", online: false }`
  reconnects after 1.5 s (growing to 10 s) until it lands on the host's instance ("hopping"), and again after the host
  itself reconnects elsewhere. The host key is then only checked per instance. With Redis (optional: a `redis://`/`rediss://`
  URL in `REDIS_URL` or `KV_URL`, e.g. Redis Cloud or Upstash from the Vercel Marketplace) all routing goes through
  Redis pub/sub and no hopping is needed. The health response (`GET /api/relay`) reports `bus` and `instance`.
* **Duration limit** – Vercel closes a WebSocket when the function reaches its `maxDuration` (300 s here; up to 800 s on Pro).
  Both sides reconnect with backoff (0.5 s … 10 s). While the host reconnects, guests see "host offline"; when the host is
  back, every guest re-joins with its token and receives the full state again.
* **The host's own tab** joins its room through an in-memory link with exactly the same app protocol.
* **Privacy** – the relay sees the forwarded messages (TLS protects them in transit). Hidden votes are only ever sent by a
  guest to the host and never forwarded to other guests.
* **Limits** – frames up to 256 KiB; `data` up to 200 KiB. Optional `RELAY_ORIGINS` restricts which sites may connect.

The engine validates every incoming message (size ≤ 64 KiB, strict shapes); invalid input yields a `BAD_MESSAGE` error
and the connection stays open. Guests are untrusted: host-only actions are checked by the engine, and only the
host's browser can reach Jira.

## Messages

Messages are JSON objects with a `type`. The first message must be `join`.

### Participant → host

| `type` | Fields | Who | Effect |
| --- | --- | --- | --- |
| `join` | `roomId`, `name` (≤40), `role?` (`voter`\|`observer`), `token?` | anyone | Joins; with a known `token` resumes the same participant. The first joiner (the host's own tab) is the host. |
| `vote` | `card` (`0…100`, `"?"`, `"coffee"`) | voter | Sets/changes own vote while round is `voting`. |
| `reveal` | – | host | Reveals the round, computes statistics. |
| `nextRound` | – | host | Starts a new round after a reveal. |
| `nextTicket` | – | host | Moves to the next **open** ticket after the current one in list order (wrapping around; skipping an unfinished one is allowed) and opens its round 1. `NO_TICKET` if no other ticket is open. |
| `finalize` | `value?` (numeric card) | host | Accepts the agreed estimate, or overrides with `value`. Starts Jira write-back for Jira tickets. |
| `reopen` | `ticketId` | host | Re-estimates a ticket (new round, history kept). |
| `selectTicket` | `ticketId` | host | Makes it the current ticket (opens round 1 if needed). |
| `removeTicket` | `ticketId` | host | Removes a ticket. |
| `addTicket` | `title`, `description?` | host | Adds a manual ticket. |
| `importJira` | `issueKeys` (1–200 keys like `PROJ-1`) | host | The host's browser fetches the issues from Jira and adds new ones. If no ticket is current, the first imported one is selected. |
| `retryWriteback` | `ticketId` | host | Retries a failed Jira write-back. |
| `setRule` | `rule` (`unanimous`\|`adjacent`) | host | Changes the agreement rule for future reveals. |
| `raiseHand` | `raised` (boolean) | anyone | Raises/lowers your hand (you want to say something). Hands are lowered automatically on a new round or ticket. |
| `chat` | `text` (1–500 chars) | anyone | Posts a message to the room chat. The room keeps the latest 100 messages, and every `state` carries them in `room.chat` (`id`, `authorId`, `name`, `text`, `at`). At most 5 messages per sender every 5 s (`RATE_LIMITED`). Optional `image`: a PNG/JPEG/WebP/GIF data URL of at most 140,000 characters (the app shrinks pasted images to fit); then `text` may be empty. The message gets an `imageId`, and the image itself travels separately as `image`. Text is a small Markdown dialect (bold, italic, strike, code, links, quotes, lists); Jira keys like `BMG-123` render as ticket mentions. |
| `react` | `messageId`, `emoji` | anyone | Toggles your reaction on a chat message (`👍 ❤️ 😆 😮 😢 🎉`); shown in `room.chat[].reactions` as emoji → participant ids. |
| `nudge` | `participantId?` | anyone | Pings connected voters who haven't voted in the open round — everyone, or one participant (who must still have to vote). Each pinged person gets `nudged`; at most one ping per sender every 10 s (`RATE_LIMITED`). |
| `ping` | – | anyone | Keep-alive and heartbeat; answered with `pong`. A connection that has sent a `ping` and then stays silent for 45 s counts as gone (its participant leaves). The app sends one every 15 s. |
| `leave` | – | anyone | The tab is closing: the participant leaves right away (`connected: false`; hidden from the table, not counted as "to vote"). Any later message on the connection, or a new `join` with the token, brings them back. |

### Host → participant

| `type` | Fields | Meaning |
| --- | --- | --- |
| `welcome` | `token`, `you` | Sent once after `join`. Store `token` (secret) to reconnect; `you` is your participant id. |
| `state` | `room` (a `RoomView`) | The full, **personalised** room state, sent to every participant after every change. |
| `error` | `code`, `message` | The request failed; the connection stays open. |
| `pong` | – | Reply to `ping`. |
| `image` | `id`, `data` (data URL) | A chat image: sent to everyone when posted, and to each participant when they join. The host keeps the latest 30 in memory only (not saved with the room), so after the host reloads, older messages show "image no longer available". |
| `nudged` | `from` (name) | Someone is waiting for your vote; the app plays a short chime and shows a toast. Sent only to the pinged people. |

`RoomView` (see `src/core/room.ts`): `id`, `name`, `board` (`{ id, name, type }` or `null`), `rule`, `you`, `hostId`,
`currentTicketId`, `participants[]` (`id`, `name`, `role`, `connected`, `isHost`, `hasVoted`, `handRaised`) and `tickets[]`.
Each ticket has its metadata (`key`, `url`, `issueType`, `jiraStatus`, `currentEstimate`), `estimate`, `resolution`,
`writeback`, `rounds[]` and `convergence`. To keep updates small, only the **current** ticket carries its `description`.
Each round has `voted` (ids), `myVote`, `patterns` and – only once revealed – `votes` and `stats`. Hidden values are never transmitted.
`patterns` maps each voter to a **pattern id**: a fresh random id per voter per round (shown as their procedural card
back). It reveals neither the card nor who picked the same card.

### Error codes

| Code | Meaning |
| --- | --- |
| `BAD_MESSAGE` | Malformed JSON, unknown type or invalid fields. |
| `NOT_JOINED` | A command was sent before `join`. |
| `NOT_FOUND` | Unknown room, ticket or participant. |
| `FORBIDDEN` | Host-only action, or an observer tried to vote. |
| `NO_TICKET` | No ticket is currently selected, or `nextTicket` found no other open ticket. |
| `BAD_PHASE` | Action not allowed in the current round state (e.g. vote after reveal, next round before reveal). |
| `INVALID` | Invalid value (not a deck card, empty name/title, already joined…). |
| `NO_VOTES` | Reveal with no votes. |
| `NO_AGREEMENT` | `finalize` without value, but the round did not agree. |
| `DUPLICATE` | Ticket key already on the board. |
| `RATE_LIMITED` | Too many pings (one `nudge` per sender every 10 seconds) or chat messages (5 per sender every 5 seconds). |
| `JIRA` | The host has no Jira connection (helper not running) or the call to Jira failed (message includes the reason). |
| `INTERNAL` | Unexpected error in the host's engine (logged in the host's browser console). |
