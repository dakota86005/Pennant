# Minor League Operations

Design record and audit for the Minor League Operations subsystem. Part 1 is the
forensic audit of the farm implementation that existed before this phase
(`feature/mlb-operations-v2`, after the MLB hardening phase). Part 2 is the v2
architecture. Part 3 is the MLB ↔ farm contract. Part 4 is the workspace.

`PROJECT_STATE.md` says what is implemented; this file says why. Status is stated
per section: nothing here is implemented merely because it is described.

Read [MLB_OPERATIONS.md](MLB_OPERATIONS.md) first for the sibling subsystem's
boundaries (D-024 to D-030) and [MLB_OPERATIONS_HARDENING.md](MLB_OPERATIONS_HARDENING.md)
for the lessons this phase carries over.

## 1. The GM problem

MLB Operations asks *"how do we solve major-league roster problems?"*. Minor
League Operations asks a different question:

> Is the organization placing, using and moving minor-league players in ways that
> support their development while keeping every affiliate operationally
> functional?

It is **not** a promotion leaderboard. Good statistics are not authorization to
promote and poor statistics are not authorization to demote. The farm's job is to
tell the GM which assignments are questionable, which are defensible, who cannot
get the work he needs, where prospects block one another, which affiliates have
structural problems, what happens downstream when one player moves, and what is
simply unknown.

Ownership, unchanged from D-003 and extended here:

```text
organization-visible Scouted Evidence
          │
          ▼
    Player Development ── is THIS assignment developmentally defensible?
          │                 readiness · destination fit · uncertainty
          ▼
  Organizational Philosophy ── which defensible option does this club prefer?
          │
          ▼
   Minor League Operations ── affiliate roster / role / playing-time solver,
          │                    organizational cascades, consequences
          ▼
         the GM decides
```

Minor League Operations must not recreate Player Development's thresholds.
Philosophy cannot make an indefensible assignment defensible. Unknown evidence
stays unknown.

---

# Part 1 — Forensic audit of the existing farm implementation

Read end to end on the worktree, not from prior descriptions, and exercised
read-only against the imported Arizona save (`D-backs real save`, simulated
through 2026-05-15; 247 assigned minor leaguers across seven affiliates).

## 1.1 Inventory

| Module | Lines | Direct tests |
|---|---|---|
| `minorLeagueMoves.ts` (position-player operations) | 2,518 | none |
| `minorLeagueRetention.ts` | 2,442 | none |
| `minorLeaguePitchingOperations.ts` | 2,135 | none |
| `minorLeagueRoster.ts` (affiliate health) | 737 | `rehabAffiliateHealth` only |
| `pitcherRosterSimulation.ts` | 512 | none |
| `rehabAssignments.ts` | 42 | `rehabAffiliateHealth` |
| `destinationFit.ts` (Player Development) | 1,452 | `destinationFit` |
| `prospectAssignments.ts` (Player Development) | 695 | `prospectAssignments`, `philosophyBoundary` |
| `prospectDecision.ts` (Player Development) | 524 | `prospectDecision`, `demotion`, `philosophyBoundary` |
| `developmentFit.ts` (Player Development) | 453 | `developmentProtection` |
| `assignmentPreference.ts` (Philosophy) | 286 | `philosophyBoundary` |
| `org.ts` `computeProspects` + farm routes | 834 | `prospects`, `prospectLevels` |
| `FarmSystem.tsx` / `FarmDecisions.tsx` / `FarmAffiliates.tsx` | 27K / 29K / 26K | none |

**8,386 lines of affiliate solver and retention logic carry no dedicated test.**

## 1.2 What the existing system actually does on the real save

Everything below is measured, read-only, through the production functions.

```text
Affiliate health        7 affiliates: 5 healthy, 2 thin
Position operations     0 plans · 23 rejections · 0 indeterminate · 1 deferred
Pitching operations     0 plans · 24 rejections · 0 indeterminate
Retention               141 protected · 104 retain · 1 expendable · 0 release · 0 indeterminate
Player Development      75 of 247 minor leaguers evaluated (30%)
Dashboard front door    "Promotion signals: 42"
```

The subsystem produces **no actionable output at all** for a 247-player
organization, while the Dashboard advertises 42 promotion signals and the
prospect list is topped by three players aged 26, 29 and 26. The two halves of
the product disagree with each other, and the half that is wrong is the one on
the front page.

## 1.3 Component-by-component decisions

Legend: **RETAIN** / **REFINE** / **REPLACE** / **REMOVE** / **DEFER**.

### C-1 `minorLeagueRoster.ts` — affiliate roster health → **REFINE**

**Purpose.** Is each affiliate operationally able to field a team and cover a
schedule?

**Mechanism.** Reads the real affiliate tree recursively (correct: it does not
assume one club per level). Counts active-list bodies, splits hitters/pitchers,
computes maximum bipartite matching of hitters to the eight fielding positions,
counts per-position playable coverage, counts OOTP role codes 11/12/13 for
rotation and bullpen, reports raw fatigue, and emits a status
(`critical`/`thin`/`healthy`/`surplus`) plus prose `issues[]`.

**Inputs.** `team_roster` list 2, `players` (position, role, injury, fatigue),
stamina and fielding grades via `scoutedEvidence`/`scoutedGloves`. Rehab
assignees excluded via `rehabAssignments` (D-026).

**Ownership.** Correct — operational health is Minor League Operations'.

**Evidence boundary.** Clean. No `players_value`, no rating column, ratings only
through the adapter. Verified by `tests/evidenceBoundary.test.ts`.

**Unknown handling.** Mostly good: stamina unknown stays unknown, a missing
export column is read as 0 with a comment. One soft spot: `hitterEligibility`
adds a player's *listed* position to his playable set with **no rating at all**,
so "coverage" conflates a revealed grade with a roster label. That is defensible
(the listed position is objective) but the two are not distinguished in the
output, so a position covered only by labels looks the same as one covered by
graded fielders.

**Philosophy.** Not consulted. Correct.

**Operational usefulness.** Partly. It answers "can this club field nine?" and
nothing else. The measured consequences on the real save:

* **Surplus is reported as healthy.** The ACL affiliate carries **28 pitchers, 23
  of them relievers**, and is `healthy` overall. DSL Red carries **nine left
  fielders, seven centre fielders and seven right fielders against two second
  basemen, two third basemen and one shortstop**, and its only issue is the
  shortstop. Twenty-three relievers at one affiliate is the single largest
  playing-time problem in the organization and the model has no vocabulary for
  it.
* **Role counts are not staff construction.** Reno reads `rotation: thin` on four
  role-11 starters while carrying **nine relievers**. The obvious internal answer
  (one of nine relief arms takes the fifth start) is not representable, and
  `starters >= 7` is called `surplus` — so six starters competing for five
  rotation spots is "healthy".
* **Issues are prose.** `issues: string[]` is exactly MLB's F-10: the reason a
  flag exists has to be reconstructed from a sentence. No structured explanation,
  no evidence, no what-would-change-it.
* **Thresholds are scattered magic numbers** (hitters 12/17, pitchers 12/18,
  rotation <4/4/≥7, bullpen <5/<7/≥12, `PLAYABLE_RATING` 35, `STRONG_RATING` 50,
  priority positions C/SS/CF) with no stamp, and three of them are duplicated in
  `minorLeagueMoves.ts` and `pitcherRosterSimulation.ts`.

**MLB integration.** Yes, and it is the best existing integration: the
`RosterHealthScenario` hook lets MLB Operations ask "what does Reno look like
without this pitcher?" read-only. **Retain that idea outright.**

**Decision: REFINE.** Keep the affiliate tree walk, the bipartite matching, the
rehab screen, the scenario hook and the operational/positional split. Change: add
congestion and available-work as first-class outputs, split operational health
from developmental health, replace prose `issues` with structured findings,
separate graded coverage from listed coverage, and move every threshold into one
stamped declaration.

---

### C-2 `minorLeagueMoves.ts` — position-player operations → **REPLACE**

**Purpose.** Find the smallest set of moves that makes an unhealthy affiliate
healthy without breaking the source.

**Mechanism.** For each affiliate whose `overall` is not healthy and whose level
is below Rookie: build a candidate pool from same-level peers (reassignment), the
level below (promotion), the level above (demotion); require Player Development
authorization for level changes; depth-first search for the minimum-length move
set that makes the destination healthy; rank completed plans by `planScore`.

**Inputs.** Affiliate health, `computeProspects` assignment evaluations,
`developmentFit` protection and position-assignment fit, philosophy dimensions.

**Ownership.** Nominally correct (development authorizes, operations solves) but
three violations in practice, below.

**Evidence boundary.** Clean on ratings.

**Unknown handling.** Good in shape: `hasKnownTier` diverts indeterminate players
to an `indeterminate[]` list with the destination's roster need, never approved
and never rejected, and `requireKnownProtection` throws rather than pick a tier.
This is the D-018 pattern done properly and is worth carrying over.

**Philosophy.** Applied only to candidates Player Development already authorized —
but as a term inside a single cost, not as a visible preference among defensible
options, and it never reads `assignments.preference` (the documented D-019 gap).

**Operational usefulness: none, measurably.** Findings:

* **BUG — a pitching problem drives a hitter search.** `combinedStatus()` folds
  `pitchingRisk(team)` into the destination status that gates the position-player
  search. Reno's only problem is its rotation, so position operations opens a
  search it can never finish (adding hitters cannot make `pitchingRisk` healthy),
  walks the whole organization, and emits 23 rejections. `plans = 0` is not
  "nothing to do"; it is a search that could not terminate successfully.
* **SYSTEMATIC — the rejection list is phantom candidates.** All 47 rejections
  (23 position + 24 pitching) are moves *to Reno*, and 36 of them are **skip-level
  promotions from A-ball to Triple-A** that nobody would propose. The GM is shown
  "Gian Zapata: readiness 20, performance 12, rejected for a skip to Triple-A" —
  a player struggling in Low-A presented as a considered and rejected candidate
  for a two-level jump. This is MLB's F-3 (a generator that always finds someone)
  turned into the module's entire output.
* **SYSTEMATIC — the solver is structurally inert for a normal organization.**
  Sources are restricted to *other clubs at the same level*, the level below and
  the level above. **The affiliate itself is never a source**, so no internal role
  or position change is representable. Arizona has one club at Triple-A, one at
  Double-A, two at A and three at Rookie (deferred), so same-level redistribution
  exists only between Hillsboro and Visalia. MLB Operations' single most-used
  response direction — the internal role change — has no analogue here.
* **SYSTEMATIC — a magic score.** `planScore()` sums development cost,
  philosophy adjustment, `(100 − assignmentFit) × 0.5`, `concentrationPenalty × 3`,
  `−assignmentNeed × 1.25`, `−min(coverageBenefit, 250) × 0.8` and
  `−versatility × 10` into one number, and `bestAssignment()` blends
  `fit × 0.45 + need × 0.30 + coverage × 0.25 − penalty`. Development, roster need,
  positional scarcity, versatility and organizational preference are collapsed
  into a scalar the GM cannot decompose. This is the explicit lesson E from the
  MLB phase.
* **MISSING — the question is never asked of a player.** The module is
  destination-driven. It has no concept of "is this player's current assignment
  defensible?", no playing-time model, and no notion of one prospect blocking
  another (`concentrationPenalty` is a ranking term, not a reported conflict).

**MLB integration.** None: it does not know a player may be recalled, and cannot
be asked what happens after one leaves.

**Decision: REPLACE.** Preserve and carry forward, verbatim in intent: the
three-state indeterminate handling, `requireKnownProtection`, the core-prospect
and protected-prospect guards, the bipartite matching, the source-health
safeguard, the read-only contract, and the `safeguards[]` idea (which is good
product writing). Replace the destination-driven minimum-move search and
`planScore` with a player-centred assignment review plus an explicit,
step-by-step cascade whose steps are each independently defensible.

---

### C-3 `minorLeaguePitchingOperations.ts` — pitching operations → **REPLACE**

Same architecture as C-2 (candidate pool → search → `planScore`), same defects,
plus its own:

* `pitchingNeedScore()` weights `statusNeed(body,100,45) + statusNeed(rotation,125,65)
  + statusNeed(bullpen,110,55)` — another scalar need score.
* It *does* know a pitcher's developmental role (`developmentalRole` from
  `evaluatePitcherDevelopmentalRole`), and `developmentalDestinationRole()`
  correctly refuses to treat "closer" as a developmental track. **That idea is
  sound and is the one genuinely development-first piece of pitching logic in the
  farm: keep it.**
* But nothing asks "who needs innings?", "who is blocked from starting?", "does
  this affiliate have a defensible rotation at all?". A staff is a count of role
  codes. Reno's 4-and-9 split is invisible as a construction problem.
* Zero plans on the real save; 24 rejections, 19 of them skip-level.

**Decision: REPLACE**, retaining `developmentalRole`, the role-code normalization,
the indeterminate handling and the source-health safeguard.

---

### C-4 `pitcherRosterSimulation.ts` → **REFINE**

A pure count-level evaluator plus a read-only hypothetical transfer. The purity
and the read-only simulation are right, and `evaluatePitcherCounts` being
independently testable is right. But it duplicates
`minorLeagueRoster`'s thresholds by hand (with a comment promising they match —
they do today, which is luck, not enforcement), and its `PitcherRosterState` is
counts only.

**Decision: REFINE.** Keep the pure evaluator and the transfer simulation; make it
consume the single stamped threshold declaration instead of its own copies, and
extend the state with rotation-spot and innings-availability structure.

---

### C-5 `minorLeagueRetention.ts` → **REPLACE (ownership) / REFINE (evidence)**

**Purpose.** Which minor leaguers no longer have an organizational case?

**Mechanism.** Per player: developmental protection score, a developmental
runway, development history, peer-relative development pace, an organizational
`utility` score, a `rosterPressure` score, a philosophy adjustment, then a
cascade of hard guardrails followed by threshold comparisons producing
`protected` / `retain` / `expendable_depth` / `release_candidate` /
`indeterminate`.

**What is genuinely good.** The **separation of evidence kinds** is the best idea
in the existing farm: developmental value, organizational utility, roster
pressure, transaction guardrails, observed development and peer pace are computed
and reported *separately*, each with its own reasons. The guardrail-first
ordering is right (a 40-man player or a major-league contract is an MLB question
before it is a farm question). `indeterminate` is a real outcome. Release language
is explicitly advisory.

**What is wrong.**

* **Philosophy is folded into a development quantity that gates a decision.**
  `developmentScore = protection.score + philosophyAdjustment`, and
  `developmentScore < 42` (and `< 30`, `< 25`, `>= 35`, `>= 30`) then gate
  release. Prospect-preservation, upside preference and age-curve sensitivity move
  a number that decides whether a player is a release candidate. This is the
  documented D-019 remaining gap and it is a live boundary violation: two clubs
  with identical players and identical evidence get different retention verdicts
  because of philosophy, in a judgment that is partly developmental.
* **Opaque composite scores.** `utility` and `rosterPressure` are 0–100 scalars
  built from many terms; the reasons are prose beside the number, not the number's
  parts.
* **Threshold soup.** 42/45/50, 35, 30, 24/25/30/70, 26/30/30/60 scattered
  through `recommendationFor`, unstamped, undocumented, untested.
* **Degenerate base rate.** 141 `protected`, 104 `retain`, 1 `expendable`, 0
  `release_candidate`, 0 `indeterminate` on 246 players. The guardrail "Rookie-level
  developmental runway remains open" suppresses all 125 complex-league players, so
  retention is silent about half the organization by construction. The rest is
  `retain` because `legalMoves.length > 0 || internalNeed.length > 0` returns
  `retain` immediately, and almost every minor leaguer has some legal move.
* **`minorLeagueRetention.ts` still reads raw roster flags** (`is_on_secondary`,
  `is_on_dl`, `must_be_active`, `is_major`) for its own guardrails instead of
  Player State / Player Rights. It draws no rights conclusion, so it was left
  alone before; with Player State available it should read the state layer.

**Decision: REPLACE the decision layer, REFINE the evidence layer.** Keep the
separated evidence dimensions and the guardrail-first ordering; move the
guardrails onto Player State; take philosophy out of the developmental quantity
entirely and express it as a preference among defensible conclusions; replace the
scalar-threshold cascade with explicit, named, stamped conditions.

---

### C-6 `prospectDecision.ts` — readiness → **REFINE (the model), RETAIN (the scaffolding)**

**Purpose.** Is a more challenging assignment developmentally supported?

**Mechanism.** `readiness = 0.75 × performance + 0.25 × ratingsMaturity`, where
`performance` is a rescaled OPS-above-level-average (batters: `50 + diff × 250`)
or a 70/30 blend of ERA-below-average and K%-above-average (pitchers), and
`ratingsMaturity = 90 − 2.8 × (potential − current)`. Promote when
`readiness ≥ 76 ± ageAdjustment(±5)` with a sample floor.

**What is right, and must survive.** The three-state evidence model, the explicit
`readinessRange` when ratings are unknown, evaluating the recommendation at both
ends of that range and returning `indeterminate` only when they disagree, the
refusal to let philosophy near any of it, the separation of sample confidence from
readiness, the deliberate difficulty of demotion, and the `positives`/`cautions`
explanation. This scaffolding is the same quality as MLB v2's and is **RETAINED**.

**What is wrong with the model inside it.**

* **It is a promotion score dominated by one statistic.** Solve the arithmetic:
  with maturity at its ceiling (90) a batter still needs `performance ≥ 71`, i.e.
  **OPS ≈ 85 points above his level average**; at maturity 50 he needs
  `performance ≈ 85`, i.e. **≈ 139 points above**. Promotion defensibility is, in
  practice, "is his OPS well above the level average". That is the rule the phase
  brief forbids.
* **Demotion is the mirror image.** `performance ≤ 25` is OPS ≈ 100 points *below*
  average. Guarded by sample and age, but still "poor numbers → demote".
* **"No remaining upside" raises readiness.** `ratingsMaturity` rewards a small
  current-to-potential gap, so a 29-year-old whose current equals his potential
  scores 90 — the maximum — and is *more* promotable than a 20-year-old with
  growth left. Measured consequence on the real save: **Luken Baker, age 29 at
  Double-A (level average age 24.8), OPS 1.304, `consider_promotion`**, with the
  threshold *lowered* by five points because he is four years older than his
  level. **Ivan Melendez, 26, in Low-A, OPS 1.183, `consider_promotion`**,
  threshold lowered the same way. The model reads "old for the level" as
  developmental urgency when it is usually evidence that the player is
  organizational depth, not a prospect.
* **The peer pool for the performance lens is wrong** — see §1.4.
* **Role and position are absent.** The same OPS is the same evidence at catcher
  and at first base; a starter and a reliever are compared on the same ERA/K
  blend. MLB Operations learned exactly this lesson (D-040) and the farm has not.
* **No park adjustment, no league-relative shrinkage, no multi-season weighting** —
  all of which MLB Operations has and calibrated (D-037).
* **Prior level experience, playing-time opportunity and development history do
  not enter.**

**Decision: REFINE.** Keep the module, its three-state contract, its philosophy
independence and its explanation. Replace the inside: a level-and-league-relative,
park-adjusted, sample-aware production lens; a tools lens; role and position
context; age-relative-to-level as *stakes and time remaining* rather than as a
threshold discount; and a separate question — "is the current assignment
defensible?" — which the module cannot currently ask at all.

---

### C-7 `prospectAssignments.ts` → **RETAIN**

Constraints with `satisfied` / `not_satisfied` / `unknown`, a judgment derived
from them, `eligible` true only for `defensible`, blockers only for a rejection,
`missingEvidence` only for indeterminate, per-kind requirements shown as numbers,
and an explicit skip-level ladder. This is the right shape and matches the MLB
subsystem's staged contract.

The one substantive gap: the set of `AssignmentConstraint` ids is
production/ratings-only (`readiness`, `performance`, `ratings_maturity`,
`sample_confidence`, `demotion_case`, `engine_scope`, `destination_fit`). v2 adds
constraints without changing the mechanism.

**Decision: RETAIN**, extended with new constraint ids.

---

### C-8 `destinationFit.ts` → **RETAIN with one REFINE**

Percentile comparison of a player's visible tools against the **destination
league's** active population, with a weighted composite, a weakest-core-skill
percentile, a `populationMinimum` guard of 25, explicit `unassessedComponents`,
policy-stamped skip-level gates, and `asPitchingRole` for reading a starter's
tools as a reliever. Correct ownership, clean evidence, honest unknowns.

**Peer pool: verified clean.** The population is `teams.league_id = destination
league AND team_roster.list_id = 2 AND retired = 0`, split hitter/starter/reliever.
Amateur signings are on **no roster list at all** in this save (148 players,
`players.league_id = -203`, ages 16–19), so they never enter. The MLB pool reads
390 hitters with zero mismatches. **The MLB F-0 contamination does not reach
`destinationFit`** — but see §1.4 for where it does reach the farm.

**REFINE:** a population below 25 is treated as `not_satisfied` rather than
`unknown` (existing documented gap), and the destination league for a
multi-affiliate level is whichever club is asked about — correct, but the
*performance* baseline it sits beside is per-level, so the two lenses disagree
about what the peer group is.

**Decision: RETAIN.**

---

### C-9 `developmentFit.ts` — protection tiers and position fit → **REFINE**

`score = 0.60 × potential + 0.20 × upside + 0.10 × youth + 0.10 × current` →
five tiers (`core_prospect` ≥ 78, `protected_prospect` ≥ 57,
`development_priority` ≥ 42, `normal` ≥ 25, else `organizational_depth`), with
`score`/`tier` `null` when either rating is unknown, `hasKnownTier` /
`requireKnownProtection` type guards, and per-position assignment `use` grades.

**Right:** the tier concept is load-bearing and used well — it is the
"developmental stakes" input MLB Operations already depends on (D-025), the
core-prospect guard, and the retention guardrail. The null-tier discipline is
exemplary. The phase brief says not to build a new prospect ranking system unless
an architectural problem requires it; none does.

**Wrong:** it is an **absolute-scale composite with no peer comparison** — a
20-potential player at the Dominican Rookie League and a 20-potential player at
Triple-A get the same tier. And the composite is the unweighted mean of visible
tools, which MLB's calibration measured as materially worse than the tools model
(R² .35–.37 against .40–.45).

**Decision: REFINE** — keep the tiers, the thresholds and the null discipline; make
the inputs consistent with the calibrated tools model where a tools model exists;
stamp the thresholds; do not rebuild the tier system.

---

### C-10 `assignmentPreference.ts` → **RETAIN, and finally consume it**

Ranks the defensible promotion-direction assignments plus staying, annotating
each `preferred` / `acceptable` / `disfavored`, never touching a judgment. Exactly
the D-019 contract. **No farm module reads it.** Operations instead applies its own
philosophy-weighted costs inside `planScore`.

**Decision: RETAIN and consume.** v2 reads the preference object and drops the
in-solver philosophy terms.

---

### C-11 `org.ts` `computeProspects` — the legacy verdict layer → **REMOVE (the legacy half)**

`computeProspects` returns, in one payload, **two independent promotion verdicts
for every player**:

1. `decision` / `assignments` — the principled engine (C-6, C-7).
2. `signal` and `score` — a raw statistical rule:
   `opsDiff >= 0.075 && pa >= 100 → 'promote'`, `eraDiff >= 1.0 && ip >= 30 →
   'promote'`, `overmatched(...) → 'demote'`, `score > 5 → 'watch'`, where
   `score = opsDiff × 300 + ageDiff × 8` (batters) or
   `eraDiff × 12 + kDiff × 200 + ageDiff × 8` (pitchers). The lists are **sorted by
   that score**.

This is literally the `OPS > threshold → promote` rule the phase brief forbids, it
is a second demotion rule that bypasses `prospectDecision.demotionCase`, and the
sort makes the payload a promotion leaderboard. Measured on the real save:

* `signal`: 15 `promote`, 26 `watch`, 1 `demote`, 33 null.
* **The Dashboard reads it**: `promoteSignals = signals.filter(s => s !== null).length`
  → the front page of the application says **"Promotion signals: 42"**, counting
  every `watch`, for an organization in which Minor League Operations proposes
  nothing.
* **The AI briefing prompt reads it** and is given a paragraph explaining what "a
  prospect signal of 'promote'" means.
* It **disagrees with the engine on 6 of 75 players**, including
  `signal=promote / engine=hold` for Ruben Santana (21, A) and Jacob Steinmetz
  (22, A), and `engine=mlb_ready_discussion / signal=null` for Shawn Dubin.
* The leaderboard's top three are **Luken Baker (29), Ivan Melendez (26) and
  Adrian Del Castillo (26)** — the ordering is "how far above level average is his
  OPS", so late-twenties organizational depth tops the organization's prospect
  list.

**Decision: REMOVE** `signal` and `score` as decision outputs. The Dashboard chip
and the AI context must read the engine. The objective statistics themselves
(`opsVal`, `era`, `kpct`, `war`, `pa`, `ip`) and the `reasons` prose stay: they are
facts.

---

### C-12 `rehabAssignments.ts` → **RETAIN**

42 lines, does one thing correctly (D-026), and is the reason Reno's rotation
reads honestly rather than being propped up by a rehabbing major leaguer. Keep as
is, and make v2 surface a rehab assignee as visible temporary roster context
rather than only excluding him.

---

### C-13 Rookie-level handling → **REPLACE the deferral**

`minorLeagueMoves` and `minorLeaguePitchingOperations` both refuse any
Rookie-level destination ("deferred until ACL/DSL assignment rules are modeled
explicitly"), and `computeProspects`'s sample gates (60 PA / 15 IP) exclude every
complex-league player. Combined effect on the real save:

| Level | Assigned | Evaluated by Player Development |
|---|---|---|
| AAA (Reno) | 33 | 23 |
| AA (Amarillo) | 28 | 14 |
| A (Hillsboro + Visalia) | 61 | 38 |
| **Rookie (ACL + 2 × DSL)** | **125** | **0** |
| Total | 247 | 75 (30%) |

**Half the organization is invisible to the farm system, and is not even reported
as "cannot evaluate".** Retention suppresses all of them via the open-runway
guardrail. This is the largest single gap in the subsystem.

**Decision: REPLACE the silent deferral with explicit, honest coverage.** Complex
levels get affiliate health, congestion and playing-time analysis (which need no
promotion judgment), and a player with no qualifying sample is reported as
*not assessable, with the reason*, rather than omitted. Cross-affiliate Rookie
*movement* stays **DEFER** (eligibility and geography genuinely are unmodelled),
but the deferral is now stated per affiliate instead of swallowing the level.

---

### C-14 Farm UI (`FarmSystem` / `FarmDecisions` / `FarmAffiliates`) → **REFINE into a workspace**

Three pages, 82 KB of TSX, no URL-hash routing, no deep links, no tests.

| Page | Contents, in scroll order | Problem |
|---|---|---|
| Overview (`FarmSystem`) | fog-of-war note → "What needs your attention" as four metric tiles → every affiliate as a card → recommended moves → release candidates → expendable depth | The attention section counts outputs that are 0, 0, 0 and 1 on the real save. No system-wide view. Affiliate cards are a list, not a diagnosis. |
| Decisions (`FarmDecisions`) | assignment cards → release-candidate cards → expendable-depth cards | Duplicates Overview's retention sections; "Decisions" is a list of players, not a decision workspace. There is no cascade, no consequence, no alternatives. |
| Affiliates (`FarmAffiliates`) | hero → analysis grid → coverage cards → roster tables | The strongest of the three. Missing the operational-vs-developmental split and any congestion or playing-time reading. |

Against the MLB module's five views (D-043) the farm has: an Overview that does
not prioritise, no Organization view, an Affiliates view that is halfway there, no
Assignments view, and no Decision workspace.

**Decision: REFINE** into one module with progressive disclosure and hash routing,
reusing the MLB views' vocabulary (`src/pages/mlb/common.tsx`) so the two feel
like siblings.

## 1.4 Peer-pool audit (MLB lesson A)

The MLB hardening phase found that a SQL join is not a baseball peer group. Every
farm comparison group was re-derived and measured.

| Comparison | Pool as built | Verdict |
|---|---|---|
| `destinationFit` tool percentiles | destination **league**, active list, hitter/starter/reliever split | **Clean.** Amateurs are on no roster list; 0 mismatches across all 15 leagues. |
| `scoutedFieldingPopulation` | players listed at the position in the league | Clean (same filter). |
| `prospectDecision` performance vs `levelBaselines.avgOps/avgEra/avgKpct` | **one baseline per LEVEL**, all leagues pooled, unweighted mean of player rates, no park adjustment | **Broken — see below.** |
| `levelBaselines.avgAge` | every player whose `team_id` is at that level, **no roster-list filter** | **Contaminated.** |
| `developmentFit` protection tier | none (absolute rating scale) | No pool; a documented limitation, not a bug. |
| Affiliate coverage counts | the affiliate's own active list, rehab excluded | Clean. |

### F-0-farm — amateur signings contaminate the level average age

`levelBaselines` selects `players JOIN teams WHERE t.level >= 1 AND
t.allstar_team = 0` with **no `team_roster` filter**, so it includes the 148
unassigned amateur signings (ages 16–19, mean 16.2) that sit on a parent club's
`team_id` with no roster entry — the very players `orgPlayers` has a comment
about.

| Level | avgAge as computed | avgAge, rostered players only | Error |
|---|---|---|---|
| 1 (MLB) | **27.10** | **28.87** | **−1.77 years** |
| 2–6 | unchanged | unchanged | none |

`ageDiff = levelAvgAge − playerAge` drives `ageLevelPressure`, which sets
`ageThresholdAdjustment = clamp(ageDiff × 1.5, −5, +5)`. A 1.77-year error is
**2.66 threshold points of a ±5 range** — over half the age mechanism — for every
major-league player evaluated, and the wrong baseline is printed to the user as
"level avg". Same class as MLB's F-0, same fix: a peer must be on a roster.

### F-1-farm — one baseline per level pools leagues with different environments

Measured average OPS of qualified hitters (≥ 50 PA at the level), by league:

| Level | League | n | avg OPS | Arizona affiliate |
|---|---|---|---|---|
| 2 | International | 244 | .7802 | |
| 2 | **Pacific Coast** | 112 | **.7455** | **Reno** |
| | *pooled level-2 baseline* | | *.7692* | |
| 3 | Eastern | 125 | .7635 | |
| 3 | Southern | 88 | .7914 | |
| 3 | **Texas** | 87 | **.7913** | **Amarillo** |
| | *pooled level-3 baseline* | | *.7797* | |
| 4 | **Northwest** | 70 | **.7909** | **Hillsboro** |
| 4 | **California** | 97 | **.7475** | **Visalia** |
| 4 | Carolina | 137 | .7731 | |
| 4 | Florida State | 109 | .7777 | |
| 4 | Midwest | 126 | .7555 | |
| 4 | South Atlantic | 121 | .7550 | |
| | *pooled level-4 baseline* | | *.7653* | |
| 6 | Florida Complex | **2** | .9023 | |
| | *pooled level-6 baseline* | | *.9023* | |

Consequences, in the units the model uses (`performance = 50 + opsDiff × 250`,
threshold 76, "strong" band 8 points):

* **Reno** hitters are measured against a baseline **24 OPS points too high** →
  6 performance points → **4.5 readiness points** against them.
* **Amarillo** hitters are measured against one **12 points too low** → flattered
  by ~2 readiness points.
* **Hillsboro and Visalia are two affiliates of the same organization at the same
  level in leagues 43 OPS points apart**, and are given the same baseline:
  Hillsboro penalised ~26 points, Visalia flattered ~17. A promotion case can flip
  on which A-ball club a player happens to be assigned to.
* **The entire Rookie-level offensive baseline is two players** from a league
  Arizona does not field a club in. It is never used today only because no
  complex-league player clears the 60-PA gate — which is itself the C-13 gap.
* There is **no park adjustment anywhere in the farm**, while MLB Operations
  park-adjusts wOBA.

**Decision:** the performance lens must be **league-relative and park-adjusted**,
matching `destinationFit`'s per-league pool and MLB Operations' `resultsMetrics`.
A level-pooled baseline is reported only as context, never as the comparison.

## 1.5 Old assumptions that are no longer acceptable

1. Good statistics at the current level are promotion authorization
   (`readiness` ≈ scaled OPS diff; `signal = 'promote'`).
2. Poor statistics are demotion authorization (`performance <= 25`, `overmatched`).
3. Older than the level means developmental urgency, so the bar should fall.
4. A small current-to-potential gap is readiness.
5. A level is a peer group.
6. Surplus is health.
7. A role count is a pitching staff.
8. An affiliate's problem is a body-count problem, so the answer is a transfer
   from another affiliate.
9. Many structured dimensions can be summed into one plan score.
10. Philosophy may move a developmental quantity as long as it is a "retention"
    quantity.
11. A flag can be explained in prose.
12. A player with no qualifying sample can simply be omitted.
13. Rejections of moves nobody proposed are useful output.
14. A destination status may mix pitching and hitting when the search can only
    change one of them.

## 1.6 Direct boundary violations found

| # | Violation | Location |
|---|---|---|
| V-1 | Philosophy is added to a development quantity that gates a decision | `minorLeagueRetention.ts` `developmentScore = protection.score + phi.adjustment` |
| V-2 | A second Player Development verdict, on raw statistics, outside the Player Development modules | `org.ts` `signal`, `score` |
| V-3 | Player Development's preference object is ignored and operations re-derives philosophy weighting inside a cost | `minorLeagueMoves.ts`, `minorLeaguePitchingOperations.ts` `philosophyInfluence` |
| V-4 | Raw roster-status columns read for guardrails instead of Player State | `minorLeagueRetention.ts` (`is_on_secondary`, `is_on_dl`, `must_be_active`, `is_major`) |
| V-5 | A peer population built without a roster filter | `org.ts` `levelBaselines` |
| V-6 | Operational thresholds duplicated in three modules with no single declaration | `minorLeagueRoster`, `minorLeagueMoves`, `pitcherRosterSimulation` |

No evidence-boundary violation was found: every farm module reads ratings only
through `scoutedEvidence.ts`, and `tests/evidenceBoundary.test.ts` already guards
all five.

## 1.7 Strongest existing ideas, to preserve

1. **Separated evidence dimensions with their own reasons** (retention).
2. **Three-state judgment discipline**: `hasKnownTier`,
   `requireKnownProtection`, `indeterminate[]` lists carrying the roster need,
   `readinessRange` evaluated at both ends.
3. **The read-only affiliate scenario** (`RosterHealthScenario`) — already the
   MLB ↔ farm bridge.
4. **Recursive affiliate-tree discovery** — no hardcoded Arizona.
5. **Maximum bipartite matching** for "can this club actually field nine?".
6. **Developmental pitcher role separate from OOTP usage**, and "closer is usage,
   not a development track".
7. **Rehab assignees are not affiliate depth** (D-026).
8. **`safeguards[]`** — the module states its own limits in the response.
9. **Per-league percentile destination fit** with an explicit population minimum.
10. **The professional-lines-only and per-level stat keying fixes** in
    `computeProspects` (real bugs, well fixed, well commented).

## 1.8 Weakest mechanisms, in order

1. The destination-driven minimum-move search (C-2, C-3) — inert and noisy.
2. `planScore` / `pitchingNeedScore` / `utility` / `rosterPressure` — magic scores.
3. `readiness` as a production-dominated scalar (C-6).
4. The legacy `signal` / `score` layer (C-11).
5. The Rookie-level deferral and sample-gate silence (C-13).
6. Philosophy inside the retention development score (V-1).
7. Level-pooled, park-blind performance baselines (F-1-farm).
8. Prose `issues[]` as the only explanation.

---

# Part 2 — Minor League Operations v2

Status: **built** (`feature/mlb-operations-v2`). Decisions D-044 to D-046.

## 2.1 Sibling subunits of one baseball-operations system

```text
                          Baseball Operations
                                  │
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
      MLB Operations                        Minor League Operations
   "how do we solve major-league         "how do we organize the farm so players
    roster problems?"                     develop and affiliates stay functional?"
              │                                       │
              └──────────────► shared specialists ◄───┘
                     Scouted Evidence · Player Development
                     Player State · Player Rights · Philosophy
                     objective statistics
                                  │
                                  ▼
                        organizational effects
```

Neither module owns a specialist and neither reaches into the other's solver.
They exchange **consequences** across one explicit contract (Part 3), and
`tests/farmOperationsBoundary.test.ts` and `tests/mlbOperationsBoundary.test.ts`
hold the line in both directions.

## 2.2 The pipeline

```text
organization-visible evidence   scoutedEvidence (D-017) · Player State (D-020) · statistics · usage
  → production, league-relative  farmResults (per LEAGUE, park-adjusted, sample-aware) · farmUsage
  → is the level developing him   currentAssignment  (Player Development; no philosophy)
  → can he get the work          playingTime  (conflicts, never a score)
  → the assignment               farmAssignments  (composes both + prospectAssignments + destinationFit
                                                   + assignmentPreference)
  → the club, read twice         farmAffiliate  (operational health | developmental health)
  → the system                   farmOrganization  (congestion, depth, starters against spots)
  → what follows one move        farmCascade  (each step defensible, and it stops)
  → does he still have a case    farmRetention  (outlook | pressure | stance, three owners)
  → the service                  farmOperations  (reads the save, wires the specialists, serves the API)
  → the workspace                src/pages/MinorLeagueOperations.tsx and src/pages/farm/
```

Everything from `currentAssignment` to `farmRetention` is pure: evidence in,
conclusions out, no table and no rating column. `farmOperations.ts` does all the
reading, exactly as `mlbOperations.ts` does for the sibling module.

## 2.3 The concepts the farm owns

| Concept | Question | Owner |
|---|---|---|
| **Assignment review** | Is his level, role and usage defensible, and what else is? | Player Development judges; Minor League Operations composes |
| **Playing-time opportunity** | Can he get the work his development needs where he is? | Minor League Operations |
| **Affiliate operational health** | Can this club field a team and cover a schedule? | Minor League Operations |
| **Affiliate developmental health** | Are the players on this club developing appropriately here? | Player Development per player; Minor League Operations aggregates |
| **Organizational congestion / depth** | Where do prospects block each other; where is the system thin? | Minor League Operations |
| **Cascade** | If one player moves, what follows, and where does it stop? | Minor League Operations |
| **Retention** | Does he still have an organizational case? | split three ways (§2.9) |

## 2.4 The assignment model

`currentAssignment.ts` answers a question the farm v1 model could not ask at all,
and it is deliberately two readings rather than one score:

| | `mastered` | `holding` | `overmatched` | `indeterminate` |
|---|---|---|---|---|
| window `ample` | no longer developmental (developmental question) | appropriate | **appropriate** — struggling at a level he is young for is on schedule | indeterminate |
| window `normal` | no longer developmental | appropriate | too advanced | indeterminate |
| window `closing` | no longer developmental | appropriate | too advanced | indeterminate |
| window `closed` | no longer developmental (**organizational** question) | no longer developmental (organizational) | too advanced | indeterminate |

`holding his own` is the null reading, not a finding: moving off it in either
direction is a claim and needs both a clear gap (top or bottom sixth of his
league) and a sample worth something. A line too thin to read at all is
`not_assessable`, which is **distinct from `indeterminate`**: nothing is missing
that scouting could supply, the season has simply not happened.

`farmAssignments.ts` then composes that with playing time and the defensible
alternatives into one of eight descriptive conclusions — deliberately not a
promote/hold/demote trichotomy, because several are true of a real player at
once and the conclusion names the one that needs attention:

```text
current_assignment_defensible   the normal case, and most of the organization
promotion_direction_defensible  the level no longer develops him and a move up is defensible
demotion_direction_defensible   the level is ahead of him and a move down is defensible
opportunity_conflict            the level fits; he cannot get the work
organizational_blockage         another player holds the developmental path he needs
organizational_question         the level has no developmental value left; what he is for is the club's call
indeterminate                   required evidence is missing
not_assessable                  there is no season to read
```

**Order matters, and getting it wrong was a real defect.** Not playing outranks
the level question, because a prospect's thin sample is often *caused* by his not
playing and the two facts are one fact. Reading the level first put a
development-priority outfielder at Triple-A with twelve plate appearances — the
most attention-worthy case in the organization — in `not_assessable` / `routine`.

## 2.5 Playing time

`playingTime.ts` represents a conflict; it never scores one.

* **One man, one job.** A claim is the job he is actually trying to win — the
  position his usage shows he plays, or his listed position when usage shows
  nothing. Versatility is *cover*, which belongs to the operational reading. The
  first version counted a claim at every position a man had a revealed grade for,
  so one versatile twenty-year-old was reported blocked five times and the
  attention list ran to 137 items.
* **Competition, not absence.** A lone player not playing is a fact about him, in
  his own review; a conflict needs more claimants than the job supports.
* **Stakes make it matter.** Missing reps costs development only for a player
  Player Development places at `development_priority` or better. Without that
  test a thirty-three-year-old depth catcher read as "another player holds the
  developmental path he needs". Unknown stakes stay unknown and claim nothing.
* **A season is needed.** Below twenty club games no share is read and no conflict
  is reported; the affiliate view says how many games the club has played instead.
* **A rotation claimant is a man taking starts**, not every arm whose stamina
  would allow it. Whether a relief arm *should* be starting is a role-conversion
  finding Player Development owns, reported separately and quietly.

## 2.6 Affiliate health: two readings that stay apart

`farmAffiliate.ts` produces an operational status and a developmental status, and
never merges them. **Only a shortage is an operational state**: carrying more men
than the club has work for is a developmental problem, and reporting it as
`surplus` in the same field as `critical` is what let an affiliate with
twenty-three relief arms read as fine.

The operational status is derived *from the findings*, so the status and the list
can never disagree — reading it off raw counts had Reno `thin` with no finding to
show for it, because the rotation finding counts the men taking the starts and
the raw status counted the role codes.

## 2.7 Structured explanation (the farm's answer to F-10)

Prose `issues: string[]` is replaced by `FarmFinding`: a code, a lens, a
severity, the **owner** of the judgment, a headline, evidence items each with
their basis, the players it is about, what is **missing**, and what **would
resolve** it. Nothing in the module is a score, and no conclusion has to be
reconstructed from a sentence.

## 2.8 Cascades

`farmCascade.ts` follows one departure and stops. Termination is the point:

| Stop | Meaning |
|---|---|
| `absorbed` | the club can cover the vacancy from what it has — the move is free |
| `no_defensible_move` | nothing below is a defensible replacement |
| `indeterminate` | the next step needs evidence the organization does not have |
| `relocates_the_same_shortage` | the chain would hand the same hole down a level |
| `reached_lowest_level` | there is nothing below to draw from |
| `step_limit` | followed four steps; beyond that it is speculation |

An indeterminate best candidate stops the chain rather than falling through to a
worse but judgeable man, because that would present a move the organization has
no reason to prefer as though the evidence favoured it. The chain is only as
certain as its least certain step.

## 2.9 Retention: three questions, three owners

| Question | Owner | May philosophy reach it? |
|---|---|---|
| Is there still a development case for him? | Player Development | **No.** The outlook function does not mention a dimension, and a boundary test proves it. |
| Is he occupying something somebody else needs? | Minor League Operations | No |
| Which defensible conclusion does this club prefer? | Philosophy | Yes — as a stated lean on the ORDER and WORDING, after the outlook is fixed, and it can never turn a `retain` into a question |

A decision that belongs to another process (the 40-man, a major-league contract,
an injured list) is `not_a_farm_decision` and **names the process that owns it**,
while still reporting the farm's own reading beside it rather than suppressing it.
Somebody is "waiting on him" only if he is the one holding the work: a man who is
himself short of it occupies nothing.

## 2.10 Calibration discipline

Every farm constant is declared once, in `server/farmCalibration.ts`, stamped
`policy` or `provisional` (D-041's vocabulary; none is `calibrated` yet — see
§5). The boundary test fails if another module redefines one. `REGULAR_SHARE` is
re-exported from `lineupPicture.ts` rather than copied, because it is the same
concept and the same number as the major-league lineup's.

---

# Part 3 — The MLB ↔ farm consequence contract

Status: **built** (D-045). MLB Operations asks; Minor League Operations answers
and owns the calculation; MLB Operations displays it and never reconstructs it.

```text
MLB Operations                         Minor League Operations
──────────────                         ───────────────────────
mlbEvidence.farmConsequence(...)  ──►  farmConsequenceFor(orgId, playerId)
   direction 'leaves'                     │
                                          ├─ the job he vacates
                                          ├─ affiliateImpact (before / after / absorbed)
                                          ├─ playingTimeImpact (who gains the reps)
                                          ├─ replacementOptions (readiness order, never a score)
                                          ├─ cascade (steps, stop, stopDetail, unresolved, certainty)
                                          ├─ unresolvedIssues
                                          ├─ confidence + evidence (how it was measured)
   FarmConsequence.farm  ◄────────────────┴─ summary (one line to display)
```

* **Direction is enforced.** `tests/farmOperationsBoundary.test.ts` forbids every
  MLB module except the adapter from importing a farm module, and forbids any of
  them from containing `planCascade` or a chain planner of their own. This is why
  the old branch's `minorLeagueCascadePlanner` was deferred rather than adopted
  (MLB_OPERATIONS.md §2.1 item 12): it was a second farm solver inside MLB work.
* **An unresolved farm consequence is information, never an illegality.** Whether
  a transaction is possible is Player Rights'; nothing in the contract touches it.
  "The recall is feasible, and Double-A is left short at the rotation" is the
  intended output.
* **A rehab assignee costs the affiliate nothing** and the answer says so (D-026),
  rather than reporting a delta for a player the club never counted.
* **`joins` carries no farm answer**: nothing is vacated.

What MLB Operations consumes without re-running farm logic: the vacated job,
whether it can be absorbed, who could fill it and how certain each is, where the
chain stops, what is left open, and a one-line summary.

---

# Part 4 — The workspace

Status: **built** (D-046). One navigation entry, five views, addressable by URL
hash (`#/farm`, `#/farm/organization`, `#/farm/affiliates/<team id>`,
`#/farm/assignments`, `#/farm/decision/<player id>`).

| View | Owns | Deliberately not on it |
|---|---|---|
| **Overview** | "What needs my attention?" — one line on the system's scope, then an inbox, then an affiliate strip. | Any player table, roster or conflict detail. |
| **Organization** | System-wide congestion and depth, position distribution by level, starters against rotation spots, the depth players past their window. | One club's roster. |
| **Affiliates** | One club read twice, side by side: operational health (can it field a team?) and developmental health (are these players developing?). Coverage, conflicts, assignments worth reviewing, rehab context. | System-wide issues. |
| **Assignments** | Every minor leaguer's assignment, filterable to those in question, ordered by whether the GM needs to look and then by name — never by a score. | Roster mechanics. |
| **Decision** | One player, in the order a GM decides: why, what Player Development says, what else is defensible, what philosophy prefers, what he is getting, what follows if he moves, the cascade and where it stops, retention, what is uncertain, what remains his. | The rest of the system. |

**Visual cohesion with MLB Operations** is deliberate and structural: the shell,
the tab bar, the view-error boundary, the hash-routing shape and the chip
vocabulary (`Chip`, the `eligible` / `ineligible` / `indeterminate` colouring,
ordinals) are imported from `src/pages/mlb/`, not re-implemented. What differs is
what the farm talks about, not how it talks. Screens are not cloned where the
baseball workflow differs: the farm has no bench view and MLB has no affiliate
view.

---

# Part 5 — Calibration

Every farm constant is declared once in `server/farmCalibration.ts` and stamped.
**None is `calibrated`**, and that is stated rather than implied: the MLB results
model is backtested against 23 seasons of real major-league history
([CALIBRATION.md](CALIBRATION.md)), and the export contains no equivalent
minor-league history to fit against.

| Stamp | Constants |
|---|---|
| **policy** | `BODY_COUNT`, `ROTATION_SPOTS`, `RELIEF_CORPS`, `CRITICAL_POSITIONS`, `PLAYABLE_GRADE`, `STRONG_GRADE`, `POSITION_CAPACITY`, `REGULAR_PLAY_SHARE`, `STARTER_CAPACITY`, `RELIEF_CAPACITY`, `MINIMUM_CLUB_GAMES`, `YOUNG_FOR_LEVEL`, `OLD_FOR_LEVEL`, `AGE_LEVEL_DEVELOPMENT_LIMIT`, `UPPER_MINORS_DEPTH_FLOOR`, `PRIORITY_CONGESTION_AT`, `CASCADE_MAX_STEPS`, `RUNWAY_CLOSING_AGE`, `RUNWAY_SERVICE_LIMIT`, the level-standing percentiles and reliability lines |
| **provisional** | `MINIMUM_SAMPLE`, `MATURE_SAMPLE`, `LEAGUE_POPULATION_MINIMUM` — sample thresholds that ought to be estimated and cannot be yet |
| **architecture** (no stamp; tests pin it) | operational and developmental health are separate; a league is the peer group, not a level; one man one job; holding his own is the null reading; not-assessable is not indeterminate; philosophy only after defensibility |

A policy constant is decided, not fitted, so `npm run calibrate` is not re-run
for one. `npm run farm:base-rate` is the check on how often the module raises
something, and is re-run when a threshold or a definition changes.

---

# Part 6 — Real-save validation

Read-only against the imported Arizona save. Nothing was written to OOTP and no
owner experiment was asked for.

## 6.1 Base rate (`npm run farm:base-rate`)

| | Farm v1 | Farm v2 |
|---|---|---|
| Players the subsystem reasons about | 75 of 247 (30%) | **230 of 230 on an active list** (100%) |
| Read by Player Development | 75 | 87 assessed, 2 indeterminate, 141 not assessable **and each one says why** |
| Attention items | none (0 plans, 47 rejections of moves nobody proposed) | **18** — 11 attention, 7 noted |
| Assignment conclusions | — | 62 defensible · 7 blocked · 4 ready for more · 14 organizational · 2 indeterminate · 141 not assessable |
| Retention | 141 protected / 104 retain / 1 expendable / 0 indeterminate | 77 retain · 5 review · 1 not a farm decision · 147 indeterminate |
| Dashboard front door | "Promotion signals: 42" (counting `watch`) | 10, from Player Development's own recommendations |

The 11 pressing items: seven development-priority prospects blocked out of the
work their development needs, three A-ball players who have outgrown the level
with a defensible promotion, and one affiliate with a single shortstop.

## 6.2 Findings from the walkthrough

Classification as in the MLB phase: **BUG** fixed now; **SYSTEMATIC** a model
failure, refined; **DEBATABLE** a baseball judgment, documented and left as
policy.

| # | Finding | Class | Resolution |
|---|---|---|---|
| G-0 | `levelBaselines` built the level's average age from every player whose `team_id` pointed at a club, including 148 unassigned amateur signings aged 16 to 19. The major-league level's average age read 27.10 against 28.87 — a 1.77-year error, 2.66 points of the ±5 the age context may move the promotion threshold by, printed to the reader as "level avg". | **BUG** | A peer must be on a roster. Same defect and same fix as D-039. |
| G-1 | One baseline per LEVEL pooled leagues 35 to 43 OPS points apart: Reno (Pacific Coast, .7455) measured against a pooled .7692, and Hillsboro (Northwest, .7909) and Visalia (California, .7475) — two Arizona affiliates at the same level — against the same number. The Rookie baseline rested on two players of a league Arizona does not field a club in. | **SYSTEMATIC** | D-044. Production is league-relative and park-adjusted (`farmResults.ts`). |
| G-2 | Position-player operations was gated on a destination status that folded in `pitchingRisk`, so Reno's rotation problem opened a hitter search that could never terminate: 23 rejections, 0 plans. | **BUG** | The destination-driven search is gone (C-2 REPLACE). |
| G-3 | All 47 "rejections" were phantom candidates, 36 of them A-ball-to-Triple-A skips, including a player hitting at the 12th percentile "rejected" for a two-level jump. | **SYSTEMATIC** | Candidates are generated per vacancy, from the level below only, and a cascade reports what it considered rather than a rejection list. |
| G-4 | The solver's only sources were other clubs at the same level: with one club per level it was structurally inert for a normal organization, and an internal role or position change was not representable. | **SYSTEMATIC** | Role conversion is a finding; congestion and blockage are reported where they are; the cascade draws from the level below. |
| G-5 | A 29-year-old hitting 1.304 at Double-A was `consider_promotion` on a bar *lowered* five points for being four years older than his level, and topped a prospect list ordered by `opsDiff × 300 + ageDiff × 8`. | **SYSTEMATIC** | D-044. Age never lowers the developmental bar; he now reads "Double-A has no developmental value left for him; where he plays is an organizational question". |
| G-6 | `signal` and `score` were a second Player Development verdict on raw statistics, disagreeing with the engine for 6 of 75 players, and the Dashboard counted them. | **BUG** | Removed (C-11). |
| G-7 | Every playing-time claim was counted at every position a man had a grade for: 137 attention items, half of them the same problem restated. | **SYSTEMATIC** | One man, one job. |
| G-8 | "Being developed as a starter" read off stamina and repertoire, which made 31 of 42 Rookie-level arms developmental starters against 15 rotation spots. | **SYSTEMATIC** | A rotation claimant is a man taking starts; structure is a role-conversion finding. |
| G-9 | A blocked prospect's twelve plate appearances made him `not_assessable` and `routine` — the sample was the consequence of the finding. | **BUG** | Not playing is asked before the level. |
| G-10 | A thirty-three-year-old depth catcher read as "another player holds the developmental path he needs". | **BUG** | Blockage requires developmental stakes. |
| G-11 | Retention pressure named the other *blocked* prospect as "waiting on" a man who was himself getting no work. | **BUG** | Somebody waits on him only if he holds the work. |
| G-12 | Congestion and conflicts were read off complex affiliates that had played ten games and none at all. | **SYSTEMATIC** | Twenty club games before a share or a shape is read; the club says how many it has played. |
| G-13 | A 70th-percentile line meant "nothing left to learn here", which is 30% of every league by construction and was 8 of Reno's 22 assessed players. | **SYSTEMATIC** | The top and bottom sixth, with a sample that supports a claim; holding his own is the null reading. |
| G-14 | `sample_below_minimum` was printed to the reader. | **BUG** | Every reason carries its plain-words sentence. |

**Debatable, documented, not changed:**

* The policy quantiles behind "clearly better than the league" (the top and bottom
  sixth). The count of flags follows from the quantile by construction; the
  quantile is a decision.
* Whether twenty club games is the right gate for reading a share. It is what
  keeps a ten-game complex season from manufacturing conflicts, and it will look
  different in a save exported in April at every level.
* `AGE_LEVEL_DEVELOPMENT_LIMIT` at three years past the level's average. Fourteen
  of Arizona's minor leaguers are past it, which is the organizational depth every
  affiliate is partly built from; whether three years is the right line is a
  judgment, and it is the one constant with the largest effect on how many players
  read as an organizational rather than a developmental question.
* The complex-league rosters themselves. Arizona carries 125 players on three
  Rookie clubs, and whether 42-man complex rosters are a congestion problem or
  simply what a complex league is cannot be settled from the export.
* The protection tier remains an absolute-scale composite with no peer comparison
  (C-9), so a 20-potential player in the Dominican Rookie League and one at
  Triple-A share a tier. Rebuilding it was out of scope.

## 6.3 Known limitations

* No farm constant is calibrated against outcomes; the export has no
  minor-league history to fit against.
* Cross-affiliate Rookie-level *movement* remains deferred: eligibility and
  geography between an Arizona Complex League club and a Dominican one are not
  modelled. Rookie-level affiliates are otherwise fully covered (health,
  congestion, assignments, retention) rather than silently skipped.
* A promotion straight to MLB is Player Development's `mlb_discussion` and MLB
  Operations' to act on; the farm's alternatives exclude it by design.
* `destinationFit`'s population minimum of 25 is treated as `not_satisfied`
  rather than `unknown` (an inherited D-018 gap).
* (Resolved in Part 7.) The old solvers and the three old farm pages were left in
  the tree at the end of this part and deleted in the hardening phase.
* Retention reads no contract economics, because that domain does not exist.
* (Resolved in Part 7.) The farm consequence recomputed the organization per
  player; it now reads it once per request through a `FarmSession`.

## 6.4 What was not removed at the end of Part 6, and why

`minorLeagueMoves.ts`, `minorLeaguePitchingOperations.ts`, `pitcherRosterSimulation.ts`
and `minorLeagueRetention.ts` were left in place at the end of this part, still
serving `/api/minor-league-moves` and `/api/minor-league-retention` to the three
old farm pages, so that the phase changed one thing at a time and the new module
could be proven against the real save first. The hardening phase (Part 7) built
the dependency map, migrated the last consumers and deleted them.

---

## Checkpoint log

* **Checkpoint 1 — audit complete.** All project docs read; every farm module read
  end to end; the MLB v2 subsystem read for transferable lessons; the existing
  system exercised read-only against the real Arizona save; peer pools re-derived
  and two defects measured. Baseline: `npx tsc --noEmit` clean, 118 files / 1,396
  tests passing.
* **Checkpoint 2 — foundations.** One stamped calibration declaration;
  league-relative park-adjusted production; the amateur-signing fix in the level
  baselines; per-league baselines wired into Player Development's own production
  lens; the legacy `signal`/`score` verdict removed and the Dashboard and AI
  prompt re-pointed at the engine; the age rule corrected so age never lowers the
  developmental bar.
* **Checkpoint 3 — the model.** Playing time and congestion; the current-assignment
  question; the assignment review; the affiliate's two readings; the organization
  view; the cascade planner; retention split three ways; the service and the API.
* **Checkpoint 4 — hardening on the real save.** Fourteen findings (§6.2), the
  attention list brought from 137 to 18 by fixing the defects behind it rather
  than by tuning a threshold to a preferred count.
* **Checkpoint 5 — the corpus.** 169 new tests: golden cases for development,
  playing time, cascades, affiliates and retention; metamorphic invariants;
  threshold boundaries; the architecture boundary guard; cross-module integration.
* **Checkpoint 6 — the workspace.** Five views behind one entry, hash-routed,
  sharing MLB Operations' shell and vocabulary; verified in the browser against
  the real save.

---

# Part 7 — Hardening phase

Status: **in progress** (branch `feature/mlb-operations-v2`, on top of Parts 1–6). The same
methodology as [MLB_OPERATIONS_HARDENING.md](MLB_OPERATIONS_HARDENING.md): try to break it, fix
the systematic failures, widen the corpus, remove what is superseded, and leave one authoritative
implementation. Nothing here asked the owner for an OOTP experiment or touched a save; every check
ran read-only against the imported Arizona save, the other 29 organizations in the same import,
synthetic fixtures and the production functions.

## 7.1 Baseline before hardening

| | |
|---|---|
| Branch | `feature/mlb-operations-v2`, 45 uncommitted files (the Minor League Operations rebuild) |
| `npx tsc --noEmit` | clean |
| `npm test` | 127 files / 1,566 tests passing |
| `npm run build` | succeeds |
| `npm run farm:base-rate` (Arizona, 2026-05-15) | 230 players on 7 affiliates; 87 read by Player Development, 2 indeterminate, 140 no season to read, 1 on rehab; **18 attention items** (11 attention, 7 noted); assignments 62 defensible · 4 promotion-direction · 7 blocked · 14 organizational · 2 indeterminate · 141 not assessable; retention 77 retain · 5 review · 1 not a farm decision · 147 indeterminate |

## 7.2 Dependency map: the old farm system and the new one

Built from imports, routes and API consumers, not from filenames. "Authoritative" means the new
module (`farm*.ts`, `playingTime.ts`, `currentAssignment.ts`, `src/pages/farm/`) is the one
answer Pennant gives for the question.

| Component | Current consumers | Authoritative? | Replacement | Action |
|---|---|---|---|---|
| `minorLeagueMoves.ts` (position-player solver, `planScore`) | `org.ts` route `/minor-league-moves`; `tests/developmentIndeterminateOperations.test.ts` | No | `farmAssignments` (per-player review), `farmCascade` (what follows one move), `farmOrganization` (congestion) | **DELETE**; re-pin the test's invariants against the farm cascade |
| `minorLeaguePitchingOperations.ts` (pitching solver, `pitchingNeedScore`) | `org.ts` same route; the same test; named in two boundary-test file lists | No | `playingTime.rotationConflict` / `reliefConflict`, role-conversion finding, `farmCascade` | **DELETE** |
| `pitcherRosterSimulation.ts` | `minorLeaguePitchingOperations.ts`; one assertion in `tests/rehabAffiliateHealth.test.ts` | No | `farmUsage` + `playingTime` (usage, not simulation) | **DELETE**; the rehab assertion moves to the farm's own rehab answer |
| `minorLeagueRetention.ts` (retention decision layer + development-history evidence) | `org.ts` route `/minor-league-retention`; `FarmSystem`/`FarmDecisions`/`FarmAffiliates`; **`Prospects.tsx` (Player Development page) uses `retention.players` as its player list**; **`Development.tsx` (Scouted Development) uses it for per-player `developmentHistory` / `peerDevelopment`**; `tests/scoutedEvidence.test.ts` (two cases); `exporter.ts` static crawl; `tests/staticExportDevelopment.test.ts` | No for the decision; the evidence it carries is `history.ts`'s | `farmRetention` for the decision. For the two Player Development pages: a **`/api/scouted-development/:orgId`** route serving the per-player history evidence directly from `history.ts` (`developmentTrendByPlayerForOrg`, `peerDevelopmentTrendByPlayerForOrg`) and the adapter | **DELETE** the module and route; **MIGRATE** the two Player Development pages and the two tests to the new route; **MIGRATE** the exporter |
| `org.ts` routes `/minor-league-retention`, `/minor-league-rosters`, `/minor-league-moves` | the three old pages; `Prospects.tsx`; `Development.tsx`; tests above | No | `/api/farm-operations/:orgId` (+ `/consequence/:playerId`), `/api/scouted-development/:orgId` | **DELETE** all three |
| `org.ts` `computeProspects` + `/prospects/:orgId` | `Prospects.tsx`, `dashboard.ts`, `ai.ts`, `storylines.ts`, `farmOperations.ts`, `mlbDiscussionAssessments` / `mlbAssignmentAssessments` (MLB Operations' Player Development port), five tests | **Yes** — Player Development's own answer | — | **KEEP**. Its `signal`/`score` were removed in Part 2; `src/api.ts` still declares them (dead client types) → **DELETE the types** |
| `minorLeagueRoster.ts` | `farmOperations.ts`, `farmAffiliate.ts` (types), `mlbEvidence.ts`, `org.ts` (dead route), three tests | **Yes**, as the operational count-and-coverage reader and the read-only scenario | — | **KEEP** as a library. Its `overall` / `issues[]` (role-code rotation status, prose) are superseded by `farmAffiliate`'s findings-derived status: **MIGRATE** the one remaining consumer of them (`mlbEvidence.farmConsequence` → MLB Decision view / report) |
| `rehabAssignments.ts` | `minorLeagueRoster`, `farmOperations`, the old solvers | **Yes** | — | **KEEP** |
| `FarmSystem.tsx` / `FarmDecisions.tsx` / `FarmAffiliates.tsx` (4,402 lines) and the `farm` / `farm-decisions` / `farm-affiliates` pages, `farmAffiliateTeamId` state, three nav entries | `App.tsx` only; no URL of their own (page state, not a hash) | No | `src/pages/MinorLeagueOperations.tsx` + `src/pages/farm/` (`#/farm/...`) | **DELETE** the pages, the state and the nav entries. No bookmark can point at them, so there is nothing to redirect; the one nav entry remains |
| `.farm-*` CSS (178 rules) | the three old pages; `src/pages/farm/common.tsx` uses `farm-section-head`, `farm-kicker`, `farm-empty`; `Prospects.tsx` uses `farm-text-healthy`/`farm-text-thin` | Partly | — | **DELETE** the rules only the old pages used; keep the handful the new views and the Player Development page share |
| Dashboard `promoteSignals` chip ("Promotion signals") | `src/pages/Dashboard.tsx` | Half: it counts Player Development's promotion-direction recommendations, but "promotion signals" is the old vocabulary and the chip sends the GM to the prospect list | the farm's attention list (pressing assignments, affiliate shortages, retention reviews) | **MIGRATE CONSUMER** to `computeFarmSystem` counts; the chip opens `#/farm` |
| AI briefing / storylines `topProspects` (`prospects.batters.slice(0, 5)`) | `ai.ts`, `storylines.ts` | No — since the `score` sort was removed in Part 2 these are **the first five names alphabetically**, presented to the model as the top prospects | the farm's attention items plus Player Development's promotion-direction recommendations | **MIGRATE CONSUMER** (a defect introduced by Part 2, found here) |
| `mlbEvidence.farmConsequence` → `FarmConsequence.farm` | `mlbResponses.ts` (per candidate and per clearing option), `mlbReport.ts`, `src/pages/mlb/Decision.tsx` `FarmView` | Yes for the contract; **but the MLB Decision view and the staff report render only the old health delta (`overall`, `changes`, `issuesAfter`) and never the v2 answer (`farm.summary`, the cascade, what is left open)** | — | **MIGRATE CONSUMER**: MLB Operations displays the v2 answer; the old status line is replaced by the findings-derived operational status so the two modules describe one farm |
| `tests/developmentIndeterminateOperations.test.ts` | — | Pins the old solvers | the farm cascade and `/api/prospects` philosophy-invariance | **REPLACE** with equivalent coverage of the authoritative behavior |
| `tests/evidenceBoundary.test.ts`, `tests/mlbOperationsBoundary.test.ts` file lists | — | — | — | remove the deleted module names |

Everything in the new module has exactly one owner; nothing above is a "keep just in case".

## 7.3 Performance, measured before any change

On the Arizona import (230 minor leaguers), warm process:

| Computation | Time |
|---|---|
| `computeProspects(orgId)` | ~1,000 ms — `loadScoutedAbilities` ~300 ms, `destinationFit.populationRows` ~200 ms, `seasonBatting` + `seasonPitching` ~300 ms |
| `computeMinorLeagueRosterHealth` (all 7 affiliates / one affiliate) | 176 ms / 49 ms |
| `computeFarmSystem(orgId)` | 1,100–1,700 ms |
| `farmConsequenceFor(orgId, playerId)`, one call | ~1,100 ms (it re-assembles the organization and re-runs `computeProspects`) |
| ten `farmConsequenceFor` calls (what MLB Operations does for ten Triple-A candidates) | **10,900 ms** |

The single call is acceptable. The per-candidate recomputation inside one MLB Operations request is
not: a need with a dozen minor-league candidates spends over ten seconds in the farm before it can
answer. This is the "known limitation" of Part 6 turned into a measured defect (H-9 below).

## 7.4 Cross-organization sweep

`computeFarmSystem` was run for all 30 organizations of the import (read-only). No crashes. Every
organization has one Triple-A, one Double-A, two Single-A and two or three Rookie affiliates (177–237
players). Attention items 15–38; assignments `demotion_direction_defensible` 0 for 27 clubs and 1–2
for three; `league_population_too_small` at most one player per club; no club with a missing level
age profile. The shapes are consistent, so nothing below is an Arizona artefact.

## 7.5 Findings log

Classification as before: **BUG** fixed now; **SYSTEMATIC** a model failure, refined; **POLICY**
a threshold that is debatable and left as declared; **PROVISIONAL** evidence does not support
stronger behavior yet; **MISSING** genuinely absent, recorded as follow-up unless it blocks
correctness.

| # | Finding | Class | Resolution |
|---|---|---|---|
| H-1 | A cascade whose pool held only men Player Development had not evaluated (no qualifying sample at their level) stopped `no_defensible_move` with "Player Development found none of them defensible". Every Double-A vacancy on the real save read that way about fifteen men it had never looked at. | **BUG** | A pool with unevaluated men leaves the chain `indeterminate` and says how many were ruled out and how many were not evaluated; `no_defensible_move` only when every candidate was judged and ruled out, or the pool is empty. |
| H-2 | Retention read the season's line before the runway: a player with a known tier and an OPEN runway was `indeterminate` because he had not yet reached forty plate appearances. 147 of 230 Arizona minor leaguers, 124 of them with an open runway. | **BUG** | An ordinary developmental runway is a fact about age and level, not about this season; it is read first. Real save: 147 → 23 indeterminate, every one a closed or closing runway with nothing to read. |
| H-3 | "Blocked by" named anyone with more innings than the prospect: a centre fielder with a fifth of the club's innings was reported as "occupying the developmental path" of the man behind him, and a 17%-share first baseman as a second blocker. | **SYSTEMATIC** | A blocker HOLDS the job: only a regular is one (`blockersOf`). Otherwise the prospect's problem is an opportunity conflict. Real save: Druw Jones (Reno CF) is now a conflict, not "blocked by Waldschmidt"; Conticello is blocked by Baker alone. |
| H-4 | One man, one job made cover holders invisible: the corner outfielder covering centre and the two-way pitcher who is in fact the regular first baseman (198 of Visalia's 331 innings) were not among the men ahead of a claimant, so the wrong man was named. | **SYSTEMATIC** | A conflict carries `alsoPlaying` — men with innings at the job whose primary job is elsewhere — who count against nobody's capacity but are named as ahead. Perez is now blocked by Grice. |
| H-5 | Usage is the season to date and a club is not: a regular promoted mid-season (Conticello's 136 CF innings at Reno) still held the largest share of the job while no longer on it, so the competition read as crowded when it was vacated. | **PROVISIONAL** | Recency is not modelled. The conflict now says how many innings were played by men no longer on the roster once that is a quarter of the job (`DEPARTED_SHARE_NOTED`). |
| H-6 | A designated hitter — in the lineup most days, no innings at his listed position — read as `not_used` there, so a development-priority DH would have been "not getting the work" at a position he was never fielding. | **SYSTEMATIC** | A new work level `bat_only`: his bat is getting its work and his glove is not, raised as worth a look for a player whose development includes the position, and nothing for a depth player. |
| H-7 | Injured players on an affiliate's active list counted as positional cover and as men taking starts (111 of 6,411 rostered minor leaguers league-wide), and an injured prospect's zero innings made him a squeezed claimant. | **SYSTEMATIC** | A player injured for more than `INJURED_DAYS_NOT_COUNTED` (a week) is excluded from the operational counts and named in `rosterTreatment.injured`, competes for nothing, and his review says he is injured rather than blocked. Hillsboro now reads eleven healthy position players. |
| H-8 | The farm's production and usage caches (`farmResults`, `farmUsage`) were never cleared when a fresh export was imported. | **BUG** | Cleared with the other per-import caches in `api.ts`. |
| H-9 | `farmConsequenceFor` re-read the organization per call and MLB Operations called it per candidate: ten Triple-A candidates cost 10.9 seconds. | **SYSTEMATIC** (performance) | A `FarmSession` — the organization read once for the life of one request, never longer — passed by MLB Operations through the adapter. Ten candidates: 1.1 s. Roster scenarios are read only for candidates the planner can follow. |
| H-10 | MLB Operations' Decision view and staff report displayed only the old health delta (`overall`, role-code statuses, prose `issues[]`) and never the farm's answer (the vacated job, the chain, what is left open). The old status called Reno `thin` on role codes while the farm workspace, counting six men taking starts, called it able: two descriptions of one farm. | **BUG** (integration) | The adapter's `overall` and `issuesAfter` are the farm's findings-derived operational reading before and after (`operationalReading`, shared with the Affiliates view); the change lines count what the move touches; the v2 answer is carried and displayed. |
| H-11 | The `joins` direction (an option) had no farm answer at all. | **MISSING** → built | `farmArrivalFor`: the job he takes up, who holds it, whether it is contested and whose developmental work is pushed aside — the arrival is the conflict that would exist with him on the club. No cascade: nothing is vacated. |
| H-12 | `replacementOptions` listed every step's candidate as a replacement for the departing man; a step-two candidate replaces the step-one man at HIS club. | **BUG** | The first step's defensible candidates, with the alternatives the chain did not follow (`CascadeStep.alternatives`) and philosophy's preference on each. |
| H-13 | Three share lines (0.15, 0.7 / 0.35, half of even) were literals in `playingTime.ts`; the roster thresholds were still literals in `minorLeagueRoster.ts` beside their declarations in `farmCalibration.ts`. | **BUG** (discipline) | Declared once, stamped, and the boundary test's list extended. |
| H-14 | Since the `score` sort was removed in Part 2, the AI briefing's and the storylines' "top prospects" were the first five names alphabetically. | **BUG** (introduced by Part 2) | Migrated to the farm's attention list and Player Development's own recommendations (§7.6). |

**Debatable, documented, not changed:**

* `INJURED_DAYS_NOT_COUNTED` at seven days. OOTP flags most minor-league injuries day-to-day whatever
  their length, so the days decide it; a week is where an injury stops being a lineup problem and
  becomes a schedule one. Policy, declared once.
* `DEPARTED_SHARE_NOTED` at a quarter of the job. Below it a departed man's innings are noise; above it
  the shares are describing a competition that no longer exists. The honest fix — a windowed read of
  recent usage — needs game-level fielding lines and is roadmap work.
* The `bat_only` reading is raised for a designated hitter whose development includes the position.
  Whether a club's DH usage is a development decision or a lineup one cannot be told from the export;
  it is raised as worth a look, never as pressing.
* `demotion_direction_defensible` fires four times across thirty organizations. The bottom sixth with
  a claim-worthy sample is rare in mid-May because poor performers lose playing time before they reach
  it: survivorship, not a defect. The verdict says "holding his own" on the thin sample and shows the
  rate.

## 7.6 What was deleted, and what replaced it

| Deleted | Replaced by |
|---|---|
| `server/minorLeagueMoves.ts` (2,518 lines), `server/minorLeaguePitchingOperations.ts` (2,135), `server/pitcherRosterSimulation.ts` (512), `server/minorLeagueRetention.ts` (2,442) | `farmAssignments`, `farmCascade` (+ `poolFor`), `playingTime`, `farmRetention`, `farmConsequence` |
| `/api/minor-league-moves`, `/api/minor-league-retention`, `/api/minor-league-rosters` | `/api/farm-operations/:orgId`, `.../consequence/:playerId`, `.../arrival/:playerId/:teamId` (`farmRoutes.ts`); `/api/scouted-development/:orgId` for the Player Development pages |
| `src/pages/FarmSystem.tsx`, `FarmDecisions.tsx`, `FarmAffiliates.tsx` (4,402 lines), the `farm` / `farm-decisions` / `farm-affiliates` pages, their nav entries and the shared affiliate state | `src/pages/MinorLeagueOperations.tsx` + `src/pages/farm/` (one nav entry, `#/farm/...`). The old pages had no URL of their own, so nothing needed redirecting |
| 1,694 lines of `.farm-*` CSS, of which 15 classes were still used by the new views and the Player Development page | the 15 kept under one header; 42 rules remain of 277 |
| `AffiliateRosterHealth.overall`, `issues[]`, `bodyCountStatus`, `rotationStatus`, `bullpenStatus`, fatigue and stamina fields, `PositionCoverage.status` / `emergency` | `farmAffiliate.operationalReading` (findings-derived status); the roster module is counts and coverage and decides nothing |
| `Prospect.signal` / `Prospect.score` client types; `tests/developmentIndeterminateOperations.test.ts` | — ; `tests/farmDevelopmentIndeterminate.test.ts` pins the same invariants against the farm |
| Dashboard "Promotion signals" (Player Development's promotion-direction count, opening the prospect list) | "Farm attention": the farm's own pressing items, opening `#/farm` |
| `topProspects` in the AI briefing and storylines context (an alphabetical head slice since Part 2) | `farmBriefing`: scope, the attention list, Player Development's promotion-direction recommendations, each affiliate's operational status |

Migrated consumers: the Scouted Development and Player Development pages (to
`/api/scouted-development`, which serves the organization's minor leaguers with scouted grades,
protection tier, roster facts from Player State and `history.ts`'s trend evidence — Player
Development's, not the farm's); the static exporter; two `scoutedEvidence` tests; the two boundary
tests' module lists. `org.ts`'s `orgTeams` now walks the affiliate tree recursively, as the farm does,
so the two never see different ladders (the save has none nested today).

After deletion `grep` finds no reference to the removed modules, routes or pages outside this
document's own history.

## 7.7 Peer pools, documented

| Population | Who qualifies | Roster | League / level | Minimum | Below the minimum |
|---|---|---|---|---|---|
| Production percentile (`farmResults`) | every player with a line in that league at that level this season, ≥ `MINIMUM_SAMPLE` | not required: a man traded or released mid-season still played there | his own league, his own level | `LEAGUE_POPULATION_MINIMUM` (25) | `league_population_too_small`, percentile null, not assessable |
| Age relative to level (`org.ts` `levelBaselines`) | players on a roster (`team_roster`), any list | **required** (F-0-farm) | `level:league`, falling back to the level pool below 60 | 60 for a league | the level pool, and the reader is told which |
| Destination fit (`destinationFit.populationRows`) | active-list players of the destination league, hitters or the pitching role | required (list 2) | destination league | 25 | `not_satisfied` (inherited D-018 gap, unchanged) |
| Fielding grades (farm) | — | — | — | — | absolute grades on the 20-80 scale (`PLAYABLE_GRADE`, `STRONG_GRADE`), no population |
| Playing-time shares (`farmUsage`) | the club's own innings at the job this season | active list, rehab and injured excluded as claimants | the club | `MINIMUM_CLUB_GAMES` (20) | no share is read; the club says how many games it has played |
| Organizational depth / congestion | active-list players, rehab excluded | required | the organization | — | counts, never quality |

Verified on the import: unassigned amateurs cannot reach a rostered pool (`farmPeerPools.test.ts`
pins F-0); Hillsboro (Northwest) and Visalia (California) are read against their own leagues
(`farmPeerPools.test.ts` pins F-1); every minor-league park carries a factor; complex-league
populations under 25 read as not assessable, one player per club at most on the import; no club
in the sweep lacked a level age profile.

## 7.8 Performance, after

| | Before | After |
|---|---|---|
| ten `farmConsequenceFor` in one request | 10,900 ms | **1,150 ms** (one `FarmSession`) |
| an MLB Operations need with seven candidates, five with a farm answer, end to end | — | 3,600 ms (the farm's share about 1.1 s) |
| `computeFarmSystem` | 1,100–1,700 ms | unchanged (one session per request; nothing cached across requests) |
| the Dashboard | + `computeProspects` (~1 s) | + `computeFarmSystem` (~1.1–1.7 s), which includes it |

The remaining cost is `computeProspects` (about a second: the evidence adapter, destination-fit
populations, two season scans), which Player Development owns and the farm reads once. Nothing is
cached across requests, so a fresh export or a changed philosophy is seen on the next request. No
further optimisation is warranted on a 230-player organization.

## 7.9 The workspace and the MLB view, after

* Decision: who is ahead of a man now says what each holds and whether he is a claimant or covering
  from another position, and whether anybody is regular there; the cascade lists the other
  defensible replacements as the branch; "who could take the job" shows the first step's candidates
  with Player Development's verdict and philosophy's preference; the club's operational status
  before and after is shown as a chip with the shortages it would carry.
* Affiliates: injured players appear in the roster context with their days, and a conflict says who
  else is getting innings at the job from another position.
* MLB Operations' Decision view (`FarmView`) and staff report now display Minor League Operations'
  sentence, the replacements, what is left open, and — for an option — the arrival: the job he takes
  up and whose developmental work he pushes aside. The status chip is the farm's own reading.
* The Dashboard's chip is "Farm attention" and opens the farm's inbox.
* Verified in the browser against the real save at desktop width: Overview, Decision (Druw Jones:
  an opportunity conflict at CF with the cover holders named and the departed-innings note; Enyervert
  Perez: blocked by the two-way first baseman), Affiliates, the MLB decision for a left-field review
  with five candidates carrying the farm's answer, the Dashboard, the Player Development and Scouted
  Development pages on the new route.

## 7.10 Cross-organization sweep, after

All 30 organizations, read-only, no crash. Per club: 6–7 affiliates (one Triple-A, one Double-A,
two Single-A, two or three Rookie), 177–237 players, attention items 12–37, `organizational_blockage`
1–8 (was 3–13 before the regular-only rule; the difference moved to `opportunity_conflict`, 0–7),
retention reviews 2–16, `demotion_direction_defensible` 0–2, `league_population_too_small` at most
one player. Every organization's ladder is a direct child of its major-league club (202 of 202),
so the recursive walk and the one-level walk agree on this import; they are now the same query.

## 7.11 What is mature, what is provisional, what is missing

**Mature (architecture, pinned by tests):** the assignment model and its ordering; playing time as
conflicts with cover holders, blockers and the designated hitter; the two readings of an affiliate
and the findings-derived status; cascade termination including the unevaluated pool; retention's
three owners; the MLB ↔ farm contract in both directions through one adapter and one session; the
boundary guards.

**Provisional:** every farm constant (no minor-league history to fit against); the departed-innings
note as a stand-in for a windowed usage read; the absolute-scale protection tier.

**Missing, recorded:** cross-affiliate Rookie movement; recency in usage; repeat-level and
prior-experience context in the assignment review; a peer-relative protection tier.
* **Checkpoint 7 — hardening: dependency map.** Every old solver, route, page, consumer and test traced
  by import and runtime path (§7.2); performance measured (§7.3); all 30 organizations swept (§7.4).
* **Checkpoint 8 — hardening: model fixes.** H-1 to H-13 (§7.5): cascade wording over an unevaluated
  pool, retention's runway before the line, blockers as regulars, cover holders, the designated
  hitter, injured players, the departed-innings note, caches on import, the session, the adapter's
  own reading, the arrival, the replacements, the share lines declared once. 65 new cases.
* **Checkpoint 9 — hardening: deletion.** The four solvers, three routes, three pages and 1,694 lines
  of CSS removed; the Player Development pages moved to `/api/scouted-development`; the roster module
  trimmed to counts; the contract and the routes in their own modules; Dashboard and AI migrated.
  Baseline after: `npx tsc --noEmit` clean, 129 files / 1,617 tests, `npm run build` succeeds, 19
  attention items on the real save (12 pressing), retention 201 retain · 5 review · 1 not a farm
  decision · 23 indeterminate.

---

# Part 8 — Windowed usage and current opportunity evidence

Status: **built** (branch `feature/farm-windowed-usage`, from `main` at `fcbe73e`). An evidence
refinement, not a new recommendation engine. The protection tier, contracts, trades and every other
domain are out of scope. Nothing here asked the owner for an OOTP experiment or touched a save: every
check ran read-only against the imported Arizona save (`data/league.db`, opened `mode=ro`), the other
29 organizations in the same import, and the production readers.

The weakness this part fixes, stated once:

> Season-to-date playing-time totals can describe a competition that no longer exists.

Part 7 recorded it as H-5 (**PROVISIONAL**): "Recency is not modelled … The honest fix — a windowed read
of recent usage — needs game-level fielding lines and is roadmap work." That sentence assumed the export
had no game-level data. **It does**, and §8.1 is the audit that established it.

## 8.1 Temporal evidence audit

Done before any design, because the desired shape —

```text
season usage  +  recent usage  +  current assignment/state   →   current opportunity
```

— is only worth building if the export can support it. Every candidate source was inspected directly.

| # | Source | Granularity | Minors? | Hitters / pitchers / fielding | Survives an affiliate change? | Tells current from departed? | Standing | What it cannot say |
|---|---|---|---|---|---|---|---|---|
| S-1 | `players_game_batting` | **one row per player per game**: `game_id`, `team_id`, `level_id`, `position`, `gs`, `pa` | **Yes** — levels 1, 2, 3, 4 and 6; every one of the 3,124 played games | hitters; the position he STARTED at (or entered at) | **Yes**: `team_id` is the club he played for that day | No, by itself: it says who played. Joined to the current roster it does | **authoritative** (reconciles exactly, below) | defensive **innings**; a mid-game position switch; why a man did not play |
| S-2 | `players_game_pitching_stats` | one row per pitcher per game: `gs`, `outs`, `pi` | **Yes**, same coverage | pitchers: starts, relief appearances, outs, pitches | Yes | as S-1 | **authoritative** | the role he was *meant* to have; a skipped turn's reason |
| S-3 | `games` | one row per game: `date`, `time`, `played`, clubs | Yes | the club's game sequence — the window's backbone | n/a | n/a | **authoritative** | — |
| S-4 | `projected_starting_pitchers` | one row per club, eight slots (a five-man cycle) | **Yes**: 30/30 AAA, 30/30 AA, 60/60 A, 82/86 Rookie | pitchers: who OOTP has lined up to start next | it is a statement about NOW | **Yes** — 100% of listed men are on that club's active list | **explicit export current state** | nothing about the past; nothing for hitters |
| S-5 | OOTP live transaction log (`minor_league_assignment`, `optioned`, `rehab_assigned`, …) via `transactionLog.ts` | one dated event per move, with `from` / `to` club ids | **Yes**: 12,557 assignment events | both | it IS the move | the dated arrival at the current club | **explicit chronology** (D-020 tier 2) | it can be unavailable, and it can run AHEAD of the export (here 05-16 against 05-15) |
| S-6 | `players_injury_history` + `players.injury_*` | injury onset date, length, day-to-day; current injury and days left | Yes | both | n/a | current injury is current state | **authoritative** | a return date beyond `injury_left` |
| S-7 | `players_career_{batting,pitching,fielding}_stats` | **season cumulative**, per player / club / level / split | Yes | all three, **including defensive innings** | Yes (keyed by `team_id`) | No | authoritative for the season | **no dates at all** — it is the source whose staleness this part is about |
| S-8 | Pennant snapshots (`history.db`) | one row per player per import | — | **ratings and roster state only — no usage statistic** | — | — | **rejected** | one snapshot date exists; a stat delta cannot be formed, and would depend on how often the owner imports |
| S-9 | `players_at_bat_batting_stats`, `games_score`, `players_streak`, `messages`, `league_events` | per at-bat / per inning / streak / message | partly | — | — | — | **rejected** | none adds a usage fact S-1 and S-2 do not already hold exactly; `messages` is not a stable causal feed (`transactionHistory.ts` says so) |

### The reconciliation that makes S-1 and S-2 authoritative

| Check | Result |
|---|---|
| Played games present in the batting log / the pitching log, per league | **3,124 of 3,124** in both, all 14 active leagues, each league's opening day through 2026-05-15 |
| Batting log summed per player-club against the season line (G, GS, PA, H) | **3,717 of 3,717 exact**. The 1,030 season rows with no log lines are `league_id 0`, levels 10 and 11 — college and high-school feeder seasons on clubs absent from `teams`; not affiliated ball |
| Pitching log summed against the season line (G, GS, outs, K), levels 1–6 | **3,767 of 3,767 exact** |
| Starters per club-game in the pitching log | **exactly one, 6,248 of 6,248** |
| Starts at each of positions 2–9 in the batting log | **exactly 6,248 each** = 3,124 games × 2 clubs: one starter per fielding position per club-game. DH starts 6,151 + pitchers batting 97 = 6,248 |
| `games` (played) per club against `team_record.g` | **262 of 262 professional clubs equal** — the window's denominator is the season's |
| Grain | one row per player-game in both logs; `split_id`, `stint` constant |
| Log starts at a position against the fielding table's `gs` | 58 of 7,190 rows differ, every one by exactly +1 in the log (0.1%, uniform across levels). The log's total is the definitionally correct 8 × 6,248, so the log is the more consistent of the two |

### What the audit rules in, and out

* **Starts by position by date: exact.** So is who started on the mound, relief appearances, outs, plate
  appearances, DH starts and bench appearances.
* **Defensive innings by date: do not exist.** The log records ONE position per player-game; the season
  fielding table counts every position he touched (57,498 games-at-position against the log's 52,999,
  and 478 player-positions appear only as in-game switches). A recent read is therefore in **starts**,
  the season read stays in **innings**, and the two are not the same unit.
* **The unit difference does not need a new threshold.** Across 6,023 full-season minor-league
  player-positions, season innings share and season starts share differ by 1.06 points on average, and
  agree on the 0.40 regular line in 99.1% of rows and on the 0.15 part-time line in 97.5%.
* **Dates are unpadded strings** (`2026-5-9` sorts after `2026-5-10`). Every ordering goes through
  `parseGameDate`; a club's games are ordered by (date, time, game id) because doubleheaders exist
  (18 club-dates). `game_id` order agrees with date order (0 inversions in 3,060 pairs).
* **Arrivals: the transaction log strictly dominates the game log.** Of Arizona's 230 farm players **63
  arrived at their current club in-season (27%)**. The log dates all 63; the game log alone sees 24 (a
  man who last appeared for another club), and none that the log misses. The 39 it cannot see came from
  somewhere that played no games: off an injured list (Locklear, Del Castillo), from a Dominican club
  that has not started, or before opening day. So: log first, game log as the bounded fallback when
  the log is unavailable, and otherwise the arrival is **not established** and is said to be.
* **Departure needs no dating.** A departed man is simply not on the roster, and the roster is current
  state. The log adds when he last played here; Player State adds where he is now.
* **`projected_starting_pitchers` is coherent with usage and adds what usage cannot.** Every full-season
  club lists exactly five distinct men; 100% are on that club's active list; 92.2% started for it in
  its last 15 games; 96.6% of men with two starts in the last 15 are listed. The 6% who have never
  started for the club are the arrivals and conversions — exactly the men usage has not caught up with.
* **No current-state source exists for hitters.** The export has no lineup or depth-chart table, so for
  a position player recent usage is the only evidence of his present role.

## 8.2 The defect, measured on the real save before any change

Baseline (`npm run farm:base-rate`, Arizona, 2026-05-15): 19 attention items; **6 `organizational_blockage`
and 1 `opportunity_conflict`** — the seven pressing blocked-prospect findings Part 6 led with.

**All seven are temporal artifacts.** A wave of moves is dated 2026-05-11 in the transaction log and
bracketed exactly by the game log (last game for the old club 05-10, first for the new 05-12):

| Player | Season-only reading (before) | What the game log and current state show |
|---|---|---|
| Cristofer Torin, 20, Reno | `insufficient_work` at SS, "Jose Fernandez occupies the developmental path he needs" | Promoted 05-11. Reno has played 4 games since; he played all 4 and started 3 at SS |
| Druw Jones, 22, Reno | `insufficient_work` at CF: "19 of the club's 378 innings" | Promoted 05-11. Played 4 of 4, started 3. **This was Part 7's verified showcase example** |
| Gavin Conticello, 22, Amarillo | blocked at 1B by Luken Baker | **Demoted** from Reno 05-11 (H-5 recorded it as a promotion). Played 4 of 4, started 3 |
| Manuel Pena, 22, Amarillo | blocked at 2B by Jansel Luis | Promoted 05-11. Played 3 of 4, started 2 — at 3B |
| Enyervert Perez, 20, Visalia | blocked at 1B by Caden Grice | Arrived from the complex 05-11. Played 4 of 4, started 2 |
| David Hagaman, 23, Amarillo | `insufficient_work` in the rotation, "blocked" by four regulars | Took every fifth-day turn at Hillsboro (8 starts), was promoted, and started for Amarillo on 05-15 **on his turn**. He is Amarillo's projected `starter_4` |
| Wellington Aracena, 21, Hillsboro | `not_playing` in the rotation, "blocked" by four regulars | OOTP role 11 and Hillsboro's projected `starter_0`, with 15 one-inning relief appearances and no start. Current state says rotation, usage says bullpen: a role change under way, not a blockage |

Classification: **SYSTEMATIC**. H-5 filed the problem as a departed man's innings lingering in a
denominator. The larger failure is on the arrival side: a promoted prospect's tiny destination-club
total reads as "cannot get the work", and the regular at his new club reads as the man blocking him. A
promotion wave manufactures the farm's entire pressing list.

## 8.3 The window, designed from the data

Not "the last fourteen days". The window is a number of **club games**, because a rotation turns over
in games and a club's off days make a calendar window mean different things at different affiliates,
and its length was chosen by a backtest on the export's own game log (`npm run farm:usage-window`,
read-only, re-runnable on any import):

> After each club game from the twentieth on, how well does a trailing window of that club's games
> predict who does the work in the NEXT ones? 120 full-season minor-league clubs, roster-aware.

**The decomposition that decided the architecture.** For "who holds a position", going from the season
alone to the season *restricted to men still on the club* lifts the job-holder's share of the next five
starts from 34.8% to 38.4%. A window on top adds 1.9 more. **Knowing who is actually on the club is
worth about twice what windowing is** — which is why current state is authoritative and never inferred
from usage (§8.4), and why the arrival and departure rules matter more than the number fifteen.

| Job | Rule | Window (15 games) | Season equivalent |
|---|---|---|---|
| A position | 40% of the window's starts there → starts ≥ 2 of the next 5 there | precision 70.0%, **recall 38.4%** | 70.6%, recall 31.4% |
| | the same at 10 games | precision 65.7% — noisier | |
| The rotation | ≥ 2 starts in the window → one of the next 5 starters | **precision 86.8%**, recall 78.4% | 79.4%, 80.6% |
| | ≥ 3 starts (what the season's 0.7 line would demand) | 91.8%, recall **63.1%** | |
| Relief | see below | | |

The method was validated against the major leagues first, where the answer is known: there the
job-holder starts 75% of the next five and the rotation rule scores 96% / 96%. In the minors he starts
about 40% — a farm club genuinely moves men through positions — which is why `REGULAR_SHARE` is 0.40.

Results are flat between twelve and fifteen games. Fifteen is three turns of a five-man rotation, so
one window serves every job, with two differences the evidence required:

* **The rotation has its own lines** (`RECENT_ROTATION_SHARE` 0.6 / 0.3). Three turns fit in fifteen
  games, so a man's share can only be 0, ⅓, ⅔ or 1: the season's 0.7 line would demand every turn and
  miss a third of the men actually in a rotation.
* **Relief may confirm or clear, never raise.** A man's share of his corps' innings correlates **0.31**
  from one fifteen-game window to the next, against **0.57** for a position's starts, and **20.5% of
  relievers who were not short in one window read as short in the next**. So in relief his current
  level is the better of the two reads — short of work only when the season and the window both say
  so. The first version let the window raise a shortage alone and produced 20 new findings across
  thirty organizations, every one a quiet fortnight.

**Sample-awareness** (`RECENT_MINIMUM_GAMES` = 6). On 626 real arrivals the 40% rule's precision swings
between 56% and 77% below six observable games — integer effects: one start in two games is "half the
job" — and holds at 74–76%, the full window's level, from six on.

**Stamps.** All three constants are **provisional**, not calibrated: they rest on one partial season of
one save, the choice among twelve to fifteen is inside the noise, and no harness re-fits them. The
mechanisms — the three kinds of fact, the three window rules, thin is not unused, a departed man is
never a blocker — are **architecture**, and tests pin them.

## 8.4 The evidence contract

Three kinds of fact, kept apart because they are different kinds of fact:

| | What it is | Source | Standing |
|---|---|---|---|
| **Season usage** | what has happened this year | `players_career_*_stats` (`farmUsage.clubUsage`), unchanged | Context. Always shown; never deleted. In innings. |
| **Recent usage** | what happened over the club's last fifteen games | the game log (`farmUsage.clubGameLogs` → `farmRecentUsage.ts`) | Evidence of the PRESENT role. In starts. |
| **Current state** | who is on the club now, and available | the roster, Player State, the rehab screen, the injury columns; for a rotation, `projected_starting_pitchers` | **Authoritative, and never inferred from usage.** A man with 136 innings who is not on the roster competes for nothing. |

A man's **current work level** is the recent read when it can be read; the season's when there is no
recent read at all (an export with no game log — every function then behaves exactly as it did, which
the 1,617 pre-existing tests prove); and `unknown` when there is a recent read too thin to establish a
role. *History is never allowed to stand in for a present it does not describe.*

Every `WorkShare` carries `season`, `recent` (with the games counted, the work in them and
`sufficient` / `thin` / `none`), `tenure`, `levelFrom` (`recent` / `season` / `current_state`) and
`disagrees`. Every conflict carries `timing`, `squeezedOverSeason`, `gone` and the `window` it was read
over. Nothing is a score and nothing is a confidence number.

### The three window rules — one per way a competition changes

| What happened | Rule | Scenario it answers |
|---|---|---|
| He arrived, or came back from an injury | He is measured only over the games he could have played in: since his arrival, outside a recorded non-day-to-day injury spell | newly arrived · recently reassigned · returned from injury |
| A man who HELD the job left it (departed, off the active list, or injured past a week) | Everyone is measured from the game after his last start there: usage from before describes another competition | departed regular · recently injured regular |
| Anyone else not competing took starts there (a departed part-timer, a rehab assignee) | Those games are set aside: they were never available to the men who remain | rehab (D-026) · roster churn |

"Held" is a regular's share of the window's games **up to the last one he played for the club in any
role** (§8.6, W-3). Fewer than six games left to count is **thin**: the facts are shown and the role is
`unknown`, so a man four games into a club is neither "bench depth" nor "the regular", is not squeezed,
and blocks nobody.

### Arrival: the source hierarchy (D-020's)

1. **OOTP's transaction log**, through `server/clubArrival.ts` — shared chronology handling, like
   `rehabAssignments.ts`; the farm never reads the log itself. An event counts only if it names the
   club the EXPORT has him on and nothing later in the log sends him elsewhere, and events after the
   export's date are ignored, because the log can run a day ahead of it.
2. **The game log's bound**: he cannot have joined before the day after he last played for another
   club. Works with no log; blind to a man who came from somewhere that played no games.
3. **Otherwise not established.** With the log readable, no dated move means he has been there since
   before it began. Without it, a man never seen with the club before the window has `unknown` tenure
   and his evidence is capped at thin: he may have arrived yesterday.

Where both sources speak the later date wins — each is only a lower bound on his first possible game.

### Timing: whether a conflict is the present

| `timing` | Meaning | How it is shown |
|---|---|---|
| `season_only` | no game log: the season to date, as it always was | as before, with the departed-innings note |
| `current` | the recent read shows it too | as before |
| `emerging` | the recent read shows it and the season does not | pressing, and said to be recent |
| `historical` | the season shows it and the recent read does not | **kept**, quietly (`noted`), nobody `squeezed` |
| `recently_resolved` | historical, and the man who held the job has left it | kept, naming him |
| `uncertain` | the recent evidence is too thin to say | kept, quietly, with what would settle it (more games) |

History is not erased, and it is not allowed to masquerade as the present.

### Current state for a rotation

`projected_starting_pitchers` is the one statement the export makes about a present role. A man among
the next five whose usage has not caught up — four games into a new club — holds a spot on **current
state**, not on a thin window. A man among the next five whose *sufficient* usage shows no starts is a
**role change under way**: `unknown`, said in words, never "blocked from starting". A pitcher's job
(`pitcherJob`) is decided the same way: OOTP's assignment or projection first, then a start inside the
window, and the season only when the window cannot be read — so a man with three April starts who has
relieved since is a reliever, and is not rotation cover when a starter leaves.

## 8.5 Integration

* **Playing time.** `positionConflict`, `rotationConflict` and `reliefConflict` take the job's window
  and read every man twice. `jobRead` is the same read whether or not the job is contested.
* **The lone claimant (W-5).** "No job is contested for him" read a prospect starting twice a fortnight
  as getting regular work, because the men playing his position are listed at another. A position
  player's verdict now comes from the read of his own job, contested or not. A pitcher's does not: an
  uncrowded bullpen giving an arm few innings is a usage choice, not congestion.
* **Primary job.** The position a man has started at most lately, when enough of the window can be
  counted; otherwise the season's, as before. Without this the window would have manufactured a new
  false positive: a man moved from left to centre three weeks ago reads "not used" in left.
* **Cascades.** A chain asks what happens if a man moves NOW. The rotation vacancy counts men taking
  starts now, so a converted reliever no longer "absorbs" a starter's departure; a departed man is in
  no pool and no count. Each step still needs Player Development's own authorization: recent usage can
  change an operational consequence and can never make an indefensible assignment defensible.
* **The MLB ↔ farm contract.** One field added, `currentOpportunity`: what the leaving man is actually
  doing at his club now — level, what it rests on, how much the read can carry, whether he is a recent
  arrival, whether the reads disagree, the timing of the competition at his job, and the sentence.
  `FarmArrival` gains `timing`. MLB Operations asks, the farm calculates, MLB displays: the adapter
  passes the object through whole, and MLB shows the line only when it changes how the vacancy reads.
* **Retention.** Takes no usage input and gained none. It improves only through the conflicts it
  already read: a man is "holding work somebody is waiting on" only if he is CURRENTLY regular and the
  man waiting is CURRENTLY short. Low recent usage is never a release rule, and a test pins that the
  function has no way to receive it.
* **Player Development and Philosophy.** Untouched. `currentAssignment` takes no usage input; no Player
  Development module imports the recent read; philosophy names no dimension in any usage module.

## 8.6 Findings log

| # | Finding | Class | Resolution |
|---|---|---|---|
| W-0 | All seven of the farm's pressing blocked-prospect findings on the real save were a promotion wave four games before the export (§8.2). League-wide, 217 such findings became 37, and of the 189 no longer raised **65 were thin recent arrivals and 88 are men who ARE playing now**. | **SYSTEMATIC** | The three window rules; thin is `unknown`. |
| W-1 | H-5 assumed the export had no game-level data and recorded recency as roadmap work. It carries a complete per-game log for every minor-league level that reconciles with the season tables exactly. | **MISSING** → built | §8.1. |
| W-2 | A pitcher with any start this season was a rotation claimant for the rest of it, so a converted reliever read as a starter not getting starts, and counted as rotation cover when a starter left. | **SYSTEMATIC** | `pitcherJob`: current state, then the window, then the season. |
| W-3 | "Held the job while he was here" was measured to a departed man's last START at the position. Conticello started twice at first base early in the window and stayed with Reno another week; that read as two of five, made him "the man who held first base", cut the regular's window and reported LuJames Groover as newly squeezed. | **BUG** (found on the real save, in this phase) | Measured to his last APPEARANCE for the club. |
| W-4 | The first cut rule fired on any departed man with a part-time share, so a 25% catcher leaving discarded ten games of valid evidence about the regular. | **SYSTEMATIC** | Only a man who HELD the job restarts the window; anyone less is set aside. |
| W-5 | A lone claimant read "regular work: no job is contested for him". Roni Cabrera, a development-priority outfielder starting 2 of 14, dropped out of the findings when the other claimant's job moved. The design comment said his own review covered it; nothing did. | **BUG** (pre-existing, exposed by the cross-organization sweep) | A position player's verdict comes from his own job read. |
| W-6 | The window alone raised relief shortages: 20 of the 22 new findings across thirty organizations were a reliever's quiet fortnight. | **SYSTEMATIC** | Measured (r = 0.31; 20.5% manufactured); relief confirms or clears. |
| W-7 | "Disagrees" fired for 43% of claimants, because one level apart is a fortnight's noise on a club that rotates men (50.2% of readable claimants sit one level apart). | **SYSTEMATIC** | Two or more levels apart: 6.0% of claimants. |
| W-8 | `blockersOf` named the regulars ahead of a man whose own work could not be read. Production never asked, and one golden case passed by an accident of its numbers. | **BUG** (latent) | An indeterminate read has no blocker. |
| W-9 | A man "departed" to the club he was still on: he was off its active list, not gone. | **BUG** | A fourth reason, `inactive`. |
| W-10 | The code comment justifying "not playing is asked before the level" cited Druw Jones as a blocked prospect. He had been promoted four games earlier. | **BUG** (documentation) | The order is right and the example was not; the comment says so. |

**Debatable, documented, not changed:**

* Fifteen games, six games and the rotation lines are provisional and inside their own noise.
* A rehab assignee who has since gone back up is `departed`, and if he held the job his leaving restarts
  the window. His starts were never available to anyone either way; cutting and setting aside give the
  same men the same reads.
* A man projected to start whose usage shows he has been starting all along, but whom OOTP has just
  dropped from its next five, still reads `regular` until the window catches up. Only the other
  direction produced false findings, so only it is handled.
* One man, one job, is unchanged. A prospect rotating through three positions is `part_time` at his
  main one and cover at the others, and the affiliate page still marks him squeezed there though he
  plays every day. That is the abstraction, not the window, and it raises no finding on the player.

## 8.7 Real-save and cross-organization validation

Read-only. "Before" is the unchanged `main` at `fcbe73e`, run from a throwaway worktree against the
same import, so every number is a measured pair.

**Arizona.** Attention items 19 → **10**. Nine removed, **none added**, ten unchanged (three
promotion-direction assignments, two operational shortages, the organizational count, three retention
reviews). The nine: the seven arrival artifacts of §8.2, and two retention reviews whose "the spot is
wanted" pressure came from them — Bryce Jarvis's waiter was David Hagaman, who is in the rotation.

| Classification | Arizona examples |
|---|---|
| **CORRECTED STALE CONFLICT** | Hagaman (in OOTP's next five; took his turn). Amarillo's rotation reads `recently_resolved`: Jose Cabrera promoted to Reno, Hagaman into his spot. Tyler Locklear: 11% of the season's first-base innings, 5 of the 10 games since he was optioned — the current regular, with the disagreement shown. |
| **CORRECTED STALE COVERAGE** | Reno CF reads from the four games since Conticello, who held 36% of it, was demoted; he is named as history and competes for nothing. |
| **NEW UNCERTAINTY** | Torin, Jones, Conticello, Pena, Perez: joined four games ago, role not established. Aracena: OOTP's next starter with fifteen relief appearances — a role change under way. |
| **NO MATERIAL CHANGE** | Visalia SS (a real, current squeeze); every operational finding; every Player Development verdict. |
| **SUSPICIOUS CHANGE** | Groover newly "squeezed" at first base → W-3, a bug, fixed. None remain. |

**All thirty organizations.** No crash. Per club: attention 12–37 → **10–29** (764 → 571 in all);
`organizational_blockage` 123 → 31; `opportunity_conflict` 94 → 6; conflicts costing development 326 →
128; retention reviews 287 → 281. Flagged prospects 217 → **37** (30 kept, 7 new). 12.9% of claimants
read `unknown` (4–28% per club) and 6.0% carry a material season/recent disagreement; 27% are recent
arrivals, because OOTP moves minor leaguers in waves. Of the 189 findings no longer raised: 65
thin recent arrivals · 88 playing now · 29 corrected by current state (16 in the next five, 13 role
changes) · 5 jobs that had just changed hands · 2 others. Of the **7 new**: five position players the
recent games show have lost the job ("started 1 of the 11 games since Ryan Ritter last started there"),
one designated hitter, one reliever short on BOTH reads. Conflict timing: 286 current · 82 uncertain ·
77 historical · 50 recently resolved · 6 emerging.

## 8.8 Performance

Warm process, median of five, Arizona (230 players, seven affiliates).

| | `main` | this branch |
|---|---|---|
| `computeFarmSystem` | 1,080 ms | 1,138 ms |
| ten `farmConsequenceFor` in one session (the MLB case the hardening phase took from 10.9 s to 1.1 s) | 1,122 ms | 1,247 ms |
| one `farmConsequenceFor` | 1,152 ms | 1,104 ms |
| mean per organization, thirty organizations | 1,269 ms | 1,305 ms |
| the temporal reads themselves | — | game logs 2 ms · last games elsewhere 2 ms · injury absences < 1 ms |

The importer indexes the log tables on `team_id`, `game_id` and `player_id`. Everything temporal is
read once per `FarmSession` and the job windows are memoized in it; nothing is cached across requests.
The first version queried the database once per player for a departed man's name and cost a second;
the session memo removed it.

## 8.9 The workspace

No new view and no new column on any list.

* **Decision** — "What he is getting where he is" gains a three-row table, **Season / Recent / Now**,
  each with its level and its facts; his tenure; a role change where there is one; and the men no longer
  competing for his job, said as history.
* **Affiliates** — a conflict is said in the tense it is true in ("the season's totals show Hagaman short
  of work, but Jose Cabrera has left it and the club's recent games show no shortage"), says what it was
  read over, shows the season beside a man only where the reads disagree or his role cannot be read, and
  lists the men not competing with where they are now.
* **Assignments, Overview** — unchanged in shape; they simply stop listing the artifacts.
* **MLB Operations** — one line, "At Reno Aces now: …", and only when it changes how the vacancy reads.

Verified in the browser against the real save at 1440 px, no horizontal overflow, no console error.

## 8.10 Known limitations

* **No defensive innings by date.** A recent share is in starts; a mid-game position switch is invisible.
* **The window says who played, never why a man did not.** Blocked, resting, slumping and travelling
  are one fact. The read is therefore a usage read and never a verdict on a player.
* **No current-state source for hitters.** The export has no lineup or depth-chart table.
* **Without OOTP's transaction log, an arrival from a club that played no games is invisible.** The man
  is then `unknown` and his evidence thin, which is said, not guessed.
* **Day-to-day injuries are not absences** — a third are played through — so a man nursing one who sits
  for a week reads as not playing.
* **A complex league is below the twenty-game gate for most of its season**, so none of this is read.
* **The constants are provisional**: one partial season, one save, and a January export has no window.

## 8.11 Deferred to the peer-relative protection-tier branch

Nothing here changed a tier name, a tier threshold or what `core` / `protected` /
`development_priority` mean. Recorded for that branch, not solved:

* **Stakes decide who can be squeezed**, and the tier is an absolute-scale composite (C-9). Every
  "squeezed" and every "blocked" in this part inherits that: a 20-potential player in the Dominican
  league and one at Triple-A share a tier, so the window is only as good at finding a developmental cost
  as the tier is at naming who has one.
* **Visalia SS**: three men with a claim, two of them `development_priority`, all near a third of the
  starts, one marked squeezed. Whether that is a cost depends on whether the tier is right about them.
* `tier: null` (indeterminate stakes) claims nothing, correctly — and how often that happens at the
  complex levels is a tier question.

* **Checkpoint 10 — windowed usage: audit.** Every temporal source in the export inspected; the game log
  found, reconciled and adopted; the defect measured (§8.1, §8.2).
* **Checkpoint 11 — windowed usage: the model.** The window backtested; the three kinds of fact; the
  three window rules; tenure with its source hierarchy; current state for the rotation (§8.3, §8.4).
* **Checkpoint 12 — windowed usage: integration and validation.** Conflicts, the lone claimant, cascades,
  the contract, the workspace; ten findings (§8.6), four of them found by validating against the real
  save and the other twenty-nine organizations; 119 new cases. `npx tsc --noEmit` clean, 133 files /
  1,736 tests, `npm run build` succeeds. Arizona: 10 attention items.

---

# Part 9 — Developmental stakes underneath the farm (D-050)

The branch §8.11 deferred to. Full record: [DEVELOPMENTAL_STAKES.md](DEVELOPMENTAL_STAKES.md). Nothing in this
module's reasoning changed; what changed is the tier it is handed, and therefore who its findings are about.

* **What the farm reads is unchanged**: `hasDevelopmentalStakes` (development priority or better) decides who can
  be `squeezed`; `PROTECTED_TIERS` is the retention guardrail; `isPriority` counts congestion. The vocabulary is the
  same five tiers.
* **What the tier is now**: an absolute, organization-visible ceiling lowered by how much of the development that
  would realize it is left. It is obtained from `FarmSession.stakes()` — Player Development's reader, opened once per
  request — and never assembled here. The farm still takes no part in it: no usage, no result and no roster need is
  an input, and philosophy cannot reach it.
* **§8.11's open case, Visalia SS**: the man marked squeezed was a 23-year-old with a fringe ceiling sharing the
  position with a 20-year-old who is now a protected prospect and is playing. The conflict is `historical` and quiet.
* **Measured on the real save**: every player's current-assignment verdict, window, standing and opportunity
  verdict is identical; every affiliate's operational status and findings are identical, in all thirty
  organizations; retention's conclusions and every runway are identical (the `protected_prospect` guardrail fires
  for the first time, for eight players); 54 cascades are identical in every structural part. Across thirty
  organizations squeezed men went 144 → 125 (25 and over among them 3 → 0), blockages 31 → 25, the attention list
  571 → 544. Arizona's stays at 10.
* **B-1, fixed here**: `farmArrivalFor` named a job's holders only when the job was contested, which for a job with
  one holder turned on the ARRIVING man's tier — and the old composite gave a 32-year-old major-league star
  developmental stakes. It reads the job through `jobRead` now, contested or not (`tests/farmArrivalHolders.test.ts`).
* **Noticed, then fixed in the stakes model's hardening pass (H-1 below)**: a part-time prospect was `squeezed` (a
  critical affiliate finding) while his own review called sharing a job ordinary.

* **Checkpoint 13 — developmental stakes.** `npx tsc --noEmit` clean, 141 files / 1,842 tests,
  `npm run build` succeeds. Arizona: 10 attention items.

### 9.1 One line between sharing a job and being short of it (the hardening pass)

| # | Finding | Class | Fix |
|---|---|---|---|
| H-1 | `playingTime.ts` drew "short of developmental work" three ways: the rotation and the bullpen said `{not_used, occasional}`; the position conflict alone added `part_time` and `bat_only`. A sharing prospect was `squeezed` — a `blocking` conflict, a critical affiliate finding "not getting developmental work" — while his own review, from the same read, said "sharing the job, which is ordinary at this level"; a designated hitter was "not getting developmental work" at a position while H-6 had made his bat's work a quieter question. | **SYSTEMATIC** (predates the stakes model; the tier change exposed it by making the tiers it turned on right) | One exported line, `shortOfWork` = `{not_used, occasional}`, for all three jobs, and `verdictOf` / `shortOfWorkVerdict` so the review's verdict table is the same line; `tests/farmJobSharing.test.ts` proves they agree for every level of work and pairs the club's reading with the man's in ten golden cases. A part-time man is sharing; a designated hitter is the review's question (worth a look), not the club's. |
| H-3 | `farmConsequenceFor`'s "whose playing time changes" read only the club's *contested* conflicts, so a departure from a job two men shared named nobody — and had named the sharer only while H-1 wrongly contested the job. | **BUG** (same class as B-1) | The departed man's job is read through `jobRead`, contested or not; 17 of Arizona's 54 departures now name a sharer, and the cascade's chain is identical in all 54. |

Across thirty organizations, with every one of the 6,411 reviews' conclusions and attention levels unchanged:
`squeezed` men 125 → 26 (ages 17–24; none 25 or over), `blocking` conflicts 115 → 24, conflicts 500 → 415, raised
developmental findings 349 → 270, the attention list 544 → 537. The reviews not moving is the proof the affiliate view
was the one out of step. Arizona: Amarillo's critical RF finding (Nathan Hall, part time) is gone; Visalia's SS reads
"3 men have a claim on SS, which supports 2" (`noted`) in place of a historical shortage; Reno's CF "cannot be read yet"
line names Druw Jones alone, Ryan Waldschmidt having been a part-time man over the season. Arizona's attention list
stays at 10.

The farm's `ageRelativeToLevel` (D-044) now comes from the stakes reader (`developmentalContext.ts`) rather than
`computeProspects`' league baselines: the same population, but one implementation with one thin-league fallback, so a
man's review and his stakes cannot disagree about how old he is for his league.

* **Checkpoint 14 — hardening.** `npx tsc --noEmit` clean, 143 files / 1,868 tests, `npm run build` succeeds.
  Arizona: 10 attention items; 14 conflicts; 26 arrivals name the same holders as before.

