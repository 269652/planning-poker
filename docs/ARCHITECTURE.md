# Architecture

```
Browser (React)  ──ws /ws──┐
Browser (React)  ──ws /ws──┼─►  server.ts (Node http)
                           │      ├─ Next.js request handler (pages, assets)
                           │      └─ attachRealtime ─► RoomManager ─► core (pure state machine)
                           │                               └─► JiraGateway ─► Jira REST
```

One Node process serves the Next.js app and the websocket on the same port (`server.ts`).
Next's own upgrade handler (HMR in dev) is kept for every path except `/ws`.

## Layers (dependencies point downwards)

| Layer | Path | Responsibility | Tests |
| --- | --- | --- | --- |
| UI | `src/app`, `src/components`, `src/hooks` | Rendering, `useRoom` websocket hook with auto-reconnect | manual / browser |
| Transport | `src/server/ws.ts` | Upgrade, origin check, heartbeat, payload cap, idle-room sweep | `realtime.test.ts` |
| Orchestration | `src/server/roomManager.ts`, `protocol.ts` | Identity, validation (zod), fan-out of per-client views, Jira write-back, GC | `roomManager.test.ts` |
| Jira | `src/jira/*` | REST client (v2/v3), ADF conversion, gateway + mock | `jira-*.test.ts`, `adf.test.ts`, `gateway.test.ts` |
| Domain | `src/core/*` | Deck, statistics, convergence, room state machine, projections, summary | `deck`, `stats`, `convergence`, `room`, `view`, `summary` tests |

## Domain design

- **Pure state machine** – `applyAction(state, actor, action, now)` returns a new state or throws `RoomError(code)`. It does not mutate input, read the clock, or generate random values (ticket ids are `t1, t2, …`), so every rule is deterministic and unit-testable. See [ESTIMATION.md](ESTIMATION.md).
- **A round is data** – `ticket.rounds[]` holds every round (`votes`, `voters` snapshot, `stats`, timestamps). The in-progress round is the last, unrevealed element; nothing is overwritten, so history and convergence are derived, never stored separately.
- **Projection before transport** – `viewFor(state, clientId)` is the only thing sent to a client and strips unrevealed votes. Full state is pushed after every change (rooms are tiny, so this is simpler and more robust than diffs).
- **System actions** – `jiraWriteStart/Result` are accepted only from the internal `SYSTEM` actor; the protocol schema excludes them, and `importTickets` as well.

## Security model

- Vote secrecy is enforced server-side (projection), not by the UI.
- Identity = hash of a browser-held secret; public ids cannot be replayed.
- Host-only actions are checked in the reducer; Jira operations additionally require the host and a configured gateway.
- Client-created tickets are forced to `source: manual`, so a write-back can only target issues that came from a Jira import.
- Websocket: same-host origin check, 64 KiB frame cap, zod validation of every frame, `maxPayload` closes oversized frames.
- Jira credentials stay in server env; errors are sanitised.
- No authentication or authorisation beyond room links: deploy inside a trusted network or behind an authenticating proxy.

## Operational notes

- State is in memory (`Map<roomId, Room>`); `RoomManager.sweep` drops rooms with nobody connected for 6 h (runs every 10 min). Restart = all rooms gone.
- Single process only. Scaling out would need a shared store and pub/sub for broadcasts.
- Use a reverse proxy that forwards websocket upgrades; set `ALLOWED_ORIGINS` if the public origin differs from the `Host` header the app sees.

## Testing

`npm test` runs vitest. Development followed red-first TDD: each layer's tests were written and observed failing before the implementation.
The realtime test starts a real HTTP server with real `ws` clients.
