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
- Statistics, contracts, service time, injuries, roster status, age, and
  transactions are objective save facts and may be treated as known.
- Player Development decides which assignments are defensible. Organizational
  Philosophy expresses preferences among defensible choices. Minor League
  Operations solves roster and assignment problems within both boundaries.
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
