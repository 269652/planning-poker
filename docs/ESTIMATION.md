# Estimation rules and maths

Implemented in `src/core/` (pure TypeScript, no I/O) and covered by `tests/deck.test.ts`,
`stats.test.ts`, `convergence.test.ts`, `room.test.ts`, `view.test.ts`, `summary.test.ts`.

## Deck

`0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 100` – Fibonacci steps up to 89, capped with **100** (instead of 144).
Plus two special cards:

| Card | Meaning | Counts as a vote | Counts as an estimate | Blocks consensus |
| --- | --- | --- | --- | --- |
| `?` | Not enough information | yes | no | yes |
| `coffee` (☕) | I need a break | yes | no | yes |

"Counts as a vote" means the round can be revealed once everyone has played a card.

## Roles

- **Host** – the room creator (transferable). Controls the flow.
- **Voter** – default role; votes.
- **Observer** – never votes and never counts towards consensus (switching to observer discards your current vote).

Eligible voters of a round = voters who are connected **or** who already voted. A voter who disconnected without voting is not awaited.

## Ticket lifecycle

```
pending / skipped --select--> voting --reveal--> revealed --accept--> agreed
                                 ^------revote-------+                  |
                                 ^----------------reopen----------------+
```

- **select** – starts round 1 (or resumes a ticket that was left in progress).
- **reveal** – requires at least one vote; snapshots the eligible voters and computes the round statistics.
- **revote** – on a revealed round opens round *n+1* (history kept); while still voting it only clears the current votes.
- **accept** – on consensus the consensus value is taken (`resolution = consensus`). Without consensus the host must pass a numeric card (`resolution = forced`). With consensus, a different value is rejected.
- **reopen** – turns an agreed ticket back into voting (new round, previous rounds kept, estimate and Jira write state cleared).
- **skip** – parks the ticket; it can be selected again later.

Optional **auto-reveal**: reveal as soon as every eligible voter has voted.

## Round statistics

For each revealed round (`RoundStats`, `src/core/stats.ts`):

- `min`, `max`, `median` (not snapped; the mean of the two middle values for an even count), `mean` – numeric votes only.
- `spreadSteps` – distance between highest and lowest numeric vote **in deck steps** (`3 → 8` is 2 steps, not 5 points).
- `modal` – most frequent numeric card (ties resolve to the higher card); `modalShare` = modal votes ÷ eligible voters.
- `consensus` – every eligible voter voted, every vote is numeric, all identical.
- `suggested` – median snapped to the nearest card (ties up); pre-selected when forcing.
- `agreement` ∈ [0, 1] = `modalShare × (1 − spreadSteps / 11)` (11 = steps between 0 and 100); exactly `1` on consensus, `0` without numeric votes.

## Convergence

`analyzeConvergence` (`src/core/convergence.ts`) looks at the **revealed** rounds of a ticket:

| Trend | Rule |
| --- | --- |
| `none` | no revealed round |
| `agreed` | the latest round is a consensus |
| `first-round` | one round, no consensus – nothing to compare |
| `converging` | spread decreased vs. the previous round; on equal spread, `modalShare` increased |
| `diverging` | spread increased; on equal spread, `modalShare` decreased |
| `steady` | no change (or no numeric votes to compare) |

Per round it also reports `delta` (change in spread vs. the previous round, negative is better) and `agreement`, which drive the chart and table in *Rounds & convergence*.
`roundsToAgreement` is the number of the round that reached consensus.

## Write-back summary

`summarizeTicket` (`src/core/summary.ts`) produces the Jira comment, for example:

```
Planning Poker: 8 story points agreed in 3 rounds (consensus).
Round 1: Ann 2, Ben 13 (spread 6 steps)
Round 2: Ann 5, Ben 8 (spread 1 step)
Round 3: Ann 8, Ben 8 (spread 0 steps)
```

A forced decision reads `(decided by the facilitator without full consensus)`.
