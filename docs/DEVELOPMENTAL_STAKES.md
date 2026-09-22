# Developmental stakes: the protection tier, refined

The record of the phase that rebuilt what sits underneath Player Development's protection tier
(`server/developmentFit.ts`). Branch `feature/peer-relative-protection`, from `main` at `d263962`.
Decision: [D-050](DECISIONS.md). Nothing here is a prospect ranking, and nothing here was committed
or pushed.

Baseline before any change: `npx tsc --noEmit` clean, 136 files / 1,773 tests, `npm run build`
succeeds. Every real-save measurement below is from the Arizona import (2026-05-16, 30
organizations, 6,411 minor leaguers on an affiliate's active list), read only: no OOTP file was
opened and `data/league.db` was not written to.

---

## Part 1 — What the tier was (audit)

### 1.1 The formula, reconstructed

```text
score = round( 0.60 × potential′ + 0.20 × upside′ + 0.10 × youth + 0.10 × current′ )

potential′, current′   (rating − 20) / 60 × 100, on the adapter's 20-80 composite
upside′                min(100, (potential − current) / 30 × 100)
youth                  a step table on age: 100 at ≤18 … 72 at 22 … 45 at 24 … 5 at ≥27

core_prospect ≥ 78 · protected_prospect ≥ 57 · development_priority ≥ 42 · normal ≥ 25 · else organizational_depth
```

Inputs: age and a `ScoutedAbility`. Level, league, experience, results and peers were not inputs.
Either composite unknown → `score` and `tier` are `null` with the missing evidence named; a manual
protection (reserved, no control supplies it) → `core_prospect`.

What is architecture and what is history:

| Architecture (kept) | Historical implementation (replaced) |
|---|---|
| The five-tier vocabulary and what each consumer does with it | The weighted 0–100 score and its four cut-offs |
| Ability only as a branded `ScoutedAbility` (D-017) | Reason lines keyed to 65 and 55 on a scale the input never reaches |
| Unknown ratings → unknown tier, never a midpoint (D-018); `hasKnownTier`, `requireKnownProtection`, `protectionTierState` | Age as a 10% additive term |
| Independent of roster pressure and of philosophy (D-019) | No developmental context at all |
| The ceiling matters more than the size of the gap | |

### 1.2 Every consumer

| Component | Why it uses the tier | What changes by tier | Still appropriate? | Risk if the distribution moves |
|---|---|---|---|---|
| `mlbAssignmentContext.ts` (Player Development; called by `org.ts` `mlbAssignmentAssessments`, consumed by `mlbResponses`) | How much of a temporary assignment's readiness relief the player's development forfeits (D-025) | `STAKES_WEIGHT` 1 / .75 / .5 / .25 / 0 shrinks the relief; only weight ≤ .25 (`normal`, depth) may be established by upper-level experience alone | Yes: it is the definition of the contextual pathway | **High.** A re-tiering moves required readiness and opens or closes the experience route |
| `playingTime.ts` | Missing reps cost development only where there is development to cost | `hasDevelopmentalStakes` (priority or better) decides who is `squeezed`, hence `severity: blocking` and whether a two-man job is contested | Yes | **High.** Every "squeezed" and "blocked" is only as good as the tier |
| `farmAssignments.ts` | Same test for one man | Gates `organizational_blockage` / `opportunity_conflict`; sets `needs_attention` against `worth_a_look` | Yes | High: the attention list |
| `farmOrganization.ts` | Congestion on the developmental path | `isPriority` counts, `PRIORITY_CONGESTION_AT` findings, rotation-surplus severity | Yes | Medium |
| `farmRetention.ts` | Is there still a development case? | `null` → outlook indeterminate; `PROTECTED_TIERS` → `developing` plus the `protected_prospect` guardrail; depth → `exhausted` rather than `plateaued` | Yes | Medium. The guardrail never fired on the real save (below) |
| `farmConsequence.ts` | The arrival answer | The newcomer's tier (computed directly for a man not on an affiliate), holders' and displaced men's tiers | Yes | Low; but it was a **second call site with its own inputs** |
| `farmAffiliate.ts` | Wording of findings | Labels only | Yes | None |
| `currentAssignment.ts` | Shows stakes beside its two readings | Nothing: the verdict does not read the tier | Yes | None |
| `farmCascade.ts` | — | **Does not read the tier.** A step's defensibility is `prospectAssignments`' | Correct as it stands | None |
| `prospectDecision`, `prospectAssignments`, `destinationFit` | — | **Do not read the tier.** Authorization is independent of stakes | Correct as it stands | None |
| `scoutedDevelopment.ts` → `Prospects.tsx` | Carries the tier to the Player Development pages | Served, never rendered | Yes | None |
| UI | `farm/Assignments.tsx` (column), `farm/Decision.tsx` (header, parts), `mlb/Decision.tsx` ("Stakes: …") | Labels | Yes | Wording |
| AI | Receives the farm's attention list; never the tier itself | — | — | Indirect |
| Philosophy | **No input into the tier, and none out of it** | — | — | — |

`minimumRegularAssignmentFit`, `canUseAsRegularAssignment`, `protectionTierState` and
`evaluatePositionAssignments` had had no production caller since the superseded solvers were deleted
(D-047). They were kept through the rebuild and removed in the hardening pass (Part 9): three of them
mapped the tier to a strictness nobody had validated, and dead tier logic can be mistaken for the
authoritative kind.

Five production call sites computed the tier, each from `{ age, ability }` it assembled itself
(`farmOperations`, `farmConsequence`, `scoutedDevelopment`, `mlbAssignmentContext`, and tests). That
was harmless while the inputs were two numbers. It is not once context is an input, because two
callers could then tier one man two ways.

---

## Part 2 — What was wrong (measured before anything changed)

### 2.1 F-1: the top two tiers did not exist

| Tier | League-wide (6,411) | Arizona (230) |
|---|---|---|
| core_prospect | **0** | **0** |
| protected_prospect | 53 (0.8%) | **0** |
| development_priority | 1,902 (29.7%) | 73 |
| normal | 3,950 (61.6%) | 140 |
| organizational_depth | 491 (7.7%) | 17 |
| unknown | 15 | 0 |

The cause is a scale that moved under the thresholds. The model was written (`57ebd42`) against
OOTP's printed Overall and Potential. D-017 (`b6f69e3`) correctly replaced that input with the
adapter's composite — the unweighted mean of the visible tools — and the cut-offs were carried over
unchanged. The composite is far more compressed:

| Population | p10 | p50 | p90 | max |
|---|---|---|---|---|
| Major leaguers, current composite, hitters (390) | 45 | 50 | 56 | 64 |
| Major leaguers, current composite, pitchers (390) | 45 | 48 | 53 | 67 |
| Minor leaguers, **potential** composite, hitters (3,078) | 36 | 43 | 49 | 60 |
| Minor leaguers, **potential** composite, pitchers (3,318) | 35 | 42 | 48 | 57 |

`core_prospect` needs a potential composite near 70; one minor leaguer in 6,396 reaches 60. The
reason lines spoke of a "high-end ceiling" at 65 and "major-league upside" at 55 on a scale where the
median major leaguer is a 50. Consequences that had been noticed as symptoms and not traced: the
`protected_prospect` retention guardrail never fired for Arizona; MLB Operations recorded that "the
core-prospect rule could not be exercised on real data" (MLB_OPERATIONS.md §23); and the tier was in
practice three-valued with 62% of everyone in the middle.

### 2.2 F-2: context-blind

The same visible ratings gave the same tier across contexts that have nothing in common:

| Ratings | One man | Another | Shared tier |
|---|---|---|---|
| 46 / 51 | 19, Double-A, 5.8 years younger than his league | 25, Triple-A, his league's age | development_priority |
| 30 / 47 | 17, full-season Single-A, 5.8 years young | 23, Arizona Complex League, 2.3 years old for it | development_priority |
| 37 / 50 | 18, Single-A | 24, Triple-A | development_priority |
| 50 / 50 | 25, Double-A | 33, Triple-A | normal |
| 40 / 43 | 22, High-A | 28, Double-A | normal |

Seventy-five rating profiles, covering **2,250 players (35%)**, shared one tier across an age span
of six years or more. The tier mix was nearly flat from the Dominican Rookie League (35%
priority-or-better) to Triple-A (23–29%).

### 2.3 F-3: youth manufactured priority

`development_priority` at 42 was reached by any teenager with a wide gap to a sub-major-league
ceiling: a 17-year-old at 23 / 41 scored 43. **43–48% of all 16- and 17-year-olds** were
priority-or-better while the median potential composite at those ages is 39 — six points under the
weakest tenth of today's major leaguers. Those are the men `playingTime` then reports as `squeezed`.
At the same time a 22-year-old Double-A hitter at 45 / 55, a top-one-percent ceiling, scored 53 and
was also `development_priority`. The tier could not tell them apart.

### 2.4 Evidence that turned out not to be usable

* **Development history.** `history.db` holds **one** snapshot for this save (2026-05-16, 8,009
  players), and `history.ts` rightly needs three across 75 days, so every player's trajectory is
  `insufficient`. The snapshot composite is also a partial average on the native scale, not the
  adapter's strict composite (a known gap, ROADMAP §3), so a delta can move when a tool's visibility
  does; and a rating change confounds development with scouting revision (D-002).
* **OOTP's own projection carries the trajectory.** The median visible gap (potential − current) is
  7 at age 24 and **0 at age 25**: the game collapses a stalled player's scouted potential onto his
  current ability. A plateau is therefore already in the evidence the tier reads.

---

## Part 3 — What the tier means (the contract)

> **How high are the developmental stakes if the organization mishandles this player?**

It is a statement about *unrealized development the organization's own scouting can see, and how
much of the time to realize it is left*. It is what would be lost, developmentally, by treating him
as a body.

| It is | It is not |
|---|---|
| A reason to look harder when he is not playing | Whether he should play |
| A reason to be slower to use him as temporary major-league cover | Whether he is ready for the majors |
| A reason he is not routine roster-filler | Whether to promote, demote, start, call up, trade or release him |
| Player Development's, the same for every organization | A rank, a trade value, a future-WAR estimate, or a read of how he is hitting |

A higher tier may justify stronger protection from blocked playing time, more caution with a
temporary role, stricter treatment of developmental opportunity, and less willingness to use him to
solve a body-count problem. It authorizes nothing. A `core_prospect` can be developmentally ready
for promotion; an `organizational_depth` player can have a perfectly defensible major-league
assignment and can be the best player on his club. **Organizational depth says his development is
no longer what is at stake — not that he is not useful.**

The vocabulary is unchanged:

| Tier | Reading |
|---|---|
| `core_prospect` | A ceiling among the best tenth of today's major leaguers, with most of his development still ahead |
| `protected_prospect` | A major-league regular's ceiling with most of his development ahead; or a top ceiling with some |
| `development_priority` | The organization's scouting sees a major leaguer, and the development that would make him one is still in play |
| `normal` | Developed in the ordinary way; mishandling him costs little that is visible |
| `organizational_depth` | No visible major-league projection left to protect, or his developmental years are behind him |

---

## Part 4 — The model

```text
   organization-visible ability                objective developmental context
   (ScoutedAbility, D-017)                     (age · his league's rostered age profile)
              │                                              │
              ▼                                              ▼
   CEILING  — the absolute anchor              DEVELOPMENT REMAINING — the context
   what his visible potential would be         most · some · little · none
   among today's major leaguers of his kind    from age, then the shorter of:
   impact · regular · fringe · below             · behind his level's schedule
                                                 · visible projection nearly all realized
              └───────────────────┬──────────────────────────┘
                                  ▼
                 the ceiling, lowered one tier for each step
                 by which the development that would realize it has run out
```

| Ceiling ╲ Development remaining | most | some | little | none |
|---|---|---|---|---|
| **impact** | core | protected | priority | normal |
| **regular** | protected | priority | normal | depth |
| **fringe** | priority | normal | depth | depth |
| **below the major leagues** | normal | depth | depth | depth |

### 4.1 The anchor is absolute

The ceiling is read from the potential composite against three lines that mean something: the
composite of the **weakest tenth, the median and the best tenth of today's major leaguers of his
kind**, measured on the import and held as constants.

| | fringe (MLB p10) | regular (MLB p50) | impact (MLB p90) |
|---|---|---|---|
| Hitters (five tools) | 45 | 50 | 56 |
| Pitchers (three tools) | 45 | 48 | 53 |

Kind-aware because the composite is: with hitters' lines applied to pitchers, **no pitcher in the
league was core and 1.5% were protected against hitters' 5.9%**. The lines are constants and not a
runtime percentile, so a player's anchor is a pure function of his own evidence and no other
player's rating can move it (`npm run stakes:report` re-measures the reference on any import and
says when it has drifted).

Context can only lower what the anchor allows. **Nothing in the context can raise a ceiling**: a
weak cohort cannot manufacture a prospect, a strong one cannot erase one, and being young is not
talent.

### 4.2 Development remaining

1. **Age** sets it: most through 22, some at 23–24, little at 25–26, none from 27. These are the
   bands of the old model's own youth curve (≥72, 45–60, 18–30, 5), so the historical judgment about
   youth is kept and only its use changes: age no longer adds points to anybody, it says how much of
   a visible ceiling is still in play.
2. **His level's schedule** may shorten it and never lengthen it. A player at least
   `OLD_FOR_LEVEL` (1.5) years older than his league's rostered average has at most *some*; at least
   `AGE_LEVEL_DEVELOPMENT_LIMIT` (3.0), at most *little*. These are D-044's constants, and wherever a
   league has the minimum population it is the same number `currentAssignment` reads (every league on
   the real import: 189 to 1,820 rostered), so the two do not describe one man two ways. Being *young* for a
   level is reported and changes nothing: the rostered average of an upper level is inflated by
   veterans, so almost every real prospect at Triple-A is "young for it", and a level is an
   assignment the GM controls — a tier that rose on promotion would be grading the GM's own move.
3. **Visible projection nearly all realized** (potential − current under 3) costs one step at any
   age: what the scouts see ahead of him has happened.

### 4.3 The peer frame, and the ones rejected

One population enters, for one purpose: **the rostered players of his own league at his own
level**, for their average age. Rostered means a `team_roster` row (an unassigned signing is not a
peer: D-039, F-0-farm); a league, not a level (F-1-farm: the Dominican league is 2.4 years younger
than the complex leagues at the same level code); below 25 rostered players the level pool is used
and said to be; with neither, the schedule is `not_established`, stated, and **nothing is
discounted** — missing context may never lower a man's stakes.

| Frame considered | Verdict |
|---|---|
| Percentile of ratings within his league or level | **Rejected.** It is the model this phase was told not to build: a weak league promotes its median and a strong one demotes a real prospect. Talent is never read against neighbors |
| Percentile within a league-wide age cohort | Rejected: same defect, larger pool |
| Same organization | Rejected: an organization's depth is not evidence about a player |
| Role or position | Rejected: nothing about a position changes what is at stake, and minor-league position groups are too small to rank in (GLOVE_GRADE_CALIBRATION) |
| Today's major leaguers, by kind | **Used offline only**, to give the anchor lines a meaning. Not a runtime input |
| His league's rostered average age | **Used**, for the schedule only |

### 4.4 Considered and left out

| Dimension | Why not |
|---|---|
| **Current production** | Not an input, in any form. The farm already reads it in `currentAssignment` and retention reads both, so it would count twice; it would re-tier men weekly; and on this import the complex affiliates had played ten games and none. A hot line cannot raise a tier and a cold one cannot lower it, because neither is read |
| **Development history** | One snapshot exists (§2.4). The seam is left — context is an object — and the gap it would fill is mostly filled by OOTP's own collapsing projection |
| **Professional experience, repeat level** | Redundant with age against the level for this question, and a just-drafted 22-year-old would read as inexperienced. Repeat-level context belongs to the assignment review (ROADMAP §5) |
| **Young for an advanced level, as a lift** | §4.2 item 2 |
| **A wide gap reopening an older player's window** | A wide gap at 25 is as much "far to go, little time" as "the scouts still believe". An older player with real visible upside is kept out of organizational depth by his ceiling instead |
| **Position or role** | Does not change developmental stakes |

### 4.5 Unknown stays unknown

| Missing | Result |
|---|---|
| Current or potential composite | `tier: null`, the missing evidence named, known facts still shown |
| Age | `tier: null` (MLB Operations: stakes `unknown`, as before) |
| His league's age profile | Tier from the anchor and his age; schedule `not_established` and said so; never a discount |
| Level context not supplied at all | The same, and the reading says it was not supplied |
| A peer population under the minimum | Level pool, named; else `not_established` |

### 4.6 No score

`score` is gone from `DevelopmentProtection`. The model is a lookup on two named readings, so there
is no number to show, and the old one was exactly the "prospect score = 78.4" that means nothing.
The output carries its parts — ceiling (band, the line it cleared, the line it did not), development
remaining (age, schedule, projection, and which of them bound) — and, for anyone comparing, what the
superseded composite would have said and why it differs. That last reading decides nothing and a
test says so.

### 4.7 One way to compute it

`server/developmentalContext.ts` reads the objective context (a player's club, level and league,
and the league's rostered age profile) once per request and hands the pure evaluator what it needs.
Every production caller goes through it, so one man has one tier whichever module asks; a boundary
test fails if a module computes a tier from inputs of its own. `mlbAssignmentContext.ts` is HANDED the
reader's `DevelopmentProtection` by `org.ts` and cannot compute one (it no longer takes the ratings at
all), and the farm's "how old is he for his league" comes from the same reader, so a man's review and
his stakes cannot disagree about it.

### 4.8 Constants

| Constant | Stamp | Basis |
|---|---|---|
| `CEILING_LINES` (hitters 45 / 50 / 56, pitchers 45 / 48 / 53) | **provisional** | The p10 / p50 / p90 of one import's active major leaguers. A model parameter that ought to be re-estimated across saves |
| The quantiles those lines stand for (tenth, median, best tenth) | **policy** | What "a major leaguer", "a regular" and "an impact player" are taken to mean |
| `DEVELOPMENT_AGE` (22 / 24 / 26) | **provisional** | The old youth curve's bands. No longitudinal rating history exists to fit a development curve against |
| `PROJECTION_REALIZED_UNDER` (3) | **provisional** | One tool grade in three for a pitcher, three in five for a hitter |
| `OLD_FOR_LEVEL`, `AGE_LEVEL_DEVELOPMENT_LIMIT` | policy (D-044, unchanged) | Declared in `farmCalibration.ts`; read here, not redeclared |
| `LEAGUE_POPULATION_MINIMUM` | provisional (unchanged) | The same 25 the farm's production read uses |
| The lookup table, "context may only lower", unknown → unknown, no philosophy, no production | **architecture** | Pinned by tests, carry no stamp |

None is calibrated. The export holds one snapshot of ratings, so no constant about how players
develop can be fitted, and saying otherwise because Arizona's list looks right would be false.

---

## Part 5 — What was built

| File | What |
|---|---|
| `server/developmentFit.ts` | The model: `CEILING_LINES`, `DEVELOPMENT_AGE`, `PROJECTION_REALIZED_UNDER` with their stamps; `ceilingOf`, `developmentRemainingByAge`, `levelScheduleOf`, `tierFor`; `evaluateDevelopmentProtection` returning `tier`, `reasons` and the `reading`; `supersededCompositeTier`, which decides nothing; `knownAge`, `tierWord`. `score` removed; the dead position-assignment fit removed (Part 9) |
| `server/developmentalContext.ts` (new) | The one reader: a league's rostered age profile and a club's level and league, per request, and `protect()` |
| `farmOperations.ts`, `farmConsequence.ts`, `scoutedDevelopment.ts`, `org.ts` | Every call site goes through a reader (`FarmSession.stakes()` shares one per request), passing the age as the export has it. `org.ts` hands `mlbAssignmentContext` the reader's protection |
| `mlbAssignmentContext.ts`, `mlbResponses.ts` | Take the protection, never the ratings; `stakes` carries the tier, the weight and the reasons, no score |
| `farmConsequence.ts` | B-1 below |
| UI | `farm/Decision.tsx`: "Developmental stakes: … / why" under Player Development's readings; `farm/Assignments.tsx` and `mlb/Decision.tsx`: the reasons on hover. No new page, no rank, no number |
| `scripts/stakes-report.ts` | `npm run stakes:report [orgId]`, read-only: the reference the lines stand for and whether they have drifted, each league's age profile, the distributions, one organization's two-tier moves |

Tests (69 more than the baseline's 1,773; 141 files / 1,842 in all): `developmentalStakesGolden` (29), `developmentalStakesInvariants`
(15, swept over every age × rating × schedule × kind a player can occupy), `developmentalStakesBoundary`
(12, static), `developmentalContext` (8, against real SQL), `farmArrivalHolders` (3),
`farmDevelopmentIndeterminate` (+1, end to end across opposite philosophies); `developmentProtection`
rewritten for the score-free contract. See [BEHAVIOR_CASES.md](BEHAVIOR_CASES.md).

---

## Part 6 — Validation on the real import

### 6.1 Distribution

| Tier | League-wide before → after | Arizona before → after |
|---|---|---|
| core_prospect | 0 → **24** | 0 → 0 |
| protected_prospect | 53 → **308** | 0 → **8** |
| development_priority | 1,902 → 1,021 | 73 → 46 |
| normal | 3,950 → 2,917 | 140 → 100 |
| organizational_depth | 491 → 2,126 | 17 → 76 |
| unknown | 15 → 15 (the same fifteen) | 0 → 0 |

3,600 players kept their tier, 2,302 moved down one, 440 up one, 45 down two, 9 up two.

Where each tier comes from in the table (league-wide): core is *impact × most* (24); protected is
*regular × most* (288) and *impact × some* (20); development priority is ***fringe × most* (803)**,
*regular × some* (216) and *impact × little* (2); normal is mostly *below × most* (2,396), the
teenagers nobody projects as major leaguers. Age alone decided what is left for 5,355 players, the
realized projection shortened it for 683, the level's schedule for 352.

The 24 core prospects are the league's highest visible ceilings under 23 and read like a list of the
game's best young players, which the model was never shown: it had only ratings and ages. All 53 of
the old model's protected prospects are still protected (37) or core (16). The nine who rose two tiers
are 18-to-22-year-olds with top ceilings the old cut-offs could not reach; 35 of the 45 who fell two
are 20-to-22-year-olds still in the Dominican league with no major-league ceiling.

### 6.2 Arizona, read player by player

* **Up to protected (8):** Cristofer Torin (20, Triple-A, 44/51), Jansel Luis (21, Double-A, 44/53),
  Slade Caldwell (19, High-A, 36/52), JD Dix (20, Single-A, 38/52), Sawyer Hawks (22, 37/52),
  Hayden Durke (24, 40/53: a pitcher's top ceiling with some development left), Brian Curley and Connor
  Foley (22, complex league, 35/48: a median major-league pitcher's ceiling). The organization's best
  prospects were indistinguishable from 65 others before.
* **Normal → priority (8):** 22-year-olds with a major-league ceiling the composite scored under 42
  (Mitch Bratt, Yu-min Lin, Nathan Hall, …) and Spencer Giesting (24, a regular pitcher's ceiling).
* **Priority → normal (24):** teenagers with ceilings of 40 to 44 (five at the Dominican clubs),
  23-and-24-year-olds in Single-A with fringe ceilings, and Jorge Barrosa (25, 47/53).
* **Normal → depth (56):** finished or ageing players — Tyler Locklear (25, 49/50), Luis Urias (28),
  Luken Baker (29), Merrill Kelly (37, on rehab) — 23-and-24-year-olds still in the complex league, and
  20-to-22-year-olds still in the Dominican league with no major-league ceiling.
* **Two tiers (3), all down:** Dawson Brown (24, complex league, 3.3 years past it), Isaac Mendez (20)
  and Jose Belisario (22), both still in the Dominican league with ceilings of 42 and 43.

### 6.3 Across organizations

Priority-or-better runs from 13% (Houston) to 29% (St. Louis) of a system, protected from 4 to 19
players, core from 0 to 3: no organization has everybody protected and none has nobody. By league the
share of priority-or-better is lowest in the complex leagues (12–14%) and highest in the Single-A
leagues where 19-to-22-year-olds with real ceilings play (34–41%), so there is no complex-league
inflation; Triple-A holds 13 of the 24 core prospects, so there is no upper-minors suppression.
Pitchers are 4.0% protected-or-better against hitters' 6.5% (1.5% against 5.9% before the lines were
kind-aware). Every league's age profile rests on 189 to 1,820 rostered players.

### 6.4 Downstream, classified

| Where | Before → after | Reading |
|---|---|---|
| **Farm: every player's current-assignment verdict, window, standing and opportunity verdict** | identical for all 230 | **Boundary held.** The tier moved nothing it does not own |
| **Farm: every affiliate's operational status and findings** | identical; identical across 30 organizations (104 findings) | Boundary held |
| Visalia SS conflict (the case §8.11 of the farm record left open) | `blocking`, Wallace Clark (23, 39/48) squeezed → `noted`, historical | **Expected improvement.** The 20-year-old protected shortstop is the one with stakes, and he is playing |
| Wallace Clark's own review | promotion direction defensible, `needs_attention` → `worth_a_look` | **Policy difference.** Player Development's authorization did not move; only how loudly it is raised |
| Amarillo RF | no conflict → Nathan Hall (22, Double-A, 40/46, part time) squeezed | **Policy difference**: the *fringe × most* line. His own review is unchanged |
| Organization finding "two priority prospects at Single-A need reps at SS" | raised → not raised | Follows the first row |
| Attention list | 10 → 10 (needs attention 5 → 4) | — |
| Retention conclusions | 203 retain / 23 indeterminate / 3 review / 1 other → **identical**; every runway identical | **Boundary held.** No young player became a question; no depth player became protected |
| Retention wording | 8 older players `plateaued` → `exhausted`; the `protected_prospect` guardrail 0 → 8 | **Expected improvement**: the guardrail had never fired for this organization |
| MLB needs; the 233 candidate evaluations across 40 what-ifs | same needs, same candidates, none added or removed | Boundary held |
| MLB durable role (22 assessed) | identical | Boundary held: the durable gate does not read the tier |
| Yu-min Lin (22) and Spencer Giesting (24), short bullpen | defensible on experience alone → indefensible (readiness 39 and 42 against 73 and 71) | **Expected improvement.** Resolves the item MLB_OPERATIONS.md §23 recorded as debatable |
| Kohl Drake (25, 45/47), temporary depth | bar 67.5 → 64, readiness 65: indefensible → defensible | Expected: older depth keeps all of the relief. Marginal by one point |
| **Jorge Barrosa (25, 47/53, eight professional seasons)** | blocked → *depends on how long he would be needed* (temporary depth and bench defensible on established experience; durable not) | **Policy difference, and the one change a GM will see in MLB Operations.** At 25 little of his development is ahead of him, so experience may establish a short assignment |
| Every other Triple-A player | same judgment; veterans' bars 3.5 points lower, young upside 3.5 higher | Expected direction |
| Cascades: 54 departures | vacated job, absorbed, status before and after, replacements with Player Development's judgment, the chain, where it stopped, what it leaves open: **identical for all 54**; "whose playing time changes" differs for 2 (Amarillo RF) | **Boundary held.** The tier changed a consequence and no defensibility |
| Arrivals: 26 major leaguers sent to Reno | holders named for 16 → 26; no holder lost; Barrosa no longer "displaced" | B-1 and F-4 below |
| 30 organizations | attention 571 → 544, squeezed 144 → 125 (25-and-over among them 3 → 0, 19-and-under 20 → 12), blockages 31 → 25, guardrail 53 → 332, retention reviews 281 → 283, no crash | Findings moved toward men with development to cost; nothing was tuned to a count |

**Suspicious regressions: none found. Needs the owner's eye:** whether a fringe ceiling with most of
his development ahead (803 players, 38 of Arizona's) should count as having developmental stakes. It is
the line with the largest effect, it is policy, and the three new findings at Cincinnati are all of
that kind (22-year-olds at 39/45 to 40/46 in the upper minors).

### 6.5 Defects found

* **F-1 to F-3** (Part 2): the unreachable top tiers, context-blindness, and youth manufacturing priority.
* **F-4 — a high rating manufactured developmental stakes in finished players.** The mirror of F-3:
  ceiling and current ability were 70% of the score at any age, so **50 of the 542 active major
  leaguers aged 27 or more** were `development_priority` — Aroldis Chapman at 38, Freddie Freeman at 36,
  Aaron Judge at 34. It reached behavior through the arrival contract: a veteran sent down counted as a
  squeezed development claimant on the day he arrived.
* **B-1 — the arrival answer named a job's holders only when the job was "contested"**, and for a
  job with one holder that turned on the arriving man's own tier. With F-4 fixed, Ketel Marte's arrival
  at second base named nobody while its summary still said "1 man holds it". `farmArrivalFor` now reads
  the job whether or not it is contested (`jobRead`). Fails on `main`; pinned by `farmArrivalHolders`.
* **Five call sites computed the tier from inputs of their own.** Harmless with two inputs, a
  consistency defect with context. One reader now; a boundary test keeps it one.
* **Noticed here and fixed in the hardening pass (Part 9, H-1):** a prospect getting part-time work was
  `squeezed`, so the affiliate raised a critical "not getting developmental work" while his own review
  called sharing a job ordinary.

### 6.6 Performance

Medians of three alternating process runs of `main` and this branch on the real import:

| Path | Before | After |
|---|---|---|
| Player Development roster (`scouted-development`) | 67 ms | 78 ms |
| Player Development prospects | 926 ms | 924 ms |
| Farm: assemble | 104 ms | 116 ms |
| Farm: whole view | 1,091 ms | 1,091 ms |
| MLB overview | 121 ms | 123 ms |
| MLB: contextual assessment of 29 Triple-A candidates | 934 ms | 930 ms |
| MLB: responses for the open needs | 3,707 ms | 3,743 ms |
| Farm: ten consequences in one session | 1,133 ms | 1,136 ms |

The reader's two queries cost about 11 ms a request. Nothing is cached across requests. The
whole-league report runs in about a second.

---

## Part 7 — Known limitations

* **No constant is calibrated**, and none can be from this export (§4.8). The lines rest on one
  import's major leaguers; the age bands are inherited; the projection line is a first pass.
* **The composite is coarse.** It is the unweighted mean of three or five tools graded in fives, so a
  pitcher's can only be 45, 47, 48, 50, 52, 53…, and one tool grade moves him across a line. MLB
  Operations' calibrated tools model describes a hitter better (R² .40–.45 against .35–.37); it predicts
  present production, has no potential-side counterpart, and was not extended here.
* **Integer ages and hard bands.** A birthday can move a tier; a player a day short of 23 and one a
  day past it differ by a step.
* **A just-drafted older player parked at a complex club reads as behind its schedule** until he is
  assigned. Professional experience was left out (§4.4), which is what would tell them apart.
* **Trajectory is not read** (§2.4). A late developer is kept out of organizational depth by a visible
  ceiling, not by evidence that he is still improving.
* **The manual "protect this player" control** is still reserved and unsupplied.
* **The schedule rule is, in practice, a rookie-league rule.** In every full-season league the age
  bands already say what "behind" would (a man 1.5 years over a Single-A average is 23 or 24, whose
  age already reads `some`), so on the real import the rule binds only in the Dominican and complex
  leagues: 358 players, 307 of them 20-to-22-year-olds in the Dominican league with no visible
  major-league ceiling going from ordinary to organizational depth, one regular's ceiling touched
  (Part 9).
* **Pre-fork surfaces** still show OOTP's Overall and Potential (D-017's remaining gap), so a player
  card can show a 70 potential beside a "regular's ceiling" read from the composite. They are
  different numbers by design, and the reasons name the composite.

## Part 8 — Next

1. The owner's call on the *fringe × most* line (§6.4), with `npm run stakes:report` to see its effect.
2. Repeat-level and professional-experience context in the **assignment review**, where it belongs.
3. Route scouting snapshots through the adapter's composite (ROADMAP §3); only then can trajectory be
   considered as evidence, and only once a save has accumulated more than one snapshot.
4. Player Development's own prospect reasons ("young for level") still read `computeProspects`' league
   baselines, with their own population minimum (60); the farm no longer does. One reader for that
   too, when Player Development's pages are next touched.

---

## Part 9 — The hardening pass

Run after the rebuild, on the same branch, assuming the model wrong until testing proved otherwise.
Most assumptions survived; what did not is here. Compared against `main` and against the rebuild as
first delivered ("initial"), on the same import.

### 9.1 Authority

One authoritative calculation, proven rather than asserted:

| Caller | Source of the tier | Can it recompute it? | Can it reinterpret it? |
|---|---|---|---|
| `farmOperations` (assemble) | `FarmSession.stakes().protect()` | No | No: `hasDevelopmentalStakes`, `PROTECTED_TIERS`, `isPriority` read it |
| `farmConsequence` (a newcomer) | the same session reader | No | No |
| `scoutedDevelopment` | `openDevelopmentalContext().protect()` | No | No: served to the pages |
| `org.mlbAssignmentAssessments` | `openDevelopmentalContext().protect()`, handed to `mlbAssignmentContext` as `protection` | **No longer** (it took `age`, `ability` and an optional context before, and could have been handed no context) | No: `STAKES_WEIGHT` reads it |
| `farmAssignments`, `farmRetention`, `farmOrganization`, `farmAffiliate`, `playingTime`, `currentAssignment` | the assembled player's `protection` | No | No |
| `prospectDecision`, `prospectAssignments`, `destinationFit`, `farmCascade`, philosophy | — | do not read it | — |

`evaluateDevelopmentProtection` is now called from `developmentalContext.ts` only (and from the model's
own file); the boundary test says so. The farm's `ageRelativeToLevel` (D-044, the assignment review's
"old for level") came from `computeProspects`' league baselines — the same population, but a second
implementation with no thin-league fallback; it now comes from the stakes reader.

### 9.2 Bugs found and fixed

* **H-1 — one club, one man, two answers about the same work.** `playingTime.ts` defined "short of
  developmental work" three times: the rotation and the bullpen said `{not_used, occasional}`; the
  position conflict alone added `part_time` and `bat_only`. So a sharing prospect was `squeezed`
  (critical at the affiliate) while his own review, from the same read, said sharing is ordinary; a
  designated hitter was "not getting developmental work" at a position while the review said his bat
  was getting its work. Now one line, `shortOfWork` = `{not_used, occasional}`, used by all three jobs
  and — through `shortOfWorkVerdict` — by the review; a test proves the verdict table and the line
  agree for every level of work. League-wide: `squeezed` 125 → 26, `blocking` conflicts 115 → 24,
  conflicts 500 → 415, raised developmental findings 349 → 270, with **every one of the 6,411 reviews'
  conclusions and attention levels unchanged**, which is the proof the affiliate view was the one out of
  step. Arizona: Amarillo's critical RF finding (Nathan Hall, part time) is gone; Visalia's SS reads
  "3 men have a claim" (`noted`) instead of a historical shortage; ten new golden cases
  (`farmJobSharing`).
* **H-2 — an unknown age would have been a firm tier.** Every farm caller passed `Number(row.age)`;
  `Number(null)` is 0, and 0 read as "most of his development ahead of him". No age is null on this
  import; the contract said unknown stays unknown. `knownAge()` treats anything that is not a finite
  positive number as unknown, the reader and evaluator take `number | null`, and the callers pass the
  age as the export has it. Pinned against real SQL with a null age.
* **H-3 — a departure said nothing about the man left sharing his job.** `farmConsequenceFor`'s
  "whose playing time changes" read the affiliate's *contested* conflicts, so a departure from a job
  two men shared (no conflict) named nobody; it had named the sharer only while H-1 wrongly contested
  the job. It now reads the departed man's job through `jobRead` as the arrival answer does (B-1's
  fix). On Arizona 17 of 54 departures now name a sharer (a Reno reliever's departure names the
  part-time arms behind him); the cascade's physical chain is identical in all 54.

### 9.3 Suspected and rejected

* **A birthday causing a two-step drop.** Swept over every potential, gap, kind, and rostered average
  from 17 to 29 in tenths, ages 16 to 35: never up, never more than one step. The schedule reading and
  the age band move together, and each moves at most one step a year.
* **One tool grade causing a large jump.** One potential point moves the tier at most one step at
  every point of the 20-80 scale; the pitcher lines are lower than the hitter lines by construction.
  Coarse evidence, not a threshold bug.
* **Floating point at the schedule lines.** Averages that should be exactly *x*.5 are exact in IEEE
  arithmetic for any roster size; 1.49 / 1.50 / 2.99 / 3.00 land where declared; a NaN or infinite
  relative age reads `not_established`.
* **Roster churn re-tiering a man.** A league aging by a hundredth at a time moves nobody more than one
  step per hundredth, and only across one of the two lines.
* **The DSL two-step.** A 22-year-old in the Dominican league is 3.7 years behind its average and
  reads `little` from `most`: two players league-wide, both with fringe ceilings, both organizational
  depth. Bounded by an invariant (the schedule takes at most two steps and only from a man whose age
  still has them) and left as policy.
* **Philosophy leaking through a helper.** The opposite-philosophy end-to-end test now also compares
  MLB Operations' candidate stakes and the retention outlook and guardrails: identical.
* **Production leaking through the service.** The whole organization's season lines made monstrous,
  then empty, then deleted: every protection in the farm's and Player Development's payloads identical.

### 9.4 Cross-organization outliers (30 organizations)

| | Organization | core+protected | priority or better | depth | mean age |
|---|---|---|---|---|---|
| highest core/protected share | St. Louis | 9.5% | 29.1% | 30.2% | 21.9 |
| lowest | San Diego | 1.8% | 13.6% | 35.9% | 21.7 |
| highest depth share | Seattle | 6.8% | 19.8% | 44.1% | 22.7 |
| lowest depth share, youngest | Milwaukee | 8.4% | 25.7% | 23.5% | 20.8 |
| oldest | Athletics | 6.5% | 19.9% | 41.4% | 22.8 |
| complex-heavy (54%) | Arizona | 3.5% | 23.5% | 33.0% | 21.5 |

No organization is all one thing; the thirteen clubs where one tier is 80% or more are all Dominican
or complex clubs where "ordinary" is the truthful reading of thirty teenagers with no visible ceiling.
Depth share rises with mean age and upper-minors weight, as it should. Triple-A holds 13 of the 24 core
prospects; the complex leagues the fewest. No league-age pathology: the schedule binds only in the
three rookie leagues (Part 7).

### 9.5 Explanation

Every reading now ends with how the two readings made the tier ("Developmental stakes: ordinary. That
ceiling alone would set protected prospect; it is lowered two steps for the development that has run
out."), so a tier under the ceiling's own is never a mystery. `normal` is written "ordinary" everywhere
a reader sees it (`tierWord`), as the UI already had it; retention, congestion and affiliate findings
use the same word.

### 9.6 Tests

`farmJobSharing` (12: the one line, and ten golden sharing cases), `developmentalStakesHardening` (20:
the age, ceiling and schedule sweeps; unknown followed into playing time, MLB Operations and
retention), `developmentalContext` (+6, a null age against real SQL), `farmArrivalHolders` (+1, a
departure from an uncontested job), `farmDevelopmentIndeterminate` (+1 production independence; the
philosophy case extended to MLB and retention), boundary guards (+1: the farm's one age reader; no
`Number(` age at a call site), golden (+1, the composition sentence), `farmGoldenPlayingTime` (+1, a
designated hitter is no club-level shortage). `developmentProtection` loses the dead API's sixteen
cases. 143 files / 1,868 tests (the rebuild delivered 141 / 1,842).

### 9.7 Performance

Unchanged within noise (medians of three runs, hardened against the rebuild): farm whole view 1,097
against 1,091 ms; MLB contextual 935 against 931; MLB responses 3,772 against 3,743; ten consequences
1,157 against 1,136 (one more `jobRead` per departure).

### 9.8 A note on `data/league.db`

Its modification time moved once during the pass, at the close of the first read-only capture. No
read path writes to it (every stage of the capture, the 30-organization sweep and the cascades were
re-run with the WAL watched: zero frames), and it is Pennant's import, not an OOTP save. The one move is
consistent with SQLite checkpointing frames a previous, killed process had left in `league.db-wal`; the
history database and the import metadata did not move.
