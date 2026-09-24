# AI development guide

Pennant should feel like running a baseball organization as its GM, not like a
generic analytics dashboard or recommendation chatbot. AI is supporting staff
inside that experience. Recommendations must remain explainable, preserve
scouting uncertainty, and leave the final decision to the user/GM.

Pennant is its own product, forked from `lsukev/ootp-front-office`: `origin` is
Pennant's repository and `upstream` the original. Releases, the updater and
in-app links target `origin`; release tags are `pennant-v<version>`, never
upstream's `v<version>` (D-049). Branding is not technical identity: the npm
`name`, `OOTP_FO_*` variables and `data/` layout are held because persisted
state and user configuration depend on them; changing one needs an explicit
data migration, which is the owner's decision.

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

The repository and the imported OOTP schema are the source of truth: code,
tests and configuration establish what is implemented, and a roadmap entry or a
prompt does not. Read the routed sections below, not whole large documents.
Update the relevant durable document when a boundary, decision, roadmap item or
project-state fact changes; record a durable architecture or product-boundary
change as a new D-number in `docs/DECISIONS.md`.

Before changing a subsystem, read its canonical sections. Claude Code also loads
the listed rule for matching paths; a rule is a short reminder that routes to
the same documents, never the doctrine itself. Documents marked historical or
research are evidence and rationale, not current implementation truth.

| Subsystem | Canonical detail | Claude rule |
|---|---|---|
| Scouted evidence and development authority | D-002, D-003, D-017 to D-019, D-025; ARCHITECTURE "Evidence and fog of war", "Player Development owns eligibility", "Organizational Philosophy owns preferences" | — |
| Minor League Operations | D-044 to D-048, D-051; ARCHITECTURE "Minor League Operations owns placement, playing time and cascades"; MINOR_LEAGUE_OPERATIONS.md Parts 2, 3, 7, 8, 9 | `.claude/rules/farm-operations.md` |
| MLB Operations | D-024 (then D-025 to D-043 by topic); ARCHITECTURE "MLB Operations"; MLB_OPERATIONS.md §10, §11; ROSTER_REVIEW.md §2, §4; CALIBRATION.md; BEHAVIOR_CASES.md "MLB Operations"; historical rationale: MLB_OPERATIONS_HARDENING.md | `.claude/rules/mlb-operations.md` |
| Developmental stakes | D-050; ARCHITECTURE "Developmental stakes: the protection tier"; DEVELOPMENTAL_STAKES.md Parts 3, 4, 9 | `.claude/rules/developmental-stakes.md` |
| Roster evidence and rights | D-020 to D-023, D-026; ARCHITECTURE "Roster evidence: state, chronology, and how current they are"; research evidence: RIGHTS_RESEARCH.md §2, §3 | `.claude/rules/roster-evidence.md` |
| Player Value | D-052 (with D-018, D-023, D-041), D-053 (calibration belongs to the save); ARCHITECTURE "Subsystem responsibilities" (Player Value), "Player Rights (`playerRights.ts`, `leagueRules.ts`)", "Organizational Philosophy owns preferences" (the lens); PLAYER_VALUE.md Parts 1, 2, 4.5, 6, 7 to 11; BEHAVIOR_CASES.md "Player Value"; research evidence: PLAYER_VALUE_RESEARCH.md R-2, R-3, R-6, R-10 | `.claude/rules/player-value.md` |
| Project identity and releases | D-049; ARCHITECTURE "Subsystem responsibilities" (Identity and version); DEVELOPMENT.md "Versions", "Release tags", "Releases", "Application id and compatibility holds" | `.claude/rules/release-identity.md` |

## Non-negotiable boundaries

- **Fog of war** (D-002, D-017). Subjective player-ability judgments use only
  what the organization can see: its exported scouting ratings and its observed
  rating history. Hidden OOTP true-talent values never drive them. Development
  and operations code reads ratings only through `server/scoutedEvidence.ts`
  (`tests/evidenceBoundary.test.ts`), never a rating column or `players_value`
  (`oa`, `pot`, `overall_value`, `talent_value`, ...), and never falls back to
  them. Pre-fork surfaces (trade, contracts, franchise) still read
  `players_value` and are unaudited; do not extend it to any new judgment.
  Objective save facts (statistics, contracts, service time, injuries, roster
  status, age, transactions) are known where the export provides them.
- **Unknown stays unknown** (D-018). Missing evidence is never replaced by a
  midpoint, average, zero or inference; its absence is not evidence of absence,
  and thinner evidence only ever widens uncertainty, never becomes a confident
  conclusion. Use `satisfied` / `not_satisfied` / `unknown` and `defensible` /
  `indefensible` / `indeterminate`; `eligible: false` is not a rejection, and
  indeterminate is not "protect" or "hold".
- **Show the basis.** A baseball conclusion, finding or right carries its
  evidence and basis and names what is missing (D-018, D-023, D-031, D-044), so
  the GM can see why. Nothing is ranked by a hidden score.
- Never make progress depend on asking the owner to run ad-hoc OOTP
  experiments to discover undocumented behavior. When the exports, saves, logs,
  code, tests and existing evidence cannot establish a behavior safely, leave
  it indeterminate, document the uncertainty, and continue without inventing
  an answer.
- **Roster evidence** keeps Current State (what the export says is true now),
  Transaction Chronology (what OOTP's live log says happened) and Rights apart
  (D-020). An exported fact is read as exported and outranks the log about
  current placement. A snapshot difference proves that state changed, never
  which transaction did it: never fabricate "optioned", "recalled" or "DFA".
  Rights come only from `server/playerRights.ts` (D-023); a consumer never
  rebuilds option, recall, 40-man or DFA logic, and an unobserved rule is
  `indeterminate`, never a guess from MLB rules.
- Never write to OOTP files or save state. The live `temp/text_data.sqlite3` is
  read only through `server/liveLogSnapshot.ts` (a validated private copy), and
  normal use needs no manual step beyond the existing database export (D-021).
- **Authority chain** (D-003, D-019, D-045). Player Development decides whether
  an assignment is developmentally defensible, per context (D-025).
  Developmental stakes describe what mishandling a player would cost and
  authorize nothing. Organizational Philosophy only orders defensible choices,
  afterwards (`assignmentPreference.ts`): nothing in Player Development's
  judgments may depend on it, and ranking or cutoffs must not recreate
  eligibility. Minor League Operations and MLB Operations solve their own
  problems inside those answers and Player Rights'. They are sibling consumers
  of one set of specialists, joined only by the farm ↔ MLB contract (the farm
  owns its side), and neither reaches into the other's solver.
- **Developmental stakes** (D-050), the protection tier, is developmental
  consequence: never authorization, readiness, a rank, trade value or a
  recommendation, and Player Development's defensibility judgments do not read
  it. Obtain it only through `server/developmentalContext.ts`;
  `tests/developmentalStakesBoundary.test.ts` enforces the boundary.
- **MLB Operations** (D-024) consumes Player State, Player Rights, Player
  Development, Minor League Operations and philosophy and owns none of their
  answers. It derives needs from the current export, reaches the farm only
  through `mlbEvidence.ts`, and holds no development threshold of its own
  (D-025). `tests/mlbOperationsBoundary.test.ts` enforces the boundary.
- **Minor League Operations** (D-044) solves affiliate roster, placement, role,
  playing-time and cascade problems inside Player Development's and
  Philosophy's answers and decides no scouting, development, rights or
  philosophy question; results and usage authorize no move. A cascade is a
  chain of independently defensible steps that stops, and an unresolved hole is
  information, never an illegality. `tests/farmOperationsBoundary.test.ts`
  enforces the boundary.
- **Player Value** (D-052) describes and never authorizes: cost, control,
  production and surplus are bands with their basis, never a verdict or a
  single score. It reads eligibility only from Player Rights, ability only
  through `scoutedEvidence.ts` (never `players_value`), and no philosophy
  outside its lens, no protection tier and no defensibility; a missing rule or
  service time is `indeterminate`, never 6 / 3 / 172 or zero. Consumers read it
  through `server/playerValue.ts`; `tests/playerValueBoundary.test.ts`
  enforces the boundary.
- **Calibration belongs to the save** (D-053). New fitted numbers are fitted
  on the save's own history, stored per save with a run record, refitted after
  an import and adopted only through a gate; code holds the method, the policy
  and a provisional fallback prior. Player Value's production does this first.
- **The application decides; AI explains** (D-001). Deterministic code computes
  facts, eligibility, findings and recommendations. Chat, briefings and
  storylines retrieve, explain and discuss those results through the same API
  and never silently replace them; no LLM is in the decision path. AI providers
  are optional, and the non-AI application must work without a credential.
- Recommendations, findings and plans are advisory, never transactions: the
  user/GM makes the final decision. Do not add automatic OOTP transactions or
  save mutation as an incidental feature.
- Organization-specific behavior should resolve the configured organization,
  then the human-managed OOTP organization, without making the user supply a
  raw organization ID when the context is already available.
- Never commit credentials, API keys, environment files, live OOTP saves,
  generated databases, AI caches, local settings, or machine-specific private
  data.

## Writing for the GM (UI copy)

The owner's rule (2026-09-24): what a page says should read like a front office
talking, not a methods paper.

- Visible text is short and plain: a title and one line saying what the number
  means ("What he's worth beyond what he's paid"). Name things the way a GM
  would ("Value of keeping him", "Most likely $X · could be $A to $B"), not by
  the method ("retention margin", "central", "edge against edge").
- The explanation goes in a hover: the `Tip` component (`src/Tip.tsx`), in the
  voice of `TIP_OA` and `TIP_VALUE` (`src/playerModal.tsx`). Say what the
  number is, how to read it and what it leaves out, in plain sentences.
- No internal jargon, doc IDs (D-, R-, Q-numbers), column names or code terms
  in titles or visible lines. They may appear in a hover or a breakdown where
  they help, never as the headline.
- Something unknown gets one short sentence on screen ("Not valued yet: his
  contract terms aren't in the export"). The full reasons go in the hover or
  the breakdown, never a wall of text.
- "Show the basis" still holds: the basis moves into hovers and breakdowns; it
  does not disappear. Where it is practical, a test keeps banned jargon out of
  visible text.

## Working safely

- Inspect `git status --short` before editing and preserve unrelated user work.
- Do not use destructive Git commands. Do not commit or push unless explicitly
  requested, and push only to `origin`.
- Keep browser and Electron behavior on the same Express API instead of adding
  parallel domain implementations.
- Preserve schema-tolerant reads: OOTP exports vary by version and save. OOTP
  writes dates unpadded (`2026-5-9` sorts after `2026-5-10`): compare or order
  them only through `parseGameDate` (`server/dataFreshness.ts`).
- New baseball behavior gets a case in `docs/BEHAVIOR_CASES.md` first, stated
  as a baseball invariant ("Adding a case"). Add focused Vitest coverage for
  other behavior changes. The normal validation baseline is `npx tsc --noEmit`,
  `npm test`, `npm run build`, and any relevant manual check from
  `package.json` (`check:stats` and `check:theme` require suitable imported
  data).
- The version lives only in `package.json`; do not hard-code it anywhere. Never
  create, move or delete Git tags or branches without the owner's approval, and
  do not fetch upstream's tags into this clone.
