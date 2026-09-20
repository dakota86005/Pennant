# Roster Review: the scouting department layer

Status: **stages 1 to 6 built** on `feature/mlb-operations-v2` (uncommitted at the time of writing). This file is the design and the build log
for the proactive layer (performance-driven review, cascades, hitters, and the staff
recommendation). It extends [MLB_OPERATIONS.md](MLB_OPERATIONS.md); read that first for the
subsystem boundaries (D-024 to D-030).

## 1. What the GM asked for

A staff that reads the roster **unprompted** and says, as a real scouting department would:
"Soroka has the weakest tools in your rotation and the results agree; here is who could replace
him, how it would work, and what it does to the rest of the roster." Not only after an injury.

Three gaps were named after the first briefing layer:

1. Proactive, performance-aware review of role holders and the need for replacement.
2. **Cascades**: a swap that moves a starter to the bullpen must be followed through.
3. **Hitters**: compare against the incumbents at the same position with defense, platoon and the
   lineup taken into account.

Plus: refine and expand how replacements and the need for replacement are assessed.

## 2. Principles that do not move

- MLB Operations composes; specialists own answers. New evaluation logic lives in evaluation
  modules, not in `mlb*.ts`.
- No raw ratings outside `scoutedEvidence.ts`; only organization-visible ratings (D-017).
- Unknown stays unknown. A player with no evidence is named, never assumed weak.
- No hidden magic score. Every conclusion shows its lenses; where lenses are combined the weights
  are shown and the lenses stay visible beside the result (D-031).
- A review finding is **a flag for a GM's attention, never a transaction trigger** and never an
  automatic decision. Recommendations are advisory, rubric-based and explain what would change
  them.
- Philosophy applies only after validity, as a preference among valid alternatives.
- Sample size is a first-class input. 43 games into a season nobody's results mean much: the
  design leans on multi-season results and says so.
- Every numeric threshold is a **provisional calibration parameter**, declared once, stamped,
  and kept out of the `mlb*.ts` modules by the boundary test.

## 3. What the export supports (checked on the real save, 2026-05-16)

| Evidence | Where | Use | Boundary |
|---|---|---|---|
| Visible tool ratings, stamina, pitch grades | `players_batting/pitching` via `scoutedEvidence.ts` | ratings lens | approved (D-017) |
| Visible fielding grades per position | `players_fielding` via `gloves.ts` / `scoutedGloves` | defense lens | approved (D-017) |
| Season results, MLB, 2019 to 2026 (many seasons) | `players_career_batting/pitching_stats` (`split_id` 1) | results lens | objective statistics: facts |
| Batting splits vs LHP / RHP by season | batting `split_id` 2 = vs LHP, 3 = vs RHP (verified: right-handed batters see fewer left-handers, and hit them better) | platoon | objective |
| Pitching splits vs L/R | pitching `split_id` 2/3, current season only | not used | thin |
| WAR, UBR | batting/pitching stats | context lens | objective, game-computed |
| Fielding results | `players_career_fielding_stats`: games, starts, innings, errors, putouts; zone rating (`zr`) only for the current season (2026 rows carry `split_id` 0, history `split_id` 1) | usage, errors; zr as a thin current-season note | objective |
| Handedness | `players.bats` (1 R, 2 L, 3 S), `players.throws` | platoon | objective fact |
| Usage | starts (`gs`), games, innings, plate appearances, saves, holds, leverage (`li` / batters faced) | lineup picture, bullpen roles | objective |
| Active list | `team_roster.list_id` 1 | who is on the club | via Player State |

**Approved by the owner (D-035).** A hitter's rating splits against left- and right-handed pitching and his running
ratings are read through `scoutedEvidence.ts` and drive the platoon prior and the running dimension. Still **not** used, and
enforced by the boundary tests: pitchers' rating splits, hit-by-pitch and BABIP ratings, ground/fly and holding-runners ratings,
and bunt ratings. Baserunning and defensive results are read from statistics (UBR, steals, zone rating, framing); park effects
come from the app's existing park factor.

## 4. Architecture

```text
export ──► scoutedEvidence (ratings, fielding grades, fielding population)      approved ratings
       └─► resultsEvidence  (objective seasons, splits, usage, handedness)     objective facts
                 │
                 ▼  evaluation modules (pure, calibration declared here)
   resultsMetrics ── rates, league-relative results, sample confidence
   roleStanding ──── where a player stands against a group (exists)
   roleReview ────── per role holder: ratings lens · results lens · working estimate ·
                     competing explanations · flag strength                       (pitchers, then hitters)
   lineupPicture ─── who plays where, from usage (regulars, DH, bench)
   positionFit ───── defense at a position (visible grade + errors), position weights
   platoon ───────── observed splits shrunk to a stated prior; complement fit
   rosterScenario ── apply moves to a club view; recompute floors, standings, counts (cascade)
                 │
                 ▼  MLB Operations (composes; decides nothing)
   mlbNeeds     kind `role_holder_review` (observed, proactive, flag-only)
   mlbResponses direction `replace` (a flagged holder), scenarios per replacement path
   mlbReport    staff report: situation · picture · read · recommendation · pathways · cascade
   mlbReview    the roster-wide review (rotation, bullpen, lineup, bench)
```

## 5. Staged build and checkpoints

| Stage | Content | Checkpoint |
|---|---|---|
| 1 | Results evidence + metrics + population percentiles; sample confidence | tests, real-save numbers |
| 2 | Pitcher role review, `role_holder_review` need, `replace` direction, replacement assessment refinements | tests, real save, UI |
| 3 | Cascade engine (`rosterScenario`) and its integration into pathways | tests, real save |
| 4 | Hitters: lineup picture, defense, platoon, position review, replacements and cascades | tests, real save |
| 5 | Staff recommendation rubric, roster-wide review page, docs | tests, browser check |

Each stage keeps `tsc`, the full suite and the build green. Design decisions are recorded in
DECISIONS.md (D-031 onward) as they are made.

## 6. Build log

### Stage 1 (done): results evidence
`resultsMetrics.ts` (pure): wOBA, FIP-surrogate and ERA relative to each season's league; Marcel-style
5/4/3 recency weights by opportunities; `reliability = n / (n + k)` (k 250 PA hitters, 300 BF
pitchers); `percentileAmong`. `resultsEvidence.ts` (adapter): multi-season lines summed over stints,
league environment via `stats.ts`, a cached league population (hitters; starters and relievers split
by usage) for percentiles, handedness. Real save: Soroka 25th percentile on peripherals and 26th on
runs allowed (674 effective BF, 69% trusted); the whole rotation reads plausibly.

### Stage 2 (done): the scouting read and the replace direction
`roleReview.ts`: two lenses (tools; results), a working estimate weighting results by reliability,
findings (`ratings_and_results_weak`, `tools_weak_results_fine`, `results_weak_tools_fine`,
`too_early`, ...), competing explanations (luck via peripherals vs runs, results ahead of or behind
tools, aging, thin current season), and `compareReplacement` (clear upgrade / uncertain / marginal /
sidegrade / downgrade with certainty). `mlbReview.ts` composes the club review and turns strong or
moderate findings into `role_holder_review` needs (a flag, never a trigger; watch items are shown
but are not needs). `mlbResponses.ts` direction `replace`: candidates compared with the holder,
a lead replacement chosen by readiness (hard blocks never lead; a right that cannot be established
or an evaluation not yet complete may), the read names who is held up and why. Duration is not
assumed (D-027 applies). Real save: Soroka strong; Merrill Kelly a clear upgrade (+35) but
context-dependent for Player Development and indeterminate for Rights (rehab).

### Stage 3 (done): the cascade engine
`rosterScenario.ts` (pure): moves (`add_active`, `option`, `designate`, `sixty_day`,
`role_change`) applied to a club view; group snapshots (healthy vs floor, mean and weakest working
estimate); consequences (counts, groups, problems). `mlbPlans.ts`: the plans for replacing a
holder (send down / move to the bullpen / designate / open spot), each evaluated with the lead
replacement in place, with the follow-up move chosen (the weakest arm, by working estimate, of the
group that gained a body among those Rights lets the club option) and certainty as the least
certain link. `evaluateDestinationFit` gained `asPitchingRole` so a starter's tools can be read as a
reliever; results are never carried across roles. Real save: "Move Soroka to the bullpen, bring in
Kelly, option Drey Jameson": rotation 46.9 to 53.9 mean, bullpen 48.9 to 48.8.

Tests: `resultsMetrics`, `roleReview`, `rosterScenario`, `mlbReview`, `mlbReplace` (+ the report and
boundary suites).

### Stage 4 (done): hitters
`lineupPicture.ts` (pure): the regular at each position is the man with at least 40% of the team's
innings there this season, the DH is whoever starts without a fielding start to explain it, the bench is
the rest; a position nobody has that share of is "unsettled", never given a regular. `resultsEvidence`
gained fielding usage (innings, starts, errors by position), batting splits over five seasons and the
league's own platoon effect by batter hand. `scoutedEvidence.scoutedFieldingPopulation` ranks a revealed
fielding grade against MLB players listed at the position. `roleReview` gained a defense lens for
hitters: bat estimate (tools and wOBA percentile) blended with the glove at the position by a
provisional position weight (C .40, SS .35, 2B/CF .30, 3B .25, RF .20, LF .10, 1B .05, DH 0); a glove
that is not revealed is not assumed bad (the estimate is the bat alone, and says so). `platoon.ts`
(pure): observed splits shrunk toward the league's effect for that batter hand by sample; only an
effect clearly larger than the league's own is a platoon problem; `complementFit` says whether another
hitter is clearly better against the weak hand. `mlbReview.reviewLineup`: the nine regulars judged
against each other, with the platoon read on each. Replacement for a hitter: candidates listed at the
position, Triple-A hitters whose revealed grade supports it, and BENCH players (moving another regular
opens a new hole and is not offered); a bench player who improves the spot is a **lineup decision**
(plan `lineup_change`: no transaction, nothing for Rights to refuse).
Real save: Tim Tawa (LF) is the weakest regular (tools 36th, wOBA 9th, glove 94th but LF is 10% glove);
Alek Thomas from the bench is a clear upgrade (+11) for a lineup change. No platoon problem exists in
this league (the game's platoon effect is small and the samples thin): the tool says so instead of
inventing one.

### Stage 5 (done): the staff recommendation
`mlbReport.recommendationFor`: a stated rubric (ACT / EXPLORE / MONITOR / HOLD) over the strength of the
case, the lead replacement's verdict and certainty, whether his path is open and defensible, and
whether a plan exists that puts nobody at risk. It names what to settle first, what would change the
recommendation, and says when the replacement is still below the group's median. It is advice: an
ACT is never a designation, and every recommendation carries its basis.

### Stage 6 (done): calibration, richer evidence, and the rest of the club
Driven by the owner's decisions: approve rating splits and running (D-035), tune the constants and expand the logic (D-037),
make philosophy and the competitive window pivotal (D-036), and build the four items left over (D-038).

**Calibration** (docs/CALIBRATION.md): the constants are backtested on the league's own history and stamped. The season weights,
stabilization constants, pitcher mix, tools lens, platoon prior and shrinkage changed; a nine-fold scale error in the FIP surrogate
was found and fixed. A calibrated **tools model** (`toolsModel.ts`) replaces the unweighted mean of five tools: expected wOBA above the
league, with contact, power and eye carrying the bat. Results are shrunk toward what the tools imply when both are known.

**A hitter is bat + glove + running**, each shown with its weight. The bat is tools and park-adjusted wOBA; the glove is the visible grade
and zone-rating results at the position, blended by sample; running is the running ratings and baserunning runs. Real save: Tim Tawa
(left field) is a moderate case (estimate 39th; the calibrated left-field glove weight is .24 not .10).

**Platoon** now rests on ratings first (`platoon.ts`): the league norm for a hitter's hand, adjusted by his ratings' departure from
it, with his own split pulled toward that and read on thin samples. Real save: no Arizona hitter is a platoon problem (the largest
excess is 7 wOBA points against a 12-point threshold), and the tool says so. A regular who is one raises a `platoon_complement`
need; a partner on the bench is a lineup decision, one from the minors is a plan with the moves Player Rights states.

**Position shifts** (`lineupShifts.ts`, `shift` plans): a regular moves to the weak spot and the spot he leaves is covered from within,
proposed when the two spots gain together. Real save: Lawlar to left field and Thomas to center field, +13 across both spots
against +7 for the plain swap, with no player added and the comfort cost stated.

**Bullpen roles** (`bullpenRoles.ts`): closer, high-leverage, middle, long man, low-leverage from usage; the stakes weigh a weak arm's
cost (Joe Ross is a long man in low-leverage spots), and a better arm in a lower-leverage role than a worse one is a deployment finding.

**Bench** (`benchReview.ts`): what each bench player is for, what he can play, which hand he bats from, and a `bench_coverage` need for a
required position (catcher, middle infield, center field) nobody on the bench can play. Real save: the bench covers all three.

**Philosophy and the season** (`staffPreference.ts`, D-036): the window and the club's chance of the postseason set the urgency of a flag,
the bar for "recommend", the tie-break among equivalent replacements and the order of plans; every lean is shown and a recommendation
says what a club with no philosophy would have heard. Arizona reads as pressing: balanced window (50), 86% to reach the postseason.

Tests: `calibrationFit`, `staffPreference`, `staffShading`, `bullpenRoles`, `benchReview`, `lineupShifts`, `mlbPlatoonBench` (+ the
rewritten `platoon` and the extended boundary suites).

### Limitations (Stage 6)
- Defensive results (zone rating, framing) exist for the current season only, and baserunning value is small in this game; both
  gain weight as the season grows and the glove weights should be re-derived (CALIBRATION.md section 3).
- Contract, service-time and prospect-capital dimensions (team control, cost efficiency, payroll flexibility, prospect preservation)
  do not lean on the advice: contract data is not part of the review.
- Position shifts move one regular and cover from the bench or by a swap; three-way chains and moving a regular to or from designated
  hitter are not proposed.
- A platoon partner from the minors needs a roster spot; the plan states it and points to the clearing options, but does not choose one.
- A pitcher moved to another role is compared on tools only (his results in the old role are not carried over).
- The bench is reviewed for coverage and role, not ranked against Triple-A hitters for quality; the DH's platoon is read as a regular's.
- Pitchers' rating splits (a left-handed specialist's platoon value) are not approved evidence.

## 7. Open owner decisions

1. **Approve pitchers' rating splits?** A left-handed specialist's value against left-handed hitters is the pitching side of platoon. Not
   approved by D-035, which named hitters' splits and running.
2. **Contract and prospect-capital dimensions.** Team control, cost efficiency, payroll flexibility and prospect preservation do not yet lean on
   the advice because contracts and prospect capital are not part of the review. Bringing contract facts (objective) into it would let a
   philosophy that values control or flexibility shade a recommendation.
3. **Re-derive the glove weights as the season grows.** Run the harness after a few hundred more games; the weights are the one provisional
   constant with the largest effect on which hitters are flagged.
4. **Scope of the next slice:** three-way position chains, DH moves, a Triple-A-versus-bench quality read, and a platoon plan that chooses the
   clearing move.
