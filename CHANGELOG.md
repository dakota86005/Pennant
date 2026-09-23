# Changelog

All notable Pennant changes are documented here.

Pennant began as a fork of [ootp-front-office](https://github.com/lsukev/ootp-front-office) by Kevin Ivy. Historical
upstream development predating Pennant's independent version lineage remains available in Git history and in
upstream's releases; upstream's own release notes are preserved in [docs/upstream/](docs/upstream/README.md). Pennant's
version numbers are its own and are unrelated to upstream's (D-049 in [docs/DECISIONS.md](docs/DECISIONS.md)).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/) below 1.0: a minor version may change behavior, and 1.0 is reserved for a
later stability milestone.

## [Unreleased]

### Player Development

- **Developmental stakes.** The protection tier now answers one question — how high are the developmental stakes if
  the organization mishandles this player? — from his organization-visible ceiling (read against what the weakest
  tenth, the median and the best tenth of major leaguers are, never against the players around him) lowered by how
  much of his development is left (his age; being behind his level's schedule; a projection already realized). It
  replaces an absolute composite whose cut-offs could not be reached on the visible-tool scale — no player in thirty
  organizations was a core prospect — and which gave a teenager with no major-league ceiling, a 25-year-old at
  Triple-A and a 36-year-old major-league star the same kind of reading. The five tiers and what every module does
  with them are unchanged; there is no longer a numeric score, and each tier comes with its reasons. No result,
  usage or philosophy is an input (D-050, docs/DEVELOPMENTAL_STAKES.md).
- Minor League Operations and MLB Operations read the same tier through one reader. On the real import no
  assignment verdict, operational finding, retention conclusion, durable-role judgment or cascade step changed; the
  findings are about different men (squeezed prospects 144 → 125 across thirty organizations, none of them 25 or
  older), and the `protected prospect` retention guardrail fires for the first time.
- `npm run stakes:report` re-measures, read-only, the reference the provisional ceiling lines stand for.
- Every developmental-stakes reading ends by saying how its two parts made the tier ("that ceiling alone would set
  protected prospect; it is lowered two steps for the development that has run out"), and the `normal` tier is
  written "ordinary" wherever a reader sees it.

### Fixed

- The farm's answer to "what happens if he is sent there?" named the men holding the job only when the job was
  contested, which depended on the arriving player's own tier. It names them always.
- An affiliate raised a critical "not getting developmental work" for a prospect sharing a job, and for a designated
  hitter, while the man's own review said sharing is ordinary: the position conflict had drawn "short of work" more
  widely than the rotation and the bullpen did. One line now, for every job and for the review (D-051). Across
  thirty organizations 99 of 125 "squeezed" men were sharing a job; not one review changed.
- "What happens to the farm if he leaves?" said nothing about the man left sharing his job when the club had not
  contested it. It reads the departed man's job directly.
- A player with no exported age would have been tiered as if his development were all ahead of him (`Number(null)`
  is 0); an unknown age now leaves the tier indeterminate. No player on the real import lacks an age.
- MLB Operations' contextual assessment is handed Player Development's tier and can no longer compute one of its own
  from the ratings; the farm's "how old is he for his league" comes from the same reader as his stakes.
- The macOS release job stopped before packaging anything while the Apple signing secrets were unset: the missing
  certificate reached electron-builder as an empty `CSC_LINK`, which it read as the path of the repository folder.
  The secrets are now passed on only when they are set, so an unsigned build is packaged and the signature check
  fails as intended.

## [0.1.0] - 2026-09-20

The first Pennant-native version. It marks the point at which the project has its own name, architecture and version
lineage — not the first code written in this repository. Several models are still explicitly provisional (see
*Known limitations*); that is why this is 0.1.0 and not 1.0.

### Baseball Operations

- **MLB Operations.** Rebuilt on Player State, Player Rights and the scouted-evidence boundary. Needs come from the
  current export only (a role below its coverage floor, an open active spot, an injured player's return crunch, a
  GM-posed "what if he is out?"), never from snapshot differences. Each need opens staged responses — an internal
  role change, a recall, an addition to the 40-man — every one carrying Player Rights per action, Player
  Development's judgment for the assignment it implies, role fit, the roster effect, the farm's consequence and,
  for valid alternatives, a philosophy annotation. Responses are explained and unranked.
- **Scouting-department review.** A finding is a flag with two lenses (tools and results) and a working estimate
  shown with its parts, never a trigger or a hidden score. It covers the rotation, the bullpen and its leverage
  roles, the lineup (a hitter is his bat plus his revealed glove at his position), platoon partners from rating
  splits, position shifts and the bench as functions with a quality of cover. A staff recommendation is a stated
  rubric — act, explore, monitor or hold — with its reasons and what would change it.
- **Hardening.** A base-rate audit across all 30 clubs, concerns measured against a role's standard rather than the
  group, major leaguers as the only peer population, and the module reorganized into five views (Overview, Position
  players, Pitching staff, Bench and coverage, Decision).
- **Minor League Operations.** Rebuilt on the same foundations. It asks whether an assignment is *defensible*, never
  whether a promotion was *earned*: league-relative, park-adjusted production with its sample; playing time as named
  players competing for one named job; an assignment review with eight descriptive conclusions; affiliate health read
  twice (operational and developmental) and never merged; organizational congestion; cascades that stop and say where;
  and retention as three questions with three owners. There is exactly one farm implementation — the earlier solvers,
  routes and pages were deleted.
- **MLB ↔ farm integration.** One contract carries a departure's consequence (the vacated job, whether it can be
  absorbed, whose playing time changes, the cascade and where it stops) and an arrival's. MLB Operations displays the
  farm's own reading, so the two modules never describe one club differently.
- **Windowed farm usage.** Season usage, recent usage and current state are three kinds of fact. A recent window is
  counted in club games and only over the games a man could have played in; a man too new to a club to be read is
  `unknown`, not unused; a departed man is history and never a blocker (D-048).

### Player Development and Scouting

- **Organization-visible evidence only.** Ability judgments read the organization's exported scouting ratings and
  its persisted scouting history through a single adapter, `server/scoutedEvidence.ts`. OOTP's hidden true-talent
  values are never read or used as a fallback, and a static test enforces it.
- **Fog of war and unknowns.** Missing evidence stays missing: nothing is imputed, and a judgment is `defensible`,
  `indefensible` or `indeterminate`, never a default in disguise.
- **Player Development.** Prospect readiness, destination-aware assignment plans (ordinary and exceptional
  skip-level promotion, demotion), development protection and defensive fit, all philosophy-independent. Age relative
  to level says how much developmental time is left and never lowers the bar.
- **Scouted Development.** A history workspace built on observed rating snapshots, peer pace and rating movement,
  with explicit fog-of-war language.
- **Organizational Philosophy.** Per-organization profiles with fifteen preference dimensions and explicit
  contract and trade policies. Philosophy ranks choices among the defensible ones after Player Development has ruled
  and can never make an indefensible move defensible (D-019); every lean it applies is shown with its dimension.

### Roster State and Rights

- **Player State.** Every roster fact is read from its export column with provenance and, when absent, a stated reason
  it is unknown: the 40-man is `is_on_secondary` as exported, and option counters, waivers countdowns and service
  time are preserved as exported.
- **Transaction chronology.** OOTP's live transaction log is found from the export's own path and read only through a
  validated private copy; the save and its files are never written to. A rehab assignment is told apart from an
  option, which look identical in the export.
- **Freshness.** How current the export, the log and the save are, measured in simulated game days rather than
  wall-clock time, shown as the *Roster data* chip in the header.
- **Player Rights.** Option, recall, addition to the 40-man, designation, outright assignment and injured-list
  activation each evaluate to `eligible`, `ineligible` or `indeterminate` with the basis for every reason (export,
  observed OOTP behavior, or documentation). A rule that has not been observed is `indeterminate`, never a guess from
  real-world MLB rules.

### User Experience

- **Pennant identity.** A new name and mark across the application, installer, window and browser tab; the interface
  is organized around Baseball Operations, MLB Operations, Minor League Operations and Player Development.
- **Home page.** The dashboard's attention chips now open the two operations workspaces first, each counting what
  that workspace itself lists.
- **Version display.** The version appears in the header and is read from `package.json`, the single source.
- **Optional AI.** GM briefings, storylines, trade discussion and staff chat through Anthropic, OpenAI, Gemini,
  OpenCode Zen or a local Ollama model, selectable per feature. AI explains the application's own structured results;
  it is not a decision engine, and everything else works without a key.

### Architecture

- One Express domain API serves the browser, the Electron shell, the static export and the AI tools.
- Subsystem boundaries are written down and enforced by tests: Player Development authorizes, philosophy prefers,
  operations solve; MLB Operations and Minor League Operations are sibling consumers of one set of specialists.
- Recorded product and architecture decisions (D-001 …) and a set of design records, indexed in [docs/](docs/README.md).
- Every scouting and farm constant is declared once and stamped calibrated, provisional or policy.
- The desktop updater's feed is named explicitly as Pennant's repository instead of being inferred from the git
  remote, and the *Release notes* link and Help menu, which pointed at upstream's project, now point at Pennant's.

### Changed

- The development server no longer starts the API and the page on the same port when a tool exports `PORT`. `npm run
  dev` is the one development command; `PORT` moves the page and `OOTP_FO_API_PORT` moves the API.
- Release assets are named `Pennant-<version>-<arch>.<ext>`.
- Release tags are `pennant-v<version>` (for example `pennant-v0.1.0`), not `v<version>`, so they cannot collide with
  upstream's `v0.1.0` … `v0.40.1` tags or trigger the release workflow from them (D-049).
- The application id is `com.dakotawise.pennant` (it was upstream's inherited `com.lsukev.ootpfrontoffice`), and the
  package author is Dakota Wise. No installer had been published, so nothing needed migrating; the npm package name,
  the user-data folder and the `OOTP_FO_*` variables are unchanged.
- Upstream's release notes and forum posts moved from the repository root to `docs/upstream/`.

### Removed

- The raw-statistics promotion `signal` and `score`, a second promotion verdict beside Player Development's (D-044).
- The superseded minor-league solvers, their routes and three older Farm pages (D-047).
- Screenshots of upstream's interface, which showed the removed signal table.

### Testing and Reliability

- More than 1,700 tests over a synthetic league that contains no live OOTP data, run serially against one SQLite
  handle.
- A behavioral corpus ([docs/BEHAVIOR_CASES.md](docs/BEHAVIOR_CASES.md)) of invariants and golden cases for MLB and
  Minor League Operations; new baseball behavior gets a case there first.
- Static boundary tests for the evidence adapter, Player Rights, MLB Operations and Minor League Operations.
- Measurement scripts against a real import: `npm run calibrate`, `npm run farm:base-rate` and
  `npm run farm:usage-window`.
- Pull-request validation (typecheck, tests, build) that is separate from release signing.

### Known limitations

- macOS installers are signed and notarized only when the repository holds the Apple secrets, which it does not yet;
  Windows installers are unsigned. Until then `npm run dist:mac` produces an unsigned local build.
- No installer has been published from this repository yet.
- The farm's constants are all `policy` or `provisional`: the export holds no minor-league history to fit them to.
  Several MLB constants (role standards, glove weights, the park share) rest on one partial season of one save.
- Injured-list activation, Rule 5 exposure, waiver claims and trades remain `indeterminate` in Player Rights.
- The player-protection tier is an absolute-scale composite; a peer-relative version is the next planned piece of
  work.
- Pennant proposes and explains; it never executes a transaction or writes to an OOTP save.

[Unreleased]: https://github.com/dakota86005/ootp-front-office/compare/pennant-v0.1.0...HEAD
[0.1.0]: https://github.com/dakota86005/ootp-front-office/releases/tag/pennant-v0.1.0
