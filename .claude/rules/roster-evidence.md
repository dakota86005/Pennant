---
paths:
  - "server/playerState.ts"
  - "server/provenance.ts"
  - "server/transactionLog.ts"
  - "server/transactionHistory.ts"
  - "server/assignmentContext.ts"
  - "server/playerContext.ts"
  - "server/playerStateRoutes.ts"
  - "server/ootpSave.ts"
  - "server/liveLogSnapshot.ts"
  - "server/dataFreshness.ts"
  - "server/dataStatus.ts"
  - "server/rosterStateHistory.ts"
  - "server/playerRights.ts"
  - "server/leagueRules.ts"
  - "server/clubArrival.ts"
  - "server/rehabAssignments.ts"
  - "scripts/rights-experiment.ts"
  - "src/PlayerRights.tsx"
  - "src/AssignmentContext.tsx"
  - "src/DataStatus.tsx"
  - "src/dataStatusModel.ts"
  - "tests/playerState.test.ts"
  - "tests/transactionLog.test.ts"
  - "tests/assignmentContext.test.ts"
  - "tests/ootpSave.test.ts"
  - "tests/liveLogSnapshot.test.ts"
  - "tests/liveLogFixture.ts"
  - "tests/dataFreshness.test.ts"
  - "tests/dataStatusRoutes.test.ts"
  - "tests/rosterStateHistory.test.ts"
  - "tests/playerRights.test.ts"
---

# Roster evidence and rights: working reminder

This is a router, not the doctrine. The canonical detail is in `docs/DECISIONS.md` D-020 (source hierarchy,
three concerns), D-021 (the live log), D-022 (freshness), D-023 (rights) and D-026 (rehab), `docs/ARCHITECTURE.md`
"Roster evidence: state, chronology, and how current they are"; `docs/RIGHTS_RESEARCH.md` (§2 exported rule
inputs, §3 findings) is historical research evidence, not current doctrine. Where they differ from this file, they win.

These are separate layers, not one roster object. Direction: OOTP sources → state / chronology → rights →
operations → GM. Farm and MLB modules consume these answers and never rebuild them; `clubArrival.ts` and
`rehabAssignments.ts` are the farm's shared readers of state against chronology and draw no rights conclusion.

| Layer | Owns | Answers |
|---|---|---|
| Current State | `playerState.ts` (`provenance.ts`) | what the export says is true now |
| Chronology | `transactionLog.ts` via `dataStatus.ts` | what the live log says happened, and when |
| Assignment context | `assignmentContext.ts`, composed in `playerContext.ts` | why he is where he is; no rights |
| Save and live log | `ootpSave.ts`, `liveLogSnapshot.ts` | where the save is; a validated private copy |
| Freshness | `dataFreshness.ts`, `dataStatus.ts` | how current each source is, in game days |
| Snapshots | `rosterStateHistory.ts` (`transactionHistory.ts`) | that state changed; a fallback, never a cause |
| Rights | `playerRights.ts`, `leagueRules.ts` | per action: eligible / ineligible / indeterminate |

- The export wins where it states a fact, and outranks the log about current placement; the log answers only
  chronology; a snapshot never names a transaction or overrides either (D-020).
- Every field carries a provenance and, when unknown, a reason; a missing table, column, row and value are
  four different unknowns. Unrecognised log wording is an `unsupported` event, kept, never interpreted.
- Rehab and an option look identical in the export. Without a current log he is `unattributed`, with
  `ordinaryOption: null`, never assumed optioned (D-020, D-026).
- Rights read state, assignment context, exported league rules, counts and freshness; they open no table, log
  or snapshot. Every reason names its basis; an unobserved rule is `indeterminate`, never an MLB default (D-023).
- A stale export makes every right indeterminate; a lagging log limits only chronology (recall) (D-022, D-023).
- Contract-control eligibility (pre-arbitration, arbitration, free agency) is a right too:
  `evaluateContractControl`, read by Player Value, never re-derived (D-052, Q-1). `leagueRules.ts` is the one
  `LeagueRules`; a minor league's contract regime is its parent's, and a missing rule is never 6 / 3 / 172.
  Super Two is owner-attested (2026-09-22), with its cutoff computed from the export's class (`superTwoCutoffs`).
- The live `temp/text_data.sqlite3` is opened only as `liveLogSnapshot.ts`'s copy, read-only; nothing writes
  to an OOTP file; a missing log means CSV state continues and the log is reported unavailable (D-021).
- Never make progress depend on an owner OOTP experiment; `scripts/rights-experiment.ts` only records one.

Checks: `tests/playerState.test.ts` (snapshots are not read by the state layers), `tests/playerRights.test.ts`
(roster crunch builds no rights of its own).
