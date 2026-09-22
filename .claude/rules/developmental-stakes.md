---
paths:
  - "server/developmentFit.ts"
  - "server/developmentalContext.ts"
  - "scripts/stakes-report.ts"
  - "tests/developmentalStakes*.test.ts"
  - "tests/developmentalContext.test.ts"
  - "tests/developmentProtection.test.ts"
---

# Developmental stakes: working reminder

This is a router, not the doctrine. The canonical detail is in `docs/DECISIONS.md` D-050 (with D-018, D-019
and D-044 where it cites them), `docs/ARCHITECTURE.md` "Developmental stakes: the protection tier", and
`docs/DEVELOPMENTAL_STAKES.md` (Part 3 the contract, Part 4 the model and its constants, Part 5 what was built,
Part 9 the hardening). Read the relevant section before changing behavior; where this file and those documents
differ, they win.

The tier is Player Development's answer to one question: how high are the developmental stakes if the
organization mishandles this player? `developmentFit.ts` is the pure model; `developmentalContext.ts` is the one
reader that supplies the objective context and the only way production code obtains a tier. Consumers (the
farm, `org.ts`, `scoutedDevelopment.ts`, MLB Operations' contextual assessment) use the answer and own none of it.

- Stakes, never authorization: not promote, demote, start, call up, trade or release; not a rank, trade value
  or readiness read. `prospectDecision`, `prospectAssignments` and `destinationFit` do not read it (D-050).
- The ceiling is absolute: the organization-visible potential against fixed lines, never a percentile among
  the players around him (Part 4.1).
- Development remaining comes from age, shortened by being behind the league's schedule or a projection
  already realized. Context may only lower the tier; youth is not talent (Part 4.2).
- The one peer population is the ROSTERED players of his own league, for their age (Part 4.3).
- Not inputs: results, usage, roster need, philosophy, another player's rating, development history (D-050).
- Unknown stays unknown: missing ratings or age give `tier: null`; a missing age profile leaves the schedule
  unread and discounts nothing. Pass the age as exported; `knownAge`, never `Number(null)` (Part 4.5, 9).
- No score: the output is the tier, its reasons and the two readings; nothing ranks players by it (Part 4.6).
- One reader per request; a pure consumer (`mlbAssignmentContext.ts`) is handed a `DevelopmentProtection`,
  never the ratings; only the reader calls `evaluateDevelopmentProtection` (Part 4.7).
- Constants are declared once in `developmentFit.ts`, stamped provisional or policy, none calibrated; the
  farm's age-for-level lines stay in `farmCalibration.ts` (Part 4.8).
- Consumers read the tier through their own vocabulary (`hasDevelopmentalStakes` in `playingTime.ts`,
  `PROTECTED_TIERS` in `farmCalibration.ts`, `STAKES_WEIGHT` in `mlbAssignmentContext.ts`); keep it stable (D-050).

Checks: `tests/developmentalStakesBoundary.test.ts`; `npm run stakes:report` against a real import.
