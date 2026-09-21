# Roadmap

This roadmap separates foundations already present from future work. Items are
ordered by dependency and product risk, not promised release date.

## Product direction

Pennant should increasingly model the actual work of running a baseball
organization: imperfect information, specialized departments, constrained
choices, conflicting preferences, and a GM who owns the final call. AI should
make that work more legible and conversational, not replace it with generic
recommendations.

## Foundation already present

These are implementation baselines, not roadmap promises:

- Local OOTP CSV discovery/import, schema-tolerant SQLite storage, automatic
  refresh, and separate persistent scouting history.
- Express domain API, React/Vite UI, Electron desktop shell, static site export,
  auto-update, synthetic Vitest fixture, and release CI.
- Roster, player, statistics, schedule, lineup/pitching, contracts/payroll,
  trades, standings, draft, franchise, storylines, briefing, and staff chat
  surfaces described in [PROJECT_STATE.md](PROJECT_STATE.md).
- Organization-specific manual philosophy profiles with dimensions and policy
  settings.
- An enforced authority boundary: Player Development judgments are
  philosophy-independent and philosophy expresses preference among defensible
  assignments only (`assignmentPreference.ts`, D-019).
- A scouted-evidence adapter that is the single source of ability evidence for
  Player Development and Minor League Operations, with focused tests of the
  development engines and a static boundary guard.
- Two sibling operations modules over one set of specialists: MLB Operations
  (major-league roster problems) and Minor League Operations (placement, playing
  time, affiliate health, organizational congestion, cascades, retention), which
  exchange consequences across one contract (D-044 to D-046).
- Read-only recommendations with explicit safeguards and no OOTP transaction
  writeback.
- A project identity of its own: the name Pennant, a version lineage starting at 0.1.0, a changelog, a single
  development command, pull-request CI, and documented compatibility holds (D-049).

## Next: make the organizational model dependable

### 1. Test the new domain boundaries directly

Now covered with synthetic inputs: prospect decision thresholds, ordinary and
skip-level authorization, demotion, destination-fit population and low-sample
behavior, development protection, defensive assignment fit, philosophy profile
mechanics, the evidence adapter, and — with the Minor League Operations rebuild —
the current-assignment question, playing time and congestion, affiliate health,
cascades, retention ownership, the architecture boundary and the MLB ↔ farm
contract ([BEHAVIOR_CASES.md](BEHAVIOR_CASES.md)).

Still uncovered:

- philosophy normalization, persistence, resolution, and per-organization
  isolation;
- organization resolution when a saved default, human-managed club, or neither
  is present;
- (resolved) the superseded farm solvers were deleted in the hardening phase
  rather than covered; their one invariant worth keeping — an indeterminate
  Player Development judgment is never planned, rejected or ranked — is pinned
  against the farm cascade in `tests/farmDevelopmentIndeterminate.test.ts`.

### 2. Centralize organization context

Introduce a shared server-side resolver with this order: explicit valid
context, saved default, `human_team = 1`, intentional fallback/error. Reuse it
in organization-specific routes, background jobs, exports, and AI tools.
Continue allowing deliberate organization switching, while removing the need
for routine manual IDs.

### 3. Finish the fog-of-war audit

Done for Player Development and Minor League Operations (D-017): one
scouted-evidence adapter, scale normalization, strict missing handling, and a
static guard. Remaining:

- Resolved: unknown ratings are no longer imputed anywhere in development
  arithmetic (D-018). Remaining: a comparison population below 25 is treated as
  not satisfied rather than unknown, and the destination-fit stretch cost is
  omitted for an unassessed comparison.
- Surface indeterminate operations candidates and retention items in the farm
  workspaces (they are returned by the API; Player Development's own page
  already labels them).
- Route scouting snapshots (`rating_snapshots.cur`/`pot`) through the same
  composite, or record their aggregation method, so history and current level
  share one definition.
- Audit trade, contract, free-agent, franchise, roster, and player-card
  surfaces, which still read `players_value`. Each is a subjective judgment or a
  display that must be either moved to approved evidence or labelled.
- Establish, or keep declining to assume, whether `players_value.oa`/`pot` are
  the organization's scouted view. That needs an export from a save at
  imperfect scouting compared with the in-game card; the repository cannot
  settle it.
- Verify whether fielding-position grades share the tool ratings' display scale.
- Keep AI context free of hidden or provenance-uncertain ratings.

### 4. Let Operations consume the preference object — done

The Player Development ↔ Philosophy boundary is enforced (D-019), and Minor
League Operations v2 now reads `assignments.preference` rather than applying its
own philosophy-weighted costs: preference is shown per defensible alternative and
per defensible cascade step, and never attaches to anything else (D-044).
Retention no longer folds a philosophy adjustment into a development score; the
developmental outlook is Player Development's and philosophy is a stated lean
applied afterwards (D-045). The superseded solvers that carried the old weighted
costs are deleted.

### 5. Minor League Operations — rebuilt and hardened; what remains

The farm system was audited end to end, rebuilt on the same foundations as MLB
Operations ([MINOR_LEAGUE_OPERATIONS.md](MINOR_LEAGUE_OPERATIONS.md), D-044 to
D-046) and then hardened the way MLB Operations was (Part 7, D-047): the
superseded solvers, routes and pages are deleted and exactly one farm
implementation exists; blockage, cover holders, designated hitters and injuries
are read honestly; the organization is read once per request; MLB Operations
displays the farm's own reading in both directions of the contract; the corpus
stands at 234 tests in 12 files.

Remaining, in dependency order:

- **Cross-affiliate Rookie-level movement.** Eligibility and geography between a
  complex league and a Dominican one are still unmodelled, so a cascade does not
  draw across them. Everything else about Rookie affiliates is covered.
- ~~**Recency in usage.**~~ **Built** (D-048, MINOR_LEAGUE_OPERATIONS.md Part 8).
  The export does carry a per-game log at every minor-league level. Season usage,
  recent usage and current state are three kinds of fact; a man too new to a club
  to be read is `unknown`, not unused; a departed man is history, not a blocker.
  What remains of it:
  - The window constants are provisional — one partial season of one save
    (`npm run farm:usage-window` re-measures them on any import).
  - No defensive innings by date: a recent share is in starts, and a mid-game
    position switch is invisible.
  - No current-state source for a hitter's role: the export has no lineup or
    depth-chart table, so only a rotation has an exported present.
  - A man OOTP has just DROPPED from its next five still reads as a rotation
    regular until the window catches up; only the other direction is handled.
- **Calibrate what can be calibrated.** No farm constant is fitted, because the
  export holds no minor-league history. Candidates if a longer record becomes
  available: the sample minimums, the level-standing lines,
  `AGE_LEVEL_DEVELOPMENT_LIMIT` (the constant with the largest effect on how many
  players read as an organizational rather than a developmental question), and
  the injured-days line.
- **A peer-relative protection tier.** *Next.* The tier is an absolute-scale
  composite, so a 20-potential player in the Dominican Rookie League and one at
  Triple-A share one. It is load-bearing for stakes, blockage and retention, and
  rebuilding it is its own piece of work. Windowed usage sharpened what depends on
  it: every "squeezed" and every "blocked" is only as good as the tier is at naming
  who has development to cost (MINOR_LEAGUE_OPERATIONS.md §8.11).
- **Repeat-level and prior-experience context.** The assignment review does not
  yet read a man's earlier seasons at the level; a second year at Double-A reads
  the same as a first.
- Validate position and pitcher-role assignments against observed scouting
  evidence without inventing coverage.
- Add a manual "protect this player" control using the reservation already in
  the development-protection model.

### 6. Rights evaluator — implemented; finish the indeterminate edges

The state and chronology layers (D-020) and the rights evaluator (D-023) exist,
backed by controlled copied-save experiments and OOTP's own documentation
([RIGHTS_RESEARCH.md](RIGHTS_RESEARCH.md)). Remaining, each returns
`indeterminate` today:

- activation from the 10-day and 60-day injured lists, including a full 40-man;
- Rule 5 exposure (the export gives a 0/4/5 window, not a countdown; needs a sim
  through the Rule 5 draft to verify);
- re-optioning in the season that used the last option year;
- rehab returns, claims, refusals and free-agency elections, trades;
- teaching the log parser `Placed X on the secondary (40-man) roster`, `on the
  active roster`, and `claimed off waivers`, and classifying major-to-minor
  `Demoted`/`Assigned` moves without asserting option vs outright;
- saying in the freshness model that the live log lags in-session moves until
  the game is saved.

### 7. MLB opportunity layer — first slice implemented; extend it

`origin/feature/mlb-operations` was audited and **not merged**; the subsystem was rebuilt on
Player State, Player Rights, Player Development and the evidence adapter ([D-024](DECISIONS.md),
[MLB_OPERATIONS.md](MLB_OPERATIONS.md)). Implemented: state-derived needs (role below
standard, open spot, IL return crunch, GM what-if), staged responses (internal role change,
recall, add to the 40-man) with rights, development, MLB-level role fit, transaction path,
roster and farm consequences, philosophy annotation, and a problem-centred workspace.

Next, in dependency order:

- Calibrate the provisional constants in `mlbAssignmentContext.ts` against outcomes, not more
  real-save inspection (first review done, no change: MLB_OPERATIONS.md §23).
- **Rights:** run the injured-list experiment sheet (RIGHTS_RESEARCH §4.11), the one blocker for
  `activateFromInjuredList` and `placeOnSixtyDayIl`. Done: unknown duration (D-027), separate
  active and 40-man clearing with the chain (D-028).
- **Done (fourth pass, ROSTER_REVIEW.md):** performance-aware review of the pitching staff and the lineup,
  cascades, hitters (bat, glove, usage, platoon read), the staff recommendation.
- **Done (fifth pass, ROSTER_REVIEW.md stage 6, CALIBRATION.md):** rating splits and running approved (D-035); constants tuned
  against outcomes with a harness (D-037); philosophy and the competitive window shade the advice (D-036); platoon partners,
  position shifts, the bench and the bullpen's leverage roles (D-038). Next: contract and prospect-capital dimensions leaning on
  the advice, pitchers' rating splits (an owner decision), three-way position chains, re-deriving the glove weights as the season
  grows.
- **Done (hardening phase, MLB_OPERATIONS_HARDENING.md, D-039 to D-043):** a base-rate audit over all 30 clubs; a behavioral corpus of 159
  invariant tests; the peer-population fix; role standards; bench cover quality and functions; pen-wide findings; explanations as data;
  the module rebuilt as five views. Next refinement: re-derive the role standards and the glove weights as the season grows
  (`npm run calibrate`, sections `standards` and `defense`); accumulate evidence on the debatable items listed in the hardening doc
  (the policy quantiles, the IL-return window, center-field bench coverage) before changing any policy.
- **Done:** the farm cascade, where the old branch's bounded planner was deferred to (D-045), and — in
  the farm hardening phase (D-047) — MLB Operations displays the farm's own answer in both directions:
  for a recall the vacated job, whether it can be absorbed, whose playing time changes, who could take
  the job with the alternatives the chain did not follow, the chain and where it stops; for an option
  the job the player takes up, who holds it and whose developmental work is pushed aside; and the
  club's operational status before and after from the same reading the farm workspace shows.
- Service-time and Rule 5 consequences as stated facts where the export supports them.
- External acquisition, waiver claims, free-agent strategy and payroll planning build on this
  later; they are out of scope here.

### 8. Release readiness — owner decisions outstanding

Nothing here is baseball work; each item needs the owner.

- Apple Developer ID and the five signing secrets (DEVELOPMENT.md), so a macOS release can be signed and notarized.
- Vector brand masters and a macOS icon variant.
- Whether to rename the GitHub repository (D-049).
- The first tagged release (`pennant-v0.1.0`), once the above are settled. The application id
  (`com.dakotawise.pennant`) and the tag convention are already decided (D-049).

## Then: deepen organizational identity

### Staff-informed philosophy

The stored schema supports `staff` and `hybrid` modes, but current resolution
falls back to manual values because staff-derived philosophy is not implemented.
Derive transparent candidate values from actual OOTP staff attributes, show the
source of each dimension, and let the GM override individual dimensions.

### Broader philosophy consumers

Extend philosophy only where the underlying option set is already defensible:
trade alternative ranking, contract posture, free-agent fit, roster depth, and
competitive-window planning. Each consumer must expose the exact dimensions
that affected it and retain hard transaction/development guardrails.

### AI as staff interface to domain work

Expose philosophy, development assignments, farm roster health, operations
plans, retention evidence, and eventually MLB opportunity through the same
domain API tools used by the UI. Staff voices should discuss the organization's
real constraints and disagree for role-specific reasons. AI should cite the
domain result and uncertainty, not invent its own hidden ranking.

## Later: calibration and longitudinal management

- Validate thresholds across synthetic fixtures and diverse voluntarily
  described save shapes without collecting live private saves.
- Track how past GM decisions and observed outcomes inform future review while
  avoiding hindsight claims about hidden true talent.
- Add richer multi-season organizational planning, ownership constraints,
  staffing effects, budget scenarios, and decision journals.
- Improve confidence labels and provenance so every recommendation can answer
  “what did we know, what did we infer, and what remains uncertain?”

## Explicit non-goals

- A generic baseball recommendation chatbot detached from the save and domain
  models.
- Omniscient player evaluation using hidden OOTP true talent.
- Automatic transactions, releases, promotions, or save mutation without the
  GM's explicit final decision.
- Requiring users to find and type organization IDs for ordinary
  organization-specific workflows.
- Uploading live saves, generated databases, credentials, or machine-private
  state to make development easier.
