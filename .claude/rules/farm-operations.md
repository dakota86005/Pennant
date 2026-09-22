---
paths:
  - "server/farm*.ts"
  - "server/playingTime.ts"
  - "server/currentAssignment.ts"
  - "server/clubArrival.ts"
  - "server/minorLeagueRoster.ts"
  - "server/rehabAssignments.ts"
  - "src/pages/MinorLeagueOperations.tsx"
  - "src/pages/farm/**"
  - "scripts/farm-*.ts"
  - "tests/farm*.test.ts"
  - "tests/farmGolden.ts"
---

# Minor League Operations: working reminder

This is a router, not the doctrine. The canonical detail is in `docs/DECISIONS.md` D-044 to D-048 and
D-051, `docs/ARCHITECTURE.md` "Minor League Operations owns placement, playing time and cascades", and
`docs/MINOR_LEAGUE_OPERATIONS.md` (Part 2 the model, Part 3 the MLB contract, Part 7 hardening, Part 8
windowed usage, §9.1 short of work). Read the relevant section before changing behavior; where this file
and those documents differ, they win.

The authority chain is never bypassed: Player Development decides defensibility (`currentAssignment.ts` is
Player Development's question), Philosophy only orders defensible choices afterwards, Player Rights decides
legality, and the farm solves roster, role, playing-time and cascade problems inside all three.

- Defensible, never "promotion earned": results and usage authorize no move (D-044, D-048).
- A league is the peer group, rostered peers only, park-adjusted, with its sample (D-044).
- One man, one job; only a regular blocks; cover is named as ahead and claims nothing (D-047).
- `shortOfWork` (`not_used`, `occasional`) is the one line; `part_time` and `bat_only` are not shortages (D-051).
- Current state says who is here; a departed man is history, never a blocker (D-048).
- A thin window is `unknown`, not unused; a relief window never raises a shortage (D-048).
- Arrivals are dated only through `clubArrival.ts`; no farm module reads the transaction log (D-048).
- Operational and developmental health stay separate; only a shortage is operational (D-045).
- A cascade stops and says where; an unresolved hole is never an illegality (D-045).
- One `FarmSession` per request, never cached across requests; MLB Operations reaches the farm only
  through `mlbEvidence.ts` (D-047).
- Constants live once in `farmCalibration.ts`, stamped, none calibrated; findings are structured data (D-044).
- Unknown baseball evidence stays unknown: never fill in a missing rating, role, arrival date or usage read.

Checks: `tests/farmOperationsBoundary.test.ts`; `npm run farm:base-rate` against a real import.
