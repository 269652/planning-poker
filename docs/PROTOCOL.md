# Protocol

There is no server. The app is a static site (e.g. GitHub Pages); a room **runs in the host's browser tab**
(`src/host/engine.ts`) and everyone else connects to it peer-to-peer over **WebRTC**.

## Transport

* **Signaling** – [PeerJS](https://peerjs.com) with its free public signaling server. It only brokers the WebRTC handshake
  (session descriptions and network candidates, i.e. IP addresses); no room data passes through it.
* **Finding the host** – the host registers the peer id `ppoker-<CODE>` (e.g. `ppoker-ABCD2345`) derived from the room code,
  so the invite link `https://<site>/room/#ABCD2345` is all a guest needs. The code is in the URL fragment (`/room/#…`),
  which is never sent to the web server, and one static page serves every room.
* **Messages** – JSON over a reliable, encrypted (DTLS) WebRTC **data channel** per guest. Large messages are chunked by PeerJS.
* **The host's own tab** joins its room through an in-memory link with exactly the same protocol.
* **Reconnects** – guests redial with backoff (1 s … 10 s) and re-join with their token. If the host's tab is closed, guests
  see "host offline" and keep retrying. If the host loses the signaling server, open data channels keep working and the
  host re-registers. A second tab hosting the same room is refused (`unavailable-id`) and retries.
* **NAT** – STUN only (no TURN relay). Most home and office networks work; very restrictive networks (symmetric NAT,
  UDP blocked) can prevent a guest from connecting.

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
| `ping` | – | anyone | Keep-alive; answered with `pong`. |

### Host → participant

| `type` | Fields | Meaning |
| --- | --- | --- |
| `welcome` | `token`, `you` | Sent once after `join`. Store `token` (secret) to reconnect; `you` is your participant id. |
| `state` | `room` (a `RoomView`) | The full, **personalised** room state, sent to every participant after every change. |
| `error` | `code`, `message` | The request failed; the connection stays open. |
| `pong` | – | Reply to `ping`. |

`RoomView` (see `src/core/room.ts`): `id`, `name`, `board` (`{ id, name, type }` or `null`), `rule`, `you`, `hostId`,
`currentTicketId`, `participants[]` (`id`, `name`, `role`, `connected`, `isHost`, `hasVoted`, `handRaised`) and `tickets[]`.
Each ticket has its metadata (`key`, `url`, `issueType`, `jiraStatus`, `currentEstimate`), `estimate`, `resolution`,
`writeback`, `rounds[]` and `convergence`. To keep updates small, only the **current** ticket carries its `description`.
Each round has `voted` (ids), `myVote`, `patterns` and – only once revealed – `votes` and `stats`. Hidden values are never transmitted.
`patterns` maps each voter to a **pattern id**: the host assigns a fresh random id per card value per round, so equal cards
share an id (shown as the same procedural card back) while the id reveals nothing about the card.

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
| `JIRA` | The host has no Jira connection (helper not running) or the call to Jira failed (message includes the reason). |
| `INTERNAL` | Unexpected error in the host's engine (logged in the host's browser console). |
