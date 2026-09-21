# AI development guide

Front Office should feel like running a baseball organization as its GM. AI is
supporting staff inside that experience, not a generic recommendation chatbot.
Recommendations must remain explainable, preserve scouting uncertainty, and
leave the final decision to the user/GM.

## Read before changing code

- [Architecture](docs/ARCHITECTURE.md) — system boundaries, data flow, and
  subsystem responsibilities.
- [Decisions](docs/DECISIONS.md) — durable product, evidence, privacy, and
  design constraints.
- [Roadmap](docs/ROADMAP.md) — implemented foundations and future work.
- [Project state](docs/PROJECT_STATE.md) — the current implementation and known
  gaps. Verify it against the worktree because it is a point-in-time record.

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
- Roster evidence has a source hierarchy (D-020): explicit CSV/export current
  state first, then OOTP's live transaction log for chronology, then Pennant's
  own snapshots only as a fallback and cross-check. If the export states a fact
  (40-man is `is_on_secondary`, DFA countdown, option counters, service time),
  read it as exported; never re-derive it from history or snapshots. A snapshot
  difference proves that state changed, never which transaction did it: do not
  fabricate "optioned", "recalled", or "DFA". Current State, Transaction
  Chronology, and Rights/Eligibility stay separate. A rehab player looks exactly
  like an optioned one in the export and is not one.
- Roster rights come only from `server/playerRights.ts` (D-023): `eligible`,
  `ineligible` or `indeterminate` per action, each reason with its basis. It is
  pure and reads only the state, chronology and league-rule layers; a consumer
  must not rebuild option, recall, 40-man, or DFA logic from raw columns. A rule
  that has not been observed or documented returns `indeterminate` — never a
  default and never a guess from MLB rules. Observed OOTP behavior beats
  documentation, and the export beats log wording (`Assigned to Triple A` after
  a DFA is an outright or an option depending on `is_on_secondary`).
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
- MLB Operations (`server/mlb*.ts`) is a consumer of Player State, Player Rights, Player
  Development, Minor League Operations and philosophy (D-024). Derive needs from the current
  export, never from snapshot differences; never read a rating, option, 40-man, or log source
  itself; never rank or score candidates; a path is only as certain as its least certain
  step. Whether an assignment is developmentally defensible is asked of Player Development per
  contemplated context (D-025); MLB Operations never holds a development threshold or a
  bypass, and an incomplete evaluation is never an actionable solution. Coverage numbers are
  floors held as data, not roster doctrine. An unknown duration is never assumed (D-027): judge
  the contexts that could apply and say when the answer depends on it. The active-roster spot
  and the 40-man spot are separate constraints (D-028); compose Rights' component actions and
  invent no combined right. The relief/experience numbers are provisional calibration
  parameters, declared only in `mlbAssignmentContext.ts`. IL activation rules come only from
  observed OOTP behavior (D-029). The scouting layer (D-031 to D-034): a review finding is a flag with two
  lenses (tools, results) and a working estimate that is always shown with its parts, never a trigger or a hidden
  score; results are objective statistics read directly, ratings only through `scoutedEvidence.ts`; every
  threshold is a provisional calibration parameter declared once (`roleReview`, `platoon`, `lineupPicture`,
  `resultsMetrics`, `roleStanding`); a hitter is bat plus revealed glove at his position; the lineup is what
  usage shows; a recommendation is advice from a stated rubric. A hitter's rating splits against each hand and his
  running ratings are approved evidence, read only through `scoutedEvidence.ts` (D-035); pitchers' splits and the other
  rating families are not. Every scouting constant is tuned against outcomes by `scripts/calibrate.ts` or stamped
  provisional, declared once (D-037, docs/CALIBRATION.md). Philosophy and the season shade the ORDER and WORDING of advice
  (`staffPreference.ts`, D-036): after validity, never a change to a read, a right or a development finding, every lean
  shown with its dimension and value, and a recommendation says what a club with no philosophy would hear. Bullpen roles,
  the bench, position shifts and platoon partners are flags and plans, never transactions (D-038). Peer populations are major leaguers
  only (D-039); a concern is measured against the ROLE with its standard shown, never against the group or one absolute line (D-040);
  every constant is stamped calibrated, provisional or policy, and a policy constant is decided, never fitted (D-041); the bench is
  functions and cover quality, not a score (D-042); the module is views, each owning one question (D-043). New baseball behavior gets a
  case in the behavioral corpus first (docs/BEHAVIOR_CASES.md).
  `tests/mlbOperationsBoundary.test.ts` enforces it.
- Minor League Operations (`server/farm*.ts`, `playingTime.ts`,
  `currentAssignment.ts`; `farmConsequence.ts` is the MLB ↔ farm contract and
  `farmRoutes.ts` the API) asks whether an assignment is DEFENSIBLE, never whether a
  promotion was earned (D-044 to D-046, docs/MINOR_LEAGUE_OPERATIONS.md). A league
  is the peer group, not a level, and a peer must be on a roster: production is
  read against the player's own league, park-adjusted, with its sample. Age
  relative to level says how much developmental time is left and never lowers the
  developmental bar; a player past his level's window raises an ORGANIZATIONAL
  question, which `currentAssignment.ts` answers and says so. Holding his own is
  the null reading; `not_assessable` (no season to read) is not `indeterminate`
  (missing evidence). One man competes for ONE job — versatility is cover, not a
  second claim — and missing reps cost development only for a player Player
  Development places at development priority or better; not playing is asked
  BEFORE the level, because a prospect's thin sample is usually caused by it.
  Operational health and developmental health are separate outputs of an affiliate
  and only a SHORTAGE is operational. A cascade is a chain whose every step is
  independently defensible and which STOPS; saying where it stopped is the answer,
  and an unresolved hole is information, never an illegality. Retention is three
  questions with three owners and philosophy may not reach the developmental
  outlook. Every finding is structured data with its evidence, its owner, what is
  missing and what would resolve it — never prose. Every constant is declared once
  in `farmCalibration.ts` and stamped; none is calibrated, because the export holds
  no minor-league history. `tests/farmOperationsBoundary.test.ts` enforces it and
  `npm run farm:base-rate` is the check on how often it raises something.
  There is ONE farm implementation: the superseded solvers, their routes and the
  older farm pages were deleted in the hardening phase (MINOR_LEAGUE_OPERATIONS.md
  Part 7). A blocker HOLDS the job — only a regular is one; a part-time man ahead
  of a prospect makes it an opportunity conflict, not a blockage. Men getting
  innings at a job from another position are named as ahead and count against
  nobody's claim. A designated hitter is batting, not fielding. An injured man is
  not cover and competes for nothing. Season usage, recent usage and current state
  are three kinds of fact (D-048, MINOR_LEAGUE_OPERATIONS.md Part 8). WHO IS ON A
  CLUB is current state and is never inferred from usage: a departed man is
  history, named with what he held, and never a blocker whatever his season total.
  A man's current work level is the recent window (`farmRecentUsage.ts`, the
  export's per-game log, counted in club GAMES and only over the games he could
  have played in) when it can be read, the season's only when the export has no
  game log, and `unknown` when fewer than `RECENT_MINIMUM_GAMES` can be counted —
  thin is not unused, and an unknown role is neither squeezed nor a blocker. Less
  evidence may only mean more uncertainty; evidence is a structured state, never a
  confidence number. When the season and the window are two levels apart both are
  shown. A relief window may confirm or clear a shortage and never raise one. An
  arrival is dated only through `clubArrival.ts`, in D-020's order; no farm module
  reads the transaction log. OOTP writes dates unpadded (`2026-5-9` sorts after
  `2026-5-10`): order games only through `parseGameDate`. Recent usage is a usage
  read — never recent form, a promotion case or a release rule; Player Development
  and retention take no usage input. The organization is read once per request
  through a `FarmSession`; never cache it across requests. MLB Operations reaches
  the farm only through `mlbEvidence.ts` (`farmConsequence`, which opens or is
  handed a session) and displays the farm's own operational reading, so the two
  modules never describe one club differently. The Player Development pages read
  `/api/scouted-development`, which is Player Development's and history's, not
  the farm's.
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
- Preserve schema-tolerant reads: OOTP exports vary by version and save.
- Add focused Vitest coverage for behavior changes. The normal validation
  baseline is `npx tsc --noEmit`, `npm test`, and any relevant manual check from
  `package.json` (`check:stats` and `check:theme` require suitable imported
  data).
