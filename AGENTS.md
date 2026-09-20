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
- Philosophy never enters Player Development's judgments (`prospectDecision`,
  `prospectAssignments`, `destinationFit`, `developmentFit`): no threshold,
  requirement, or blocker may depend on it, and it is applied only afterwards in
  `assignmentPreference.ts` to rank defensible assignments (D-019). Do not
  recreate eligibility through ranking or cutoffs.
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
