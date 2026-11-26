# Mechanics

This document is the specification of the estimation rules. The implementation lives in
`src/core/` (`deck.ts`, `stats.ts`, `convergence.ts`, `room.ts`) and is covered by tests in `tests/`.

## Deck

| Card | Meaning |
| --- | --- |
| `0 1 2 3 5 8 13 21 34 55 89` | Fibonacci story points |
| `100` | Top of the scale: "epic – split it". **Not** a Fibonacci number (the next one is 144); it is kept so the deck spans the requested 0–100 range. |
| `?` | "I can't estimate this / need more information" |
| `coffee` (☕) | "I need a break" |

The 12 numeric cards form a **scale**. The distance between two cards is measured in **steps** on that scale
(`cardIndex`), not in points: 5 → 8 is 1 step, 1 → 13 is 5 steps, 55 → 100 is 2 steps.
Both `?` and `coffee` are never part of numeric statistics, and **block agreement** (see below).

## Roles

* **Host** – the first participant to join. Controls everything: add/import/remove/select tickets, reveal,
  next round, finalize, reopen, change the rule, retry write-back, promote another host. The host can hand over via *make host*.
* **Voter** – can vote.
* **Observer** – sees everything, cannot vote.

Participants are identified by a secret token stored in the browser, so reloading or reconnecting
restores identity (and a vote already cast in the open round).
There is no automatic host takeover: if the host goes offline, the room waits for them to return (same browser), unless they promoted someone beforehand.

## Round lifecycle

```
select ticket ──► round N: voting ──reveal──► round N: revealed ──┬─ finalize ──► ticket estimated ──reopen──► round N+1: voting
                       ▲                                           │
                       └───────────────── nextRound ◄──────────────┘
```

* Selecting a ticket without rounds opens round 1. Switching to another ticket keeps an unfinished round
  (its votes stay hidden and are kept).
* While `voting`, every voter may change their vote freely. After `revealed`, votes are frozen.
* `reveal` needs at least one vote and does not require all voters to have voted (the host decides).
* `nextRound` is only possible after reveal and appends a new round; earlier rounds are never modified.
* `finalize` is only possible on a revealed round (see *Finalizing*).
* `reopen` clears the estimate and the write-back state of a ticket and starts a new round. All earlier rounds remain in the history.

### What is recorded per round

`number`, who voted and what (visible only after reveal), `startedAt`, `revealedAt`, the **rule in force at reveal time**
and the computed statistics. Changing the rule later does not rewrite the history of earlier rounds.

## Statistics (`analyzeVotes`)

Computed on reveal from the round's votes:

| Field | Definition |
| --- | --- |
| `count`, `numericCount`, `questionCount`, `coffeeCount` | number of all / numeric / `?` / `coffee` votes |
| `min`, `max` | lowest / highest numeric card |
| `mean`, `median` | over numeric votes; median of an even count is the mean of the middle pair |
| `stdDev` | population standard deviation of numeric votes (in points) |
| `spreadSteps` | distance `max` ↔ `min` in **card steps** |
| `modeCard` | most frequent numeric card; ties resolve to the **higher** card (conservative) |
| `modeShare` | share of **all** votes (incl. `?`/☕) on `modeCard`, 0..1 |
| `agreed`, `agreedEstimate` | see below |

With no numeric votes, all numeric fields are `null`.

## Agreement rules

Chosen per room (default `unanimous`), changeable by the host at any time:

| Rule | Agreement when | `agreedEstimate` |
| --- | --- | --- |
| `unanimous` | all votes are the same numeric card (`spreadSteps = 0`) | that card |
| `adjacent` | all votes lie within one card step (`spreadSteps ≤ 1`), e.g. 5 and 8 | the **higher** card (8) |

In both rules a single `?` or `coffee` vote means **no agreement** – someone could not estimate or is not present.
A single voter trivially agrees with themselves. Only votes that were cast count; the host decides whether to wait for the rest before revealing.

## Convergence

*Per-round score* (`convergenceScore`), in [0, 1]:

```
score = modeShare × (1 − spreadSteps / 11)
```

`11` is the widest possible spread (card `0` vs card `100`). It is 1 only when everybody voted the same numeric card,
and 0 when there are no numeric votes. It rewards both a dominant card and a narrow spread.

*Trend across the revealed rounds of a ticket* (`analyzeConvergence`), comparing the last two scores:

| Trend | Condition |
| --- | --- |
| `none` | no revealed round yet |
| `first` | exactly one revealed round, no agreement yet |
| `agreed` | the latest round reached agreement (takes precedence over the others) |
| `converging` | score rose between the last two rounds |
| `diverging` | score fell |
| `stalled` | score unchanged (to within 1e-9) |

Also provided: all per-round `scores` and `spreads`, the last `delta`, and `roundsToAgreement`
(the 1-based round in which agreement happened, otherwise `null`). The UI shows these as a strip plot
(one column per round, dots at the voted cards) with the score underneath.

## Finalizing

`finalize` on a revealed round:

* **without a value** – accepted only if the round agreed; stores `agreedEstimate`, resolution `agreement`.
  Otherwise the error `NO_AGREEMENT` is returned.
* **with a value** – must be a numeric card (never `?`/`coffee`). The facilitator's decision; resolution is
  `override`, unless the value happens to equal the agreed estimate (then `agreement`).

Afterwards the ticket is `estimated`. For Jira tickets the server starts the write-back
(see [JIRA.md](JIRA.md)); the estimate itself is kept even if Jira is unreachable.

## Privacy of votes

The server builds a **personalised view** for each connection. Until reveal, a round exposes only *who* has voted
(`voted`) and the viewer's own card (`myVote`); `votes` and `stats` are `null`. Participant tokens are never part of a view.
The Jira comment lists the vote distribution per round **without names**.

## Persistence

With `DATA_DIR` (default `./data`) rooms are saved to `rooms.json` (debounced, atomic write, file mode 0600 because it contains participant tokens)
and restored at start-up with every participant marked offline.
`GET /api/rooms/:id/export` (host only) returns the complete history without tokens.
