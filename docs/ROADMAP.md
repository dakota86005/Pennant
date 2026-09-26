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
- Player Value (D-052, D-053; [PLAYER_VALUE.md](PLAYER_VALUE.md)): what a player
  costs, how long the club controls him, what he is expected to produce and what
  his contract is worth beyond what he is paid, each a range with its basis and
  never a verdict. Its fitted numbers are the save's own (refitted after an
  import, adopted through a gate), and every consumer (the player card,
  Contracts, Payroll, the Trade Center, Free Agents, Org Comparison, the AI's
  context) reads it; no module reads OOTP's hidden `players_value` any longer.
- A project identity of its own: the name Pennant, a version lineage starting at 0.1.0, a changelog, a single
  development command, pull-request CI, and documented compatibility holds (D-049).

## Next: make the organizational model dependable

**Suggested order from here (supervisor, 2026-09-24, after Player Value).** Each
is independent of the others unless it says so:

1. Settle the two open Player Value questions (§9); both are small.
2. Playoff odds from the roster ("Then" below). It is the owner's stated wish, and
   Player Value now serves every player's expected wins, which it needs. It feeds
   the deadline read, the dashboard and the club's value of a win.
3. Centralize organization context (§2): cross-cutting, and every new consumer
   would otherwise repeat the resolution.
4. Move the other subsystems' calibrated constants to per-save fits (D-053,
   "Later" below). Cycle 1 is done (2026-09-24): the roster review's role
   standards (each lens with its own line), aging curve and glove weights, on the
   neutral store and refit registry (CALIBRATION.md section 12). Cycle 2 (the
   results lens, section 13) and cycle 3 (platoon and the bullpen's long-man line,
   section 14) are done. Cycle 4 is done (section 15): the inverted tools blend is
   fixed, the tools model is judged on forward seasons only (`tools-1`, which needs
   five of them; none exists yet on the Arizona import), snapshots keep split and
   running ratings, and Player Development's ceiling lines are measured at each
   import. Left: the development path and the ages (need snapshot pairs a season
   apart), the pitchers' tools weight and the running slopes (forward fits not
   built), the farm's sample constants (fittable now; below), and two recorded
   limits of `tools-1`: its tools population is the snapshot's major-league
   hitters (not exactly the served peer set), and a past season's first game is
   the policy date March 20 (the export keeps only the current schedule).
5. The remaining Minor League Operations and rights edges (§5, §6), and
   staff-informed philosophy ("Then").
6. Release readiness (§8) whenever the owner is ready; it is not baseball work.

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
- Done (Player Value phase 6, 2026-09-24; D-052, [PLAYER_VALUE.md](PLAYER_VALUE.md)
  Part 8): the trade, contract, payroll, free-agent, organization-comparison,
  roster and player-card surfaces no longer read `players_value`; each moved to
  Player Value or, where it is not a value question, to the scouted-evidence
  adapter, one consumer per change (6a to 6d), and phase 6e deleted the last
  readers and emptied the boundary test's allow-list. Still open: the Roster's
  rating bars read the approved tool-rating columns directly rather than
  through the adapter (an owner question, PLAYER_VALUE.md Part 9, phase 6e).
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
- **Calibrate what can be calibrated.** No farm constant is fitted yet. (Corrected
  in cycle 4 of the per-save calibration: this item used to say the export holds no
  minor-league history. It does: minor-league stat lines for every affiliated level,
  back to about 1920 on the Arizona import, which Player Value's arrival fit already
  reads. It holds no minor-league ratings history.) **Fittable per save now, with
  cycle 2's method** (rolling origins, `calibrationDetector.ts`, the starting values
  as the rival): the farm's stabilization and mature-sample constants
  (`MINIMUM_SAMPLE`, `MATURE_SAMPLE`, the farm results' K), predicting a minor
  leaguer's next line at the same level from his earlier ones. Policy, not fitted:
  the level-standing lines,
  `AGE_LEVEL_DEVELOPMENT_LIMIT` (the constant with the largest effect on how many
  players read as an organizational rather than a developmental question), and
  the injured-days line.
- ~~**A peer-relative protection tier.**~~ **Built** (D-050, [DEVELOPMENTAL_STAKES.md](DEVELOPMENTAL_STAKES.md)).
  The tier is developmental stakes: an absolute, organization-visible ceiling lowered by how much of the
  development that would realize it is left. The old absolute composite's cut-offs were unreachable on the
  adapter's scale (no core prospect in thirty organizations) and it was blind to age and level. Peers enter
  only as a league's rostered age profile; talent is never read against neighbors. What remains of it:
  - Every constant is provisional or policy and none can be calibrated from this export
    (`npm run stakes:report` re-measures the reference on any import).
  - **Owner's call:** whether a fringe major-league ceiling with most of his development ahead counts as
    having stakes. It is the line with the largest effect (803 of 1,021 priority players league-wide).
  - Trajectory is not read: one snapshot exists, and the snapshot composite is not the adapter's (§3).
  - The manual "protect this player" control is still reserved and unsupplied.
- ~~Part-time is `squeezed`, and his own review calls sharing ordinary.~~ **Built** in the stakes hardening pass:
  one line, `shortOfWork`, for every job and for the review (D-051).
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

- The five signing secrets (DEVELOPMENT.md), so a macOS release can be signed and notarized. The owner enrolled in
  the Apple Developer Program on 2026-09-25; the Developer ID certificates exist.
- Vector brand masters and a macOS icon variant.
- Whether to rename the GitHub repository (D-049).
- The first tagged release (`pennant-v0.1.0`), once the above are settled. The application id
  (`com.dakotawise.pennant`) and the tag convention are already decided (D-049).

### 9. Player Value — built; what remains

Built 2026-09-23 to 2026-09-24 (D-052, D-053; [PLAYER_VALUE.md](PLAYER_VALUE.md)
Part 9; PRs #10 to #30): control timelines from Player Rights; the cost of every
controlled season (renewals and an arbitration ladder measured on each import);
Club Finances and the price of a win, first from the opening market and then
measured from the save's own signings; expected production in wins from results
and from scouted ratings, fitted on the save's own history and adopted only
through a gate; contract value and the value of keeping him; "our view" through
the organization's philosophy; the club's value of a win in playoff odds; and the
consumer migration (6a to 6e) that moved every page and the AI's context onto it,
deleted OOTP's percentiles and closed the `players_value` boundary. Every visible
line follows AGENTS.md "Writing for the GM".

Remaining:

- **Owner questions (phase 6e):** may the Roster's rating bars read through the
  scouting adapter (a grade of 0 would then show as not scouted)? And do the 142
  "not settled" players stay on Free Agents' "Might reach the market" list
  (recommended: yes)?
- **Prospects read low.** When a prospect's arrival is projected, his rate when
  he plays is about half what the save's real arrivals produced, because the
  ratings path's development prior is provisional; it tightens once the save's
  own rating snapshots are enough to fit the development path.
- **Time, not work:** the measured price of a win, observed arbitration awards
  and the snapshot pairs sharpen as imports accumulate across winters.
- **Still open from phase 4:** an unknown arbitration class priced by observed
  awards; production at an import taken after the season number moved on; the
  re-signing policy as a sensitivity reading.
- **Declined for now (owner):** a multi-season market reading for free agents;
  fitting the results model horizon by horizon.
- **Polish:** a few hover texts still carry an internal reference ("(R-6)") or a
  raw column name ("opt_out 1"); the production cone's axis keeps its short codes.

### 10. Pennant for Mac — the SwiftUI rebuild (in progress)

A native SwiftUI app over the same server, run as a sidecar, replacing the React UI
and Electron at cutover (D-055 to D-060; [SWIFTUI_REBUILD.md](SWIFTUI_REBUILD.md)).
The server writes every visible sentence through a generated contract, so the
Swift app renders and never judges. Work is on `feature/swiftui` in milestones N0
to N15; the restore point is the tag `pre-swiftui` and the branch
`archive/electron-react` (DEVELOPMENT.md). N0 (restore point, decisions, behaviour
cases, ground rules) is done; N1, the sidecar server, is next. It absorbs item 8's
signing work: Developer ID is needed by N14.

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
that affected it and retain hard transaction/development guardrails. For
contracts, trades and free agency this is built as Player Value's philosophy
lens ("our view"), applied after a neutral valuation (PLAYER_VALUE.md Part 6):
the card, Contracts and the Trade Center show it beside the neutral figure, with
every lean named. Still to extend: free-agent fit and roster depth.

### AI as staff interface to domain work

Expose philosophy, development assignments, farm roster health, operations
plans, retention evidence, and eventually MLB opportunity through the same
domain API tools used by the UI. Staff voices should discuss the organization's
real constraints and disagree for role-specific reasons. AI should cite the
domain result and uncertainty, not invent its own hidden ranking.

### Playoff odds from the roster (owner, 2026-09-24)

The deadline read's odds (`posture.ts`) are a two-club race: this season's
Pythagorean record at face value against a .520 rival, over the games left
(with a division leader's wild-card route since 2026-09-24). The owner wants a
more sophisticated system later: team strength built from the roster (Player
Value's projected wins per player, injuries, playing time), early-season
regression, the real schedule, every rival in the division and wild-card
races, and simulated seasons. It feeds the deadline read, the dashboard and
the club's value of a win (PLAYER_VALUE.md 4.5). Likely an MLB Operations
milestone that consumes Player Value; with Player Value built, its input (each
player's expected wins with a range) is available now.

## Later: calibration and longitudinal management

- **Audit and migrate calibrated constants to per-save fits (D-053).** Calibration
  belongs to the save: fitted per save from its own history, stored with a run
  record, refitted after an import, adopted through a gate, with a provisional
  fallback prior in code. Player Value's expected production does this (phase
  3a). MLB Operations' roster review does it since cycle 1 (`roleStandards.ts`
  role standards, `roleReview.ts` `AGING_CURVE` and `DEFENSE_WEIGHT`, on the
  neutral `saveIdentity.ts`, `saveCalibrationStore.ts` and `saveCalibration.ts`;
  CALIBRATION.md section 12), and since cycle 2 the results lens's season weights
  and stabilization, under the "clearly better" rule (section 13), and since cycle 3
  the platoon weight around the league norm and the bullpen's long-man line (section
  14; the leverage cut-offs are policy on the league's own scale). Not yet migrated,
  each a code-declared `calibrated` or fittable `provisional` constant today:
  `platoon.ts` (the rating weight and the K around ratings: forward cases need the
  split ratings snapshots keep since cycle 4), `toolsModel.ts` running slopes (the
  same), the pitchers' tools weight (a forward fit not built), `farmCalibration.ts`
  (Minor League Operations: recent usage, farm results; the sample constants are
  fittable on the save's minor-league lines) and `developmentFit.ts` (development age
  and projection: a development path needs snapshot pairs a season apart; when they
  exist, Player Value's path fit should move to the neutral `ratingsForward.ts` so
  both read one path). Done in cycle 4: the tools blend, the bat slopes and the
  hitters' tools weight (`tools-1`, forward cases), the derived profile line and the
  ceiling lines (a measurement at each import). For each:
  say which values are fittable on a save's history and which are policy, write
  the method and its gate, and keep the current values as the provisional prior.
- Move Player Value's own fits (`value_production_fits`) onto the neutral store
  (`save_calibration_fits`), with a migration that keeps each save's rows; not
  done in cycle 1 on purpose.
- The roster review's glove weights are built but inactive on a save whose past
  seasons carry no zone rating; whether OOTP keeps a simulated season's zone
  rating in later exports is not known (indeterminate). They switch on by
  themselves once two seasons in a row carry it and a third checks them.
- Per-save calibration follow-ups from cycle 1 (CALIBRATION.md section 12, "Not built"): score the previous
  import's standards on the current holders once two measurements exist; the glove weights' paired-bootstrap
  condition; cache the results-lens history check per completed season; retention for `save_calibration_fits`.
- Finding (cycle 2, CALIBRATION.md 13.4): relievers' results are trusted too much. Next season's runs follow the results lens's
  prediction with a slope of about 0.65 (0.74 under the starting values) on the Arizona import. No weight or stabilization fixes
  it, so it is a model-form question for `PITCHER_RESULTS_MIX` and the bullpen roles. It is reported in the run record, not gated.
- Cycle 3 follow-ups (CALIBRATION.md 14.4): a reliever's tier at 8 appearances is noisy (only about half read the same leverage
  band from both halves of their appearances), so consider a tier that says how settled it is, or a higher minimum (owner's call,
  `MIN_APPEARANCES` is policy). Whether OOTP keeps past seasons' game logs in later exports is unknown; the long line's season
  split is "not measured" without them.
- The "clearly better" rule's error rates are simulated for the results lens and the platoon fit only. Simulate them for the aging curve too, and
  consider whether Player Value's results fit should follow the same rule (it keeps its coverage gate).
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
