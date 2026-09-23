---
paths:
  - "server/playerValue*.ts"
  - "server/leagueRules.ts"
  - "server/contracts.ts"
  - "server/payroll.ts"
  - "server/freeagents.ts"
  - "scripts/player-value-report.ts"
  - "src/pages/Contracts.tsx"
  - "src/pages/Payroll.tsx"
  - "tests/playerValue*.ts"
  - "tests/payrollControl.test.ts"
---

# Player Value: working reminder

This is a router, not the doctrine. The canonical detail is in `docs/DECISIONS.md` D-052 (with D-018, D-023
and D-041 where it applies them), `docs/PLAYER_VALUE.md` (Part 1 boundaries, Part 2 the five concerns, Part 7
compute, Part 8 the consumer migration, Part 9 phases, Part 10 the boundary test, Part 11 the constants) and
`docs/ARCHITECTURE.md` "Subsystem responsibilities" and "Player Rights". `docs/PLAYER_VALUE_RESEARCH.md` (R-1
to R-11) is research evidence, not current doctrine. Where they differ from this file, they win.

Player Value describes and never authorizes: what a player costs, under what control, what he will produce,
what a win is worth and what is left, as bands with their basis. `server/playerValue.ts` is the one entry
point; `playerValueContract.ts` (contract facts), `playerValueControl.ts` (control and cost path) and
`playerValueCalibration.ts` (every constant, stamped) sit behind it. Which phases are built is in
`docs/PROJECT_STATE.md`; check it against the worktree.

- No verdict, rank or single score: never trade, release, extend, sign or promote (D-052, D-004).
- Eligibility (pre-arbitration, arbitration, free agency) is Player Rights' (`evaluateContractControl`,
  owner Q-1). Value attaches a cost to each status and never compares service with a threshold.
- One `LeagueRules` (`leagueRules.ts`). A minor leaguer's contract regime is his parent league's. A missing
  rule, service time or service-year length is `indeterminate`, never 6 / 3 / 172 or zero (D-018).
- A threshold inside the service projection makes that season `indeterminate` and names both sides.
  Super Two follows the owner's ruling (2026-09-22; basis `owner_attested`): the cutoff is computed from the
  export's class as a range, only where the regime as read is MLB's; an overlap is `indeterminate`.
  `has_received_arbitration` is not read.
- Minor-league $0 salaries, and clauses the export does not populate (no-trade, buyout, retained), are
  unknown, never none or $0. An option is shown on both branches.
- Fog of war: ability only through `scoutedEvidence.ts`, never `players_value` (D-017). No philosophy in
  the neutral value, no protection tier, no defensibility.
- Consumers read value through the entry point and migrate one at a time, deleting their `players_value`
  reads in the same change (Part 8). Nothing writes to `league.db`.
- Never ask the owner for an OOTP experiment; an unresolved rule stays `indeterminate` and is documented.

Checks: `tests/playerValueBoundary.test.ts`, `tests/playerValueControl.test.ts`, `tests/playerValueCost.test.ts`;
`npm run value:report` against a real import (read-only with `OOTP_FO_DB_READONLY=1`).
