# Pennant documentation

Start with the four durable documents, then the subsystem document for the area you are changing.

## Authoritative and current

| Document | What it is for |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System boundaries, data flow and subsystem responsibilities. Read before changing code. |
| [DECISIONS.md](DECISIONS.md) | Durable product, evidence and design decisions (D-001 …). Add one when an accepted boundary changes. |
| [ROADMAP.md](ROADMAP.md) | What exists as a foundation, what is next, and what is deliberately not planned. |
| [PROJECT_STATE.md](PROJECT_STATE.md) | A point-in-time implementation inventory and known gaps. Verify against the worktree. |
| [MLB_OPERATIONS.md](MLB_OPERATIONS.md) | MLB Operations: design, the audit of the superseded branch, and the build log. |
| [MINOR_LEAGUE_OPERATIONS.md](MINOR_LEAGUE_OPERATIONS.md) | Minor League Operations: audit, rebuild, hardening, windowed usage. |
| [DEVELOPMENTAL_STAKES.md](DEVELOPMENTAL_STAKES.md) | Player Development's protection tier: what it means, the audit of the model it replaced, the stakes model and its validation (D-050). |
| [PLAYER_VALUE.md](PLAYER_VALUE.md) | Player Value: contracts, control, cost, expected production, club finances and surplus. Design only, D-052 (phase 0); nothing in it is implemented yet. |
| [ROSTER_REVIEW.md](ROSTER_REVIEW.md) | The scouting-department layer: role review, cascades, hitters, platoons. |
| [CALIBRATION.md](CALIBRATION.md) | How scouting constants are tuned and stamped calibrated, provisional or policy. |
| [BEHAVIOR_CASES.md](BEHAVIOR_CASES.md) | The behavioral corpus: where new baseball behavior gets its case first. |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Running, testing, building and releasing Pennant. |
| [SWIFTUI_REBUILD.md](SWIFTUI_REBUILD.md) | Pennant for Mac: the native SwiftUI rebuild over the same server (D-055 to D-060), its milestones and the way back. Design; built milestone by milestone on `feature/swiftui`. |

## Historical design records

Kept because decisions and stamps cite them. They record how something was decided and are not edited to match
later code.

| Document | Why it stays |
|---|---|
| [MLB_OPERATIONS_HARDENING.md](MLB_OPERATIONS_HARDENING.md) | The MLB Operations hardening phase (D-039 to D-043). |
| [PLAYER_VALUE_HARDENING.md](PLAYER_VALUE_HARDENING.md) | The Player Value hardening cycle (phases 1 to 3b): every review finding and its outcome, and the owner decisions it produced (D-052, D-053 amendments). |
| [RIGHTS_RESEARCH.md](RIGHTS_RESEARCH.md) | The experiments and OOTP documentation behind Player Rights (D-023). |
| [PLAYER_VALUE_RESEARCH.md](PLAYER_VALUE_RESEARCH.md) | Research evidence behind Player Value (D-052): what the import establishes about contracts, service time, WAR and club finances, and what it leaves unresolved. |
| [CALIBRATION_RUN.txt](CALIBRATION_RUN.txt) | Raw output of the calibration run that `server/calibration.ts` stamps point at. |
| [PENNANT_CONSOLIDATION.md](PENNANT_CONSOLIDATION.md) | The identity, version-lineage and repository consolidation phase. |

## Upstream

[upstream/](upstream/README.md) holds the original project's release notes and forum post, preserved for
attribution. They describe upstream's product, not Pennant.

## Brand

[brand/](brand/) holds the owner-supplied Pennant mark and wordmark masters.
