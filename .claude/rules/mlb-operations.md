---
paths:
  - "server/mlbEvidence.ts"
  - "server/mlbExplain.ts"
  - "server/mlbNeeds.ts"
  - "server/mlbOperations.ts"
  - "server/mlbPlans.ts"
  - "server/mlbReport.ts"
  - "server/mlbResponses.ts"
  - "server/mlbReview.ts"
  - "server/mlbRoster.ts"
  - "server/roleReview.ts"
  - "server/roleStandards.ts"
  - "server/roleStanding.ts"
  - "server/platoon.ts"
  - "server/lineupPicture.ts"
  - "server/lineupShifts.ts"
  - "server/resultsEvidence.ts"
  - "server/benchReview.ts"
  - "server/bullpenRoles.ts"
  - "server/staffPreference.ts"
  - "server/toolsModel.ts"
  - "server/rosterScenario.ts"
  - "server/lineup.ts"
  - "src/pages/Lineup.tsx"
  - "src/pages/MlbOperations.tsx"
  - "src/pages/mlb/**"
  - "scripts/calibrate.ts"
  - "tests/mlb*.ts"
  - "tests/benchReview.test.ts"
  - "tests/bullpenRoles.test.ts"
  - "tests/lineupPicture.test.ts"
  - "tests/lineupShifts.test.ts"
  - "tests/platoon.test.ts"
  - "tests/roleReview.test.ts"
  - "tests/roleStanding.test.ts"
  - "tests/rosterScenario.test.ts"
  - "tests/staffPreference.test.ts"
  - "tests/staffShading.test.ts"
  - "tests/toolsModelProfiles.test.ts"
  - "tests/resultsStress.test.ts"
  - "tests/resultsEvidence.test.ts"
  - "tests/lineup*.test.ts"
  - "tests/fielders.test.ts"
---

# MLB Operations: working reminder

This is a router, not the doctrine. The canonical detail is in `docs/DECISIONS.md` D-024 to D-043,
`docs/ARCHITECTURE.md` "MLB Operations", `docs/MLB_OPERATIONS.md` (§10 static boundaries, §11 AI, §15 to
§30 the build passes), `docs/ROSTER_REVIEW.md` (§2 principles, §4 architecture: the scouting-department layer),
`docs/CALIBRATION.md` and `docs/BEHAVIOR_CASES.md`; `docs/MLB_OPERATIONS_HARDENING.md` is historical rationale.
Read the relevant section before changing behavior; where this file and those documents differ, they win.
`mlbAssignmentContext.ts` is Player Development's (D-025), not this subsystem's; the stakes rule covers it.

MLB Operations coordinates specialists and owns none of their answers: Player State says who is available,
Player Rights says what is legal, Player Development says what is defensible per context, Minor League
Operations says what the farm feels (only through `mlbEvidence.ts`), philosophy shades advice afterwards.
The pure core (`mlbRoster`, `mlbNeeds`, `mlbResponses`) opens no table; it takes ports.

- Needs come from the current export, never snapshot differences; a cause is stated or absent (D-024).
- Stages stay visible; no rank, no hidden score; `unassessed` and incomplete are never a pass (D-024, D-018).
- Compose Rights' component actions; the active spot and the 40-man spot are separate (D-028); invent no right.
- An unknown duration is not assumed; `context_dependent` is a result (D-027). IL rules only as observed (D-029).
- A finding is a flag with two lenses and a working estimate shown with its parts, never a trigger (D-031).
- A hitter is bat plus REVEALED glove at his position; an unseen grade is never read or assumed (D-033).
- Concern is against the role's standard, shown; peers are major leaguers only (D-039, D-040).
- Ratings only through `scoutedEvidence.ts`; approved families are D-017 and D-035, nothing else.
- Philosophy and season: urgency, bar, tie-breaks, order, wording, after validity, each lean shown (D-036).
- Constants declared once, stamped calibrated / provisional / policy; policy is never fitted (D-037, D-041).
- Bench is functions and cover quality; the pen is read whole; views own one question (D-042, D-043).
- The Lineup page (`lineup.ts`, phase 6d) reads bats and gloves only through `scoutedEvidence.ts`: the bat is the tools
  model on his split grades against the hand (his overall grades where the export has none, said), in tenths of a wOBA
  point (`BAT_POINTS_PER_WOBA`, a unit, not a fit); the solver and its glove weight are unchanged; an ungraded bat is
  named and never ranked (D-018). It is in the evidence boundary's guarded list.

Checks: `tests/mlbOperationsBoundary.test.ts`, `tests/evidenceBoundary.test.ts`; `npm run calibrate` only for a
calibrated (never a policy) constant.
