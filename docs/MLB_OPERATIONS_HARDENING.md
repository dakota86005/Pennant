# MLB Operations hardening: audit, findings and behavioral tests

Status: hardening, refinement and UX phase (branch `feature/mlb-operations-v2`, after the scouting-department layer, D-031 to D-038).
This is the record of the audit that opened the phase and of what testing found. It is the durable companion to
[MLB_OPERATIONS.md](MLB_OPERATIONS.md) (what the subsystem is), [ROSTER_REVIEW.md](ROSTER_REVIEW.md) (how the review reads a roster),
[CALIBRATION.md](CALIBRATION.md) (how the constants were tuned) and [BEHAVIOR_CASES.md](BEHAVIOR_CASES.md) (the regression corpus).

Nothing in this phase asked the owner to run an OOTP experiment or touched a save. Every check ran against the read-only Arizona
import, historical statistics, synthetic fixtures and the production functions. Where OOTP semantics cannot be established from
existing evidence, Player Rights returns `indeterminate` and this subsystem carries it forward unchanged.

## 1. The pipeline, and what each stage assumes

```
organization-visible evidence            Player State (export) · chronology · scouted ratings (D-017) · statistics
  → tools / results evaluation           toolsModel · resultsMetrics · resultsEvidence
  → role review                          roleReview + roleStandards (two lenses, working estimate, finding against the role)
  → lineup / bench / pitching review     lineupPicture · benchReview · bullpenRoles · platoon · lineupShifts
  → need detection                       mlbNeeds (state) · mlbReview (review-raised needs) · mlbExplain (why, as data)
  → candidate generation                 mlbResponses
  → Player Development                   asked per contemplated context (D-025)
  → Player Rights                        per action, with basis (D-023)
  → consequences                         roster counts, vacated role, farm effect
  → philosophy / competitive shading     staffPreference (after validity only, D-036)
  → plans / recommendations              mlbPlans · mlbReport
  → UI                                   src/pages/MlbOperations.tsx and src/pages/mlb/
```

| Stage | What it assumes | Where it could fail baseball sense, and what testing showed |
|---|---|---|
| Evidence | Ratings only through `scoutedEvidence.ts`; statistics are facts; unknown stays unknown. | Peer populations were polluted by amateur signings (F-0). A missing glove dropped out of the estimate silently (F-7). |
| Tools model | Five hitting tools act linearly on expected wOBA with the calibrated slopes; strikeout avoidance adds nothing. | **Held up.** Corner residuals are within about two standard errors and interactions add 0.005 R² (harness 3c). |
| Results | League-relative, park-adjusted, recency-weighted, shrunk by sample. | **Held up.** A hot week over a long record moves the level a handful of points; a full season moves it about twice as far per point (`resultsStress.test.ts`). |
| Role review | A percentile working estimate; a concern is an estimate under 35 or the weakest of a group. | Position-blind and group-relative (F-1 to F-3). Rebuilt around the role. |
| Lineup | The regular is who played at least 40% of the innings at the position. | A man could be the regular at two positions; a platoon partner sat unnamed on the bench (F-6). |
| Bench | A bench player covers a position when his visible grade clears the playable line. | One line for "can stand there" and "is a backup" (F-5). |
| Bullpen | A tier is read from leverage and innings per appearance; a deployment finding is a better arm in a lower tier. | Only pairs were compared; nothing said what the pen as a whole lacked (F-9). |
| Platoon | League norm for his hand, plus his ratings' departure, plus a hard-shrunk record. | On the league norm alone it said "no issue" (F-4). |
| Need detection | State needs are floors; review needs are strong or moderate findings. | Base rate below. |
| Candidates | Player Development decides defensible; Player Rights decides allowed; both are asked, never rebuilt. | **Held up** (`mlbGoldenAvailability.test.ts`). |
| Shading | Philosophy and season shade order, wording and the act bar, after validity. | **Held up** under adversarial tests across five clubs (`mlbGoldenContext.test.ts`). |
| Plans | Each plan is one baseball move with its consequences. | A shift was offered that did no better than starting a bench player (F-8). |

## 2. Base rate: does a healthy club get flagged?

The production review was run on all 30 MLB clubs of the Arizona import (2026-05-16, about 43 games), read-only: the "could a
healthy roster be flagged" test. The first answer was yes.

| Per club, 30 clubs | Before | After |
|---|---|---|
| Review-raised needs (strong or moderate) | 2.2 (0.83 lineup, 0.53 starter, 0.87 reliever) | 0.7 (0.50 lineup, 0.07 starter, 0.13 reliever) |
| Clubs with a lineup regular flagged | 25 of 30 | 13 of 30 |
| Bench positions "gapped" | 12 of 30 clubs (binary) | 1 catcher, 5 middle infield, 15 center field: 10 hard gaps raised, the rest findings (see F-5) |

The causes (all reproducible with `npx tsx scripts/calibrate.ts standards`):

* A hitter's estimate is a percentile among all MLB hitters. Regulars at first base and DH have median estimates 77 and 73; at
  second base, third base and center field 49 to 51; catcher and shortstop 57. The same estimate is a hole at first base and an
  ordinary shortstop.
* "The weakest of his group by 8 or more" fires for almost any group of nine: the weakest of nine is usually 8 under the median.
* The absolute line (35) is about the median fifth starter (36) and the median seventh reliever (35).
* Before any of that, the peer population itself was 12% amateurs (F-0), which inflated every percentile.

Not changed, and why: 20 of 30 clubs have an **IL-return decision** in the inbox. That is baseball, not noise (a full 26-man
with someone due back within two weeks needs a decision), and it is one row on the Overview; the 15-day window is a stated
policy constant (`IL_RETURN_WINDOW_DAYS`).

## 3. Findings log

Classification: **BUG** fixed now; **SYSTEMATIC** a model failure, refined; **DEBATABLE** a baseball judgment, documented and left as
policy until evidence accumulates.

| # | Finding | Class | Resolution |
|---|---|---|---|
| F-0 | The tools and glove peer populations included about 60 amateur signings (all-20 tools) per league: 12% of "MLB hitters". Every hitter's tools percentile was inflated, the spread of expected wOBA read 41 points (real: 18), the mean was pulled down, and the glove peers at each position included the same players. | **BUG** | D-039. Peers are players whose own league is the major league. `tests/mlbPopulation.test.ts` fails without the filter. |
| F-1 | A hitter's concern ignored the position: one estimate scale, one absolute line, a group-relative rule across nine different jobs. | SYSTEMATIC | D-040. Concern is measured against the role's standard, shown with the finding. |
| F-2 | Starters and relievers were flagged for being the weakest of their group; long men and fifth starters were flagged for being what they are. | SYSTEMATIC | D-040. Floors by rotation spot and by bullpen tier. |
| F-3 | "The weakest of the group" as a trigger (always finds someone). | SYSTEMATIC | Context only; a finding no longer changes when another player joins the group (invariant tested). |
| F-4 | Platoon read on the league norm alone reported "no issue": an unknown presented as a neutral. | **BUG** | Verdict is "not enough" unless his own ratings or record speak. |
| F-5 | The bench treated "can stand at the position" and "is a backup there" as one thing, knew only positions, and had no notion of what else a bench is for. Once quality was added, a first threshold (bottom fifth) called 19 of 30 benches emergency-only at center field. | SYSTEMATIC | D-042. Cover quality against the peers who play the position (threshold moved to the bottom tenth after measuring), functions instead of a score, only hard gaps raised. |
| F-6 | A man could be the regular at two positions (42% of second base and 40% of shortstop); a platoon partner appeared only as bench. | **BUG** | One man, one spot; a partner is named where two share. |
| F-7 | An unseen glove made a strong bat look like a clear upgrade at a position that is 40% glove. | SYSTEMATIC | The comparison is "not firm" and says why (`GLOVE_MATTERS`). |
| F-8 | A position shift was offered beside a plain bench replacement that did as well (same fix, a second position disturbed). | SYSTEMATIC | A shift must beat the direct change by `SHIFT_MIN_EDGE`. |
| F-9 | The bullpen was compared pair by pair; nothing said what the pen lacked (no credible high-leverage arm, nobody who throws length, a crowded role) or that the rotation and the pen compete for an arm. | SYSTEMATIC (missing) | Pen-wide findings, each with what it is doing now, what the evidence supports, and why it matters. |
| F-10 | The reason a flag existed had to be rebuilt from prose. | SYSTEMATIC | `mlbExplain.ts`: why, parts, neutral urgency, what context changed and never changes, what would change it, what is unknown. |

**Debatable, documented, not changed:**

* The policy quantiles (a tenth for "unusually weak", a twentieth for "well below") and the near-uniform 10% they imply. The count of
  flags follows from the quantile by construction; the quantile is a decision, not a fact (D-041).
* The typical levels behind the role floors come from one snapshot (43 games) of one league. They are provisional and will drift with
  the season; they are re-derived by `standards`, not tuned by hand.
* The 15-day IL-return window; center-field thinness on the bench (half the league); whether "second base or shortstop" should be
  two required covers (the function text now says when shortstop itself is only an emergency cover).
* All-thin-tool hitters are under-predicted by about 8 wOBA points by the linear model (harness 3c). This is survivorship: hitters
  with poor tools reach 500 plate appearances only by hitting. No correction.
* Rest-of-season baserunning and defense weights are still provisional (one partial season of zone ratings); not re-derived on
  a few more games.

## 4. UI audit of the previous single page

`src/pages/MlbOperations.tsx` rendered, in one scroll, in this order: four roster cards; a freshness note; unknowns; the context
banner; **the whole scouting review** (starters table, relievers table with deployment notes, the full lineup table with nine
columns, the bench table); then a two-column layout with the issues list and a what-if select on the left and the workspace of the
selected need on the right: need header, why-Pennant-says-this, unknowns, the assignment context tabs, the report (the banner
again, the recommendation, the situation, the staff read, the role picture, the plans, the pathways), every candidate group as a
table with an expandable detail row, and every way to clear a roster spot.

| Element | Class | Problem |
|---|---|---|
| Roster cards, freshness, unknowns | context/status | Fine, but they scrolled away above a full review. |
| Context banner (rendered twice: page and each report) | context/status | Duplicated; the second copy competed with the recommendation. |
| Issues list | primary attention | Sat BELOW the whole scouting book: the inbox was the last thing on the page. |
| Starters and relievers tables | roster-review | Belong to a pitching workspace; shown on landing. |
| Lineup table (nine columns), bench table | roster-review | The densest content on the page, shown before any conclusion, overflowing at 800 px. |
| Need workspace | decision workspace | Correct content, wrong place: under the entire review. |
| Assignment-context tabs | decision workspace | Fine inside the need. |
| Recommendation, situation, staff read | decision workspace | The recommendation came before the problem was stated; the situation after it. |
| Role picture, plans, pathways | decision workspace | Plans and pathways repeat each other for some needs. |
| Candidate tables and details | evidence/detail | Correct as drill-down; shown expanded by default. |
| Clearing tables | evidence/detail | Useful, long; belongs behind the recommended plan. |

The reader lost the question: the page opened with data, then analysis, then candidates, and the one list that says what needs
attention was under all of it.

## 5. Model refinements (summary)

* **Tools model:** unchanged (it held up); now shows what each tool contributes and a plain-words bat profile (`toolContributions`,
  `describeBat`), so a contact-first and a power-first bat with the same total are told apart. Population fixed (F-0).
* **Results model:** unchanged (it held up under stress). The park share, defensive stabilization and steal values stay provisional.
* **Defense, baserunning:** unchanged weights. An unseen glove is now stated in the comparison (F-7); running stays 5% and visible.
* **Platoon:** no issue on the league norm alone (F-4); `drivers` says what the difference is made of (league, ratings, record) and
  they add to it.
* **Lineup:** one man one spot, partners named (F-6); concern against the role's standard (F-1); the standard is shown with him.
* **Bullpen:** floors by tier (F-2); pen-wide findings, each with now / evidence / why (F-9); rotation-versus-pen conflict on tools alone.
* **Bench:** cover quality, functions, tags, hands; only hard gaps are inbox items (F-5).
* **Needs and plans:** shifts must beat the direct change (F-8); every review need carries `explanation` (F-10).

## 6. Plans

The vocabulary (send_down, move_to_bullpen, designate, open_spot, lineup_change, shift, platoon) stayed expressive for every case
tested. No plan type was added. Two checks are now permanent: no two plans in a packet are the same move, and a second move must
earn its keep against the plain one.

## 7. Philosophy and season shading

Adversarial tests across five clubs (none, contending, building, win-now-but-out-of-it, balanced) show that shading changes only
order, wording and urgency: candidates' groups, availability, development findings, rights paths, comparisons and consequences are
identical; no candidate is added or removed; a blocked option stays blocked; with the rights evidence missing no club is ever told to
act; the estimate, finding and strength are identical; the neutral stance is always recoverable; every lean names its dimension. No
defect was found; the tests are the regression protection.

## 8. Information architecture

One navigation entry, five views, addressable by URL hash (`#/mlb`, `#/mlb/players`, `#/mlb/pitching`, `#/mlb/bench`,
`#/mlb/decision/<need id>`; opening such a link opens the module):

| View | Owns | Deliberately not on it |
|---|---|---|
| **Overview** | "What needs my attention?": one line on how the club is read, roster status, needs grouped Roster / strongest scouting cases / also worth a look, three summary cards, the what-if. | Any player table, candidate, or roster mechanic. |
| **Position players** | The lineup against the standard for each job: estimate with role typical, bat, glove, running, platoon, read; a row opens to the bat's profile, glove and running detail, platoon drivers, the partner. | Pitchers, bench. |
| **Pitching staff** | Rotation and bullpen; role from usage; deployment and pen-wide findings each as now / evidence / why. | Lineup analysis. |
| **Bench and coverage** | The functions (cover, bat, glove, runner, flexibility) as covered / thin / nobody, with who; the bench. | A bench score. |
| **Decision** | One need: the problem; why it was flagged and on what evidence; the staff's recommendation with what philosophy did and did not change; the ways to respond followed through; then the candidates and every way to clear a spot, both collapsed. | The scouting book. |

The path is attention → issue → evidence → alternatives → consequences → GM decision, and detail arrives only as the GM drills. The
old candidate tables, clearing tables and lens bars moved into the Decision view unchanged; nothing was deleted. A view that fails
to draw says so in place and leaves the tabs and the rest of the app standing.

Inspected at 800, 1200 and 1500 px: no page-level horizontal overflow at any width; at 800 px every review table fits without
scrolling and, with every drill-down open, so do the candidate tables; the decision layout is two columns from 1100 px and one below.
