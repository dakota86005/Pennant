# AI development guide

Pennant should feel like running a baseball organization as its GM. AI is
supporting staff inside that experience, not a generic recommendation chatbot.
Recommendations must remain explainable, preserve scouting uncertainty, and
leave the final decision to the user/GM.

Pennant began as a fork of `lsukev/ootp-front-office` and has its own name,
architecture and version lineage (D-049). The Electron `appId` is Pennant's own
(`com.dakotawise.pennant`) and release tags are `pennant-v<version>`, never the
`v<version>` shape upstream uses. One inherited identifier is held back on
purpose — the npm `name` `ootp-front-office`, from which Electron names the
user-data folder — and the `OOTP_FO_*` environment variables and the `data/`
layout keep their names; do not rename them as a cosmetic cleanup, and attempt no
data migration without the owner (see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#application-id-and-compatibility-holds)).

## Read before changing code

- [Architecture](docs/ARCHITECTURE.md) — system boundaries, data flow, and
  subsystem responsibilities.
- [Decisions](docs/DECISIONS.md) — durable product, evidence, privacy, and
  design constraints.
- [Roadmap](docs/ROADMAP.md) — implemented foundations and future work.
- [Project state](docs/PROJECT_STATE.md) — the current implementation and known
  gaps. Verify it against the worktree because it is a point-in-time record.
- [Development](docs/DEVELOPMENT.md) — the one dev command (`npm run dev`),
  validation, versions and releases. [docs/README.md](docs/README.md) says
  which documents are current and which are historical records.

Subsystem detail lives in the canonical documents below, not in this file.
Before changing one of these subsystems, read the listed sections directly.
Claude Code also loads the listed rule for matching paths; it is a short
reminder that routes to the same documents, never the doctrine itself.

| Subsystem | Canonical detail | Claude rule |
|---|---|---|
| Minor League Operations | D-044 to D-048 and D-051; ARCHITECTURE "Minor League Operations owns placement, playing time and cascades"; MINOR_LEAGUE_OPERATIONS.md Parts 2, 3, 7, 8 and 9 | `.claude/rules/farm-operations.md` |
| MLB Operations | D-024 to D-043; ARCHITECTURE "MLB Operations"; MLB_OPERATIONS.md §3, §10, §11 and §15 to §30; MLB_OPERATIONS_HARDENING.md; CALIBRATION.md; BEHAVIOR_CASES.md "MLB Operations" | `.claude/rules/mlb-operations.md` |
| Developmental stakes | D-050 (D-018, D-019 and D-044 as referenced); ARCHITECTURE "Developmental stakes: the protection tier"; DEVELOPMENTAL_STAKES.md Parts 3, 4, 5 and 9; BEHAVIOR_CASES.md "Developmental stakes" | `.claude/rules/developmental-stakes.md` |
| Roster evidence and rights | D-020 to D-023 (D-026 for rehab); ARCHITECTURE "Roster evidence: state, chronology, and how current they are"; RIGHTS_RESEARCH.md §2, §3 and §5 | `.claude/rules/roster-evidence.md` |

Treat the repository and imported OOTP schema as the source of truth. Do not
claim a feature is implemented because it appears in the roadmap or a prompt.
Update the relevant durable document when an architectural boundary, accepted
decision, roadmap item, or project-state fact changes.

## Non-negotiable boundaries

- Subjective ability judgments may use the organization's exported scouting
  ratings and its persisted scouting history. Never substitute hidden OOTP
  true-talent values or erase fog of war. Missing scouting evidence stays
  missing.
- Read ability ratings for Player Development and Minor League Operations only
  through `server/scoutedEvidence.ts`. Never read `players_value` (`oa`, `pot`,
  `overall_value`, `talent_value`, ...) or a rating column for those judgments,
  and never fall back to them; see D-017. `tests/evidenceBoundary.test.ts`
  enforces it.
- Unknown evidence stays unknown: never substitute a midpoint, average, or
  zero for a missing rating. Use `satisfied` / `not_satisfied` / `unknown` and
  `defensible` / `indefensible` / `indeterminate` (D-018); `eligible: false` is
  not a rejection. Indeterminate is not "protect" or "hold".
- Never make progress depend on asking the owner to run ad-hoc OOTP
  experiments to discover undocumented behavior. When the exports, saves,
  logs, code, tests and existing evidence cannot establish a behavior safely,
  leave the conclusion indeterminate, document the uncertainty, and continue
  without inventing an answer.
- Roster evidence keeps three concerns separate (D-020): Current State
  (`playerState.ts`, what the export says is true now), Transaction Chronology
  (`transactionLog.ts`, what OOTP's live log says happened) and Rights. A fact
  the export states (40-man is `is_on_secondary`, DFA countdown, option counters,
  service time) is read as exported, never re-derived, and outranks the log about
  current placement; Pennant's own snapshots are only a fallback and cross-check.
  A snapshot difference proves that state changed, never which transaction did
  it: do not fabricate "optioned", "recalled", or "DFA". A rehab player looks
  exactly like an optioned one in the export and is not one.
- Roster rights come only from `server/playerRights.ts` (D-023): `eligible`,
  `ineligible` or `indeterminate` per action, each reason with its basis. A
  consumer must not rebuild option, recall, 40-man, or DFA logic from raw
  columns. A rule that has not been observed or documented returns
  `indeterminate` — never a default and never a guess from MLB rules. Observed
  OOTP behavior beats documentation, and the export beats log wording.
- Never write to OOTP files, and never open the live `temp/text_data.sqlite3` in
  place: read it only through `server/liveLogSnapshot.ts` (a validated private
  copy). Normal use must need no manual step beyond the existing database
  export; the save and its live log are derived from the export's path.
- Statistics, contracts, service time, injuries, roster status, age, and
  transactions are objective save facts and may be treated as known.
- Player Development decides which assignments are defensible. Organizational
  Philosophy expresses preferences among defensible choices. Minor League
  Operations solves roster and assignment problems within both boundaries.
- MLB Operations and Minor League Operations are sibling consumers of one set of
  specialists, not separate apps. Neither owns a specialist and neither reaches
  into the other's solver; they exchange consequences across one contract, and
  Minor League Operations owns the farm side of it (D-045).
- Philosophy never enters Player Development's judgments (`prospectDecision`,
  `prospectAssignments`, `destinationFit`, `developmentFit`): no threshold,
  requirement, or blocker may depend on it, and it is applied only afterwards in
  `assignmentPreference.ts` to rank defensible assignments (D-019). Do not
  recreate eligibility through ranking or cutoffs.
- The protection tier is DEVELOPMENTAL STAKES (D-050): how much the organization
  loses, developmentally, by mishandling a player. It is never authorization (not
  promote, demote, start, call up, trade or release) and never a rank, a trade
  value or a readiness read; Player Development's defensibility judgments
  (`prospectDecision`, `prospectAssignments`, `destinationFit`) do not read it.
  No result, usage, roster need, philosophy or other player's rating is an input.
  Missing ratings or age leave the tier unknown, and missing context discounts
  nothing. There is no score, and nothing may rank players by the tier. Obtain a
  tier only through `server/developmentalContext.ts`, so no two modules tier one
  man two ways; a pure consumer is handed a `DevelopmentProtection`, never the
  ratings. `tests/developmentalStakesBoundary.test.ts` enforces the boundary;
  read the canonical detail (routing table above) before changing it.
- MLB Operations (`server/mlb*.ts` and its scouting layer) is a consumer of Player
  State, Player Rights, Player Development, Minor League Operations and philosophy
  and owns none of their answers (D-024). It derives needs from the current
  export, never from snapshot differences; it never reads a rating, option,
  40-man, or log source itself (ratings, including a hitter's approved splits and
  running ratings, only through `scoutedEvidence.ts`: D-035); and it reaches the
  farm only through `mlbEvidence.ts`. Developmental defensibility is asked of
  Player Development per contemplated context, never held as an MLB threshold or
  bypass (D-025), and an unknown duration is never assumed (D-027). Stages are
  never collapsed and nothing is ranked or given a hidden score: a path is only
  as certain as its least certain step, an incomplete evaluation is never an
  actionable solution, and a review finding is a flag with its evidence shown,
  never a trigger (D-031). Philosophy and the season shade only the order and
  wording of advice, after validity, and every lean is shown (D-036). Every
  constant is declared once and stamped calibrated, provisional or policy
  (D-037, D-041). Recommendations, bench, bullpen, shift and platoon plans are
  advice, never transactions (D-034, D-038); output is deterministic and no LLM
  is in the decision path. New baseball behavior gets a behavioral-corpus case
  first (docs/BEHAVIOR_CASES.md). `tests/mlbOperationsBoundary.test.ts`
  enforces the boundary; read the canonical detail (routing table above) before
  changing it.
- Minor League Operations (`server/farm*.ts`, `playingTime.ts`,
  `currentAssignment.ts`) solves affiliate roster, role, playing-time and cascade
  problems inside Player Development's and Philosophy's boundaries and decides
  no scouting, development, rights or philosophy question (D-044 to D-048,
  D-051). It asks whether an assignment is DEFENSIBLE, never whether a promotion
  was earned: results and usage authorize no move, age relative to level never
  lowers the developmental bar, and philosophy cannot reach retention's
  developmental outlook. Missing reps cost development only for a player Player
  Development places at development priority or better; "short of developmental
  work" is one line (`shortOfWork`) that the club's conflicts and the man's
  review share. Who is on a club is current state, never inferred from usage;
  a thin read is `unknown`, not unused, and less evidence only ever means more
  uncertainty. A cascade is a chain of independently defensible steps that
  stops, and an unresolved hole is information, never an illegality. Findings
  are structured data with evidence, owner and what is missing; constants are
  declared once in `farmCalibration.ts` and none is calibrated.
  `tests/farmOperationsBoundary.test.ts` enforces the boundary;
  read the canonical detail (routing table above) before changing it.
- Recommendations are advisory. The user/GM makes the final decision. Do not
  add automatic OOTP transactions or save mutation as an incidental feature.
- Organization-specific behavior should resolve the configured organization,
  then the human-managed OOTP organization, without making the user supply a
  raw organization ID when the context is already available.
- Never commit credentials, API keys, environment files, live OOTP saves,
  generated databases, AI caches, local settings, or machine-specific private
  data.

## Working safely

- Inspect `git status --short` before editing and preserve unrelated user work.
- Do not use destructive Git commands. Do not commit or push unless explicitly
  requested.
- Keep browser and Electron behavior on the same Express API instead of adding
  parallel domain implementations.
- Preserve schema-tolerant reads: OOTP exports vary by version and save. OOTP
  writes dates unpadded (`2026-5-9` sorts after `2026-5-10`): compare or order
  them only through `parseGameDate` (`server/dataFreshness.ts`).
- Add focused Vitest coverage for behavior changes. The normal validation
  baseline is `npx tsc --noEmit`, `npm test`, `npm run build`, and any relevant
  manual check from `package.json` (`check:stats` and `check:theme` require
  suitable imported data).
- The version lives only in `package.json` (`server/appInfo.ts` reads it); do
  not hard-code it anywhere. Never create, move or delete Git tags or branches
  without the owner's approval, and do not fetch upstream's tags into this clone.
