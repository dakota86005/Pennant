# Player Value

Design record for the Player Value subsystem: contracts, control, cost, expected production, the save's financial
reality and surplus value. Decision: [D-052](DECISIONS.md) (accepted; owner answers in Part 12). Research evidence:
[PLAYER_VALUE_RESEARCH.md](PLAYER_VALUE_RESEARCH.md) (R-1 to R-11).

**Status: phases 1 to 4b built (contract facts and control; Club Finances, the opening price of a win and the
per-import market snapshot; expected production in wins from major-league results and scouted ratings, fitted per save
under D-053; the cost of controlled seasons, measured on each import; the measured price of a win across imports; the
neutral contract surplus and the retention margin, phase 5a; the philosophy lens and the club's value of a win, phase 5b;
the player card's header and Contracts migrated, phase 6a; the Trade Center, phase 6b; Free Agents and the AI's value
context, phase 6c; Org Comparison, the Roster's scouting column and the Lineup, phase 6d; the cleanup, phase 6e;
Part 9).** `PROJECT_STATE.md` says what exists; this file says what is to be built and why. The consumer migration is
finished: no module reads the prohibited `players_value` fields (Part 8), and the evidence boundary holds no allow-list.

---

## 1. The GM problem

A general manager is always asking what a player is worth: to keep, to extend, to trade for, to sign, to let go.
In a real front office the answer is never a single number. It is several separate facts put side by side:

> What does he cost, for how long, and under what control? What will he produce, and how sure are we? What is a
> win worth on this league's market, and what is one more win worth to *this* club this year? And what is left
> when the cost is taken from the production?

Pennant answers each of those as a stated estimate with its basis and its band, and puts them side by side. The
application decides nothing with them (D-001, D-004). Value **describes and never authorizes**: it is not a trade
verdict, a release verdict, a ranking or a recommendation, and nothing is ranked by a hidden single score.

What Pennant has today is the opposite. `valuation.ts`, `contracts.ts`, `trade.ts`, `freeagents.ts`,
`franchise.ts`, the player card and the AI trade context all rest on OOTP's `overall_value` / `talent_value` / `oa`
/ `pot`. D-017 prohibits them as evidence, and no one can tell which organization's view they are (ROADMAP §3). The
contract advice cuts a percentile of those figures at 70 and 75. The trade desk sums them. A missing arbitration
rule becomes 3 years and a missing free-agency rule 6 (R-10). Nothing measures a price of a win, a cost path or a
surplus.

---

## Part 1 — Purpose and boundaries

### 1.1 What Player Value owns

One specialist with five separate concerns (Part 2). Each has its own output and its own unknowns, and none reaches
into another's answer except through its output:

| # | Concern | The question it answers |
|---|---|---|
| 1 | Contract facts | What does the contract say, season by season? |
| 2 | Control and cost path | For each future season, under what control is he, and what will he cost (a band)? |
| 3 | Expected production | How many wins will he produce each season, as a band that widens with the horizon and with thinner evidence? |
| 4 | Club Finances | What is this league's financial reality (regime, price of a win, replacement level), and this club's (budget, payroll, revenue, market, cash, owner expectation, what one more win is worth now)? |
| 5 | Surplus | Production value less cost, season by season, discounted, as a band with every component shown |

### 1.2 What it never decides

- **No transaction and no verdict.** Value never says trade, release, extend, sign, promote or demote. The Trade
  Center, Contracts and Free Agents *show* value. Any advice they give sits in the consumer, is labelled as advice,
  and names the value components it reads (D-034's pattern: a stated rubric, never a score).
- **No scouting judgment.** Ability comes only from `scoutedEvidence.ts` (D-017). Value never reads a rating column,
  never reads `players_value` and never falls back to it.
- **No development judgment.** Whether an assignment is defensible is Player Development's (D-003, D-019, D-025).
  Value does not read defensibility, and Player Development never reads value.
- **No developmental stakes.** The protection tier is not trade value (D-050). Value does not read the tier, and the
  tier does not read value (`tests/developmentalStakesBoundary.test.ts` already forbids the second).
- **No roster right.** Option, recall, 40-man, DFA, outright and IL rights come only from `playerRights.ts` (D-023).
  Value states a consequence *through* a right (a man out of options costs a 40-man spot to keep) and never
  rebuilds one.
- **No philosophy in a fact.** Neutral value is computed without philosophy. The lens (Part 6) is applied afterwards
  and is always shown beside the neutral figure.
- **No sunk cost as a reason.** Money already paid, and money owed whatever the club does, never argues for keeping
  a player (Part 5).

### 1.3 Where it sits

```text
 objective save facts            Scouted Evidence          Player State · Player Rights
 (contracts, service, stats,     (scoutedEvidence.ts)      (playerState.ts · playerRights.ts)
  finances, standings)                  │                               │
          │                             ▼                               │
          └──────────────►  PLAYER VALUE (neutral)  ◄───────────────────┘
                       contract facts · control & cost path · expected production
                       · club finances · surplus         (reads no philosophy, no tier,
                                    │                      no defensibility)
                                    ▼
                    Organizational Philosophy — the lens, after, always shown
                                    │
                                    ▼
        consumers: Contracts · Payroll · Trade Center · Free Agents · Org Comparison
                   · player card · AI context       (MLB and Minor League Operations may display it)
                                    │
                                    ▼
                               the GM decides
```

Value is a sibling specialist of Player Rights and Player Development. Both operations modules may *display* a
player's value (an arrival's cost, a departure's savings), and neither may use it to make a move defensible,
legal or preferred. Philosophy has one place to act on value: the lens.

**The contract-control timeline is split (owner, Q-1).** Arbitration and free-agency *eligibility* are rights
driven by service time, and D-023 gives rights one home: `playerRights.ts` gains them in phase 1, in its own
three-valued vocabulary (`eligible` / `ineligible` / `indeterminate`, with a basis for each), beside the roster
rights it already evaluates. Player Value reads those statuses and never re-derives them. It owns only the **cost
band** attached to each status and the season-by-season timeline it composes from them.

---

## Part 2 — The five concerns and their unknowns

Every output field is `Sourced` (value + source column or derivation + reason when unknown), the pattern of
`leagueRules.ts` and `provenance.ts`. An unknown is never a default (D-018).

### 2.1 Contract facts

**Reads:** `players_contract` (`salary0..14`, `years`, `current_year`, `season_year`, `is_major`, option flags,
`opt_out`, bonus and incentive columns, `contract_team_id`), `players_contract_extension`.

**Output:** season-by-season guaranteed salary; options (team, player, vesting) and in which season; opt-outs;
incentives as stated; the club carrying the money; the extension that follows.

**Unknowns on this save (R-6):** no-trade clauses, buyouts and retained salary are unpopulated in a historical start.
They are `unknown`, not "none". A minor-league contract's $0 salary is `unknown`, not a cost of zero. The club
carrying the money (`contract_team_id` against `team_id`) is not verified against payroll.

**Read, not established (hardening F2, 2026-09-23).** The vesting-option flag is zero on every contract, so the
last season of a deal says whether it is a vesting option is not exported, rather than reading as a plain
guaranteed season. A club and a player flag on the same season is a **mutual option**. **Opt-outs:** `opt_out`
is a count; the first season he may walk away from is read as the term's first season plus the count
(`optOutFrom`, after contract year N). The reading matches the real deals it could be checked against (a 2025 deal
with 5, a 2024 deal with 7 and 6) but stays a reading (R-6); an opt-out whose reading has passed or lies past the
seasons the deal covers is named and changes no season. **The blank row:** a row with no term (`years` 0 or no
first season) and `is_major` 0, no salary and no paying club is the row the export writes for 6,894 held players
it carries no terms for (every minor leaguer without a written deal, unassigned amateurs, and 24 major leaguers on
the 60-day injured list). Its `is_major` 0 is the blank's, not a minor-league contract: the row has no kind. The
24 carry major-league service and are placed on a major-league club's 60-day list, which only a 40-man player
reaches; the export does not say why their row is blank (their deals may have lapsed on the list), so nothing is
invented for them: this season is held at an unknown cost, and later seasons read his Player Rights standing.

### 2.2 Control and cost path

**Reads:** contract facts; the pre-arbitration, arbitration and free-agency eligibility statuses from Player Rights
(Q-1; Player Rights reads service time from Player State and applies the league's rules); the league's rules from **one** `LeagueRules` (Part 9, phase 1), resolved through `parent_league_id` for a minor
leaguer (R-2); the season clock (the most-tenured major leaguer's days this year, as `serviceRemainingThisSeason`
reads it today).

**Output, for each future season until control ends:** a status: `under_contract`, `club_option`, `player_option`,
`pre_arbitration`, `arbitration(n)`, `free_agent` (control ends), `reserve_clause` or `indeterminate`. Each status
comes with a **cost band** and its basis:

| Status | Cost |
|---|---|
| Under contract | The contract's salary (a point) |
| Option (club, player, vesting, mutual) | Both branches shown: exercised (the salary) and declined (the buyout, which is `unknown` here, and the status he falls to). Only a future season: the season under way had its option decided before it began, so it is under contract at its salary |
| Opt-out (`opt_out`) | Every season from the one the exported count reads: both branches, staying (the salary) or opting out (his Player Rights standing), with the reading named |
| After a blank contract row | For a player the export places on a major-league club with major-league service: his Player Rights standing, the blank row named; a free-agency answer is `indeterminate` between under contract and free agent, since a deal the export does not carry could still hold him. Otherwise `indeterminate` |
| Pre-arbitration renewal | From the league minimum up to the save's observed renewal spread, measured on this import, its central the median renewal (a band, never assumed to be the minimum; phase 4a) |
| Arbitration year *n* | A band from the save's arbitration ladder at the platform seasons' production (Part 4.4; phase 4a), with its central; never assumed to be the league minimum (it reaches it only where the save paid the class the minimum at such a platform, said); a range of trips covers each class, and the class his service puts him in. Never below his previous season's salary where it is known (owner-attested, 2026-09-24; Player Rights' `arbitrationSalaryFloor`), what he costs if tendered; a point only where that salary lies above every reading of the ladder, said |
| Indeterminate | Across each status it lies between (a Super Two season: from the renewal's minimum to the arbitration band's high edge), each status's central named and none chosen; a season that may be free agency is what he costs if held, said; unknown where a status it could be is not priced |
| Free agent | Control ends. What he is worth to others is market data, not cost to this club |
| Reserve clause | From the league minimum to the save's own reserve-clause renewal pay, measured from the renewals observed across imports once 30 are seen (phase 4b, 4.4); unknown until then, saying how many were seen |

**Service projection** is itself a band. The low edge assumes he is optioned or outrighted from now on; the high edge
assumes he stays on the major-league roster for the rest of the season, capped by what the schedule has left (none
once its last game is played). The major-league injured list accrues service (every player on it has banked the
season's clock on the imported save) and a player on it cannot be optioned (observed), so his low edge adds the days
left on his stint (`injury_dl_left`), never "nothing because he is hurt". Each later season adds what the league's
schedule banks, read from the export's `games` dates (the calendar from the first scheduled game to the last, never
more than the service year): a 162-game schedule spans 187 days and banks a full year, a 60-game one about 69. Where
the export carries no schedule, a later season is a full service year and the basis says it is the convention, not a
reading. When the free-agency or arbitration line falls inside that band, the season's status is `indeterminate`,
and the dates on either side are stated. **Arbitration trips count winters**, not service classes: this season's
trip is a floor from his service class, and one higher where a year reached early as a Super Two (which the export
cannot show) is possible; each later arbitration season is one more trip than the one before, a range where the
projection leaves a winter open. A Super Two's next arbitration year is his second, and a player already in
arbitration is never numbered a trip he has taken.

**Unknowns:** a missing rule (FA years, arbitration years, service-year length) makes the dependent status
`indeterminate`. It never becomes 6 / 3 / 172 (R-10). **Super Two** is OOTP's rule under MLB rules (owner, 2026-09-22;
Part 12): a player with at least two but fewer than three years of service is arbitration-eligible if he banked at least 86 days in the season just ending and ranks in the top 22% (rounded to the nearest whole number) by total service of the class of players with two to three years and those 86 days (CBA Art. VI(E)(1)(b)); the cutoff therefore moves every winter (in the real world about 2.115 to 2.140 years.days). Player Rights computes the cutoff from the export's own class at the end of this season, once
per contract regime (`superTwoCutoffs`). Every member's service and his days this season are projections, so the
cutoff is a range of reasonable readings, from the men on a major-league roster now banking the rest of the season
to every member banking it. A reading in which nobody banks another day is excluded because the season is played
and its roster spots are filled; in May it would also leave nobody with 86 days and no class at all. A player above
the cutoff's high edge with his 86 days is arbitration-eligible (basis `owner_attested`). A player below its low
edge, or short of 86 days, is pre-arbitration. A player whose own range overlaps it is `indeterminate`, naming both
edges. **The cutoff's edges are readings, not bounds** (owner, 2026-09-23): the two readings
leave out single roster moves among the class, so within `SUPER_TWO_MARGIN_DAYS` (10, policy) of either edge the
year is `indeterminate`, a tie with the cutoff included; only beyond it is he definitely eligible or definitely
not. It applies only where the league's regime as read is MLB's: no export column names a rule set or Super Two,
so it is detected by free agency 6, arbitration 3 and a 172-day service year, and a schedule that banks the full
service year (a shorter one leaves the 86 days not established). Any other regime keeps the window
`indeterminate`, as does last winter's class (last season's days are not exported) and any later winter's (that
class does not exist yet). **`has_received_arbitration`** is 0 for every player on this save and carries no information
(R-3). It is not read until an import shows it set.

**The cost of controlled seasons (phase 4a, 2026-09-23).** The timeline is composed first and each season no contract
covers is then priced by the league's cost ladder (`playerValueCost.ts`), measured on each import from the market's
population (the league's major leaguers on its active and injured lists, as for the price of a win) and snapshotted with
the market. A **pre-arbitration renewal** costs from the league minimum to the 90% upper confidence bound of the 90th
percentile of the save's pre-arbitration one-year renewals (Player Rights' pre-arbitration answer this season); below
30 renewals, the provisional prior widened by the save's own renewals where the regime as read is MLB's, else unknown.
On the Arizona import: 249 renewals, 220 at the minimum, **$780K–$790K**, central $780K. An **arbitration** season is
Part 4.4's, never below the player's previous season's salary where it is known (owner-attested, 2026-09-24: this
season's contract salary for next season, the season before's low edge after that, so a held player's arbitration low
edges never fall; where it is not known the basis says the rule cannot bind; a non-tender stays possible and is said).
An option's or opt-out's declined branch is priced the same way; a branch the player decides (a player or
mutual option declined, an opt-out) is what he costs if held, said, never a certain cost. The status, the class and the
trip are Player Rights' (`standing`, `trip`, `tripIfEligible` for a season whose arbitration is open, `serviceClass`
for where the ladder reads a player of his service; `arbitrationRegimeOf` for the regime's classes and whether it is
MLB's); nothing here compares service with a threshold. A reading computed without production (the market's own
population, Free Agents' status list) prices no controlled season (phase 4a review), so no consumer serves a second,
different cost. **Consumers:** Payroll shows each controlled season's band beside the committed money, never in the committed total
or the headroom, with the sum of centrals beside it and the ladder's basis under the price of a win. Its club range
combines players as independent (owner, 2026-09-24; `combineProjectedCosts`, `COST_COMBINATION_POLICY`): around the sum
of centrals, each player's own distance from his central on each side is combined across players as the root of the sum
of squares, while what is not noise stays at its edges and is added (which status a season between statuses is, which
class a range of arbitration classes is, and whether he is held: a player who may leave adds nothing to the low side),
labelled "players combined as independent; not a calibrated interval"; the edge-to-edge sum (every player at his low
edge to every player at his high edge) is kept in the details, and no player's own band is narrowed; Contracts shows next season's band under the flags, and an option's declined branch; the card's cone shows each
season's cost, its central and an option's declined branch. "If held" is shown with the figure, and every surface calls
the band a range of reasonable readings, never "expected". Every figure is the timeline's, as served.

### 2.3 Expected production

**The unit is the win, in the export's WAR units** (R-4): wins above the replacement level the export's WAR itself
implies. That keeps Pennant's wins comparable with every WAR the GM sees in the game.

**Reads:** results through the calibrated results engine (`resultsMetrics.ts`, Marcel-style season weights),
anchored to the export's WAR; ability through `scoutedEvidence.ts` (current and potential); age and an aging curve;
the expected role and playing time, from usage and role (objective facts), never from a philosophy.

**Output:** wins per season over the control horizon, each as a band (low, central, high) with what it rests on:
how many seasons and plate appearances or innings, which ratings, what age did.

**The band only widens** (D-018):

- with the horizon: his **rate** band (what is not known about his rate, plus the drift of talent) is never narrower
  in a season further out. The **wins** band is rate × expected playing time with the playing-time uncertainty, and it
  follows expected playing time down as it fades (owner, 2026-09-23: "it makes sense that eventually they predictably
  become lower");
- with thinner results: fewer plate appearances or innings, or no major-league line;
- with thinner ratings: a partial `ScoutedAbility` widens the band, and none at all leaves the ability component
  `unknown`;
- **not by organization, until there is evidence (owner, Q-2).** Real front offices scout other clubs' players
  less well, but the export has one rating row per player and no per-viewer accuracy (R-9), so the asymmetry cannot
  be measured and no widening is applied for it. A player outside the organization is valued on exactly the same
  terms as the same evidence inside it. This is revisited if a later export exposes per-viewer scouting;
- for a prospect, whose low edge includes never producing a major-league win.

Nothing narrows a band except more evidence of the same kind. A missing input never becomes a midpoint.

**Calibration is possible here, unlike developmental stakes.** The export carries per-season WAR for every season
from 1871 (R-4), so projection error can be measured the way `scripts/calibrate.ts` measures the results engine
(D-037): predict season *t+1* from seasons up to *t*, band coverage included. Under D-053 that measurement is made on
each save's own history and stored per save; code holds only the method, the policy and a provisional prior.

**What phase 3a built** (`playerValueProduction.ts`, the projection; `playerValueProductionFit.ts`, the fit;
`playerValueHistory.ts`, the reader; `playerValueFitStore.ts`, the store; the entry point serves it as
`PlayerValuation.production`):

- **Results only.** A player's major-league lines (level 1, the overall split, summed over clubs) in a rolling
  window of three season-lengths ending today. The current partial season is in it at its own opportunities, so it
  counts in proportion to its playing time, and the part of the window it does not yet cover comes from the seasons
  before. In phase 3a no rating was read (phase 3b adds ratings, below). Minor-league WAR is not read (Q-9).
- **Rate:** WAR per opportunity, a plate appearance for a hitter and a batter faced for a pitcher (the opportunity
  the results engine already counts in, and one that does not depend on how a pitcher is used within an inning),
  recency-weighted and regressed toward the fitted mean of his kind (hitter, starter, reliever; a pitcher is a
  starter when he started at least half his games in the window) by his weighted sample.
- **Aging:** the fitted curve (hitters and pitchers apart) from his age at the window's end to his age in each
  season. `roleReview.ts`'s `AGING_CURVE` answers another question (wOBA and FIP) and is not reused.
- **Usage:** expected opportunities per season from observed usage and age (and, since phase 3b, his projected
  quality: see below), never from a philosophy, with its own band. A stated injury (`injury_is_injured`, `injury_left`, `injury_dl_left`, `injury_career_ending`) is a known
  fact (owner, 2026-09-23): its days out, placed on the season's calendar measured from the save (Opening Day, the last
  game and the off-season between), come off his expected playing time in each season they cover, so the central
  moves, and the band keeps the high edge of an earlier return while its low edge moves down. A duration the export
  does not establish (none stated, or a value it states for many injured players at once that their own state
  contradicts, `injury_left = 1000` on the Arizona import) moves no central and lowers the low edge to the rest of the
  season lost. A career-ending one moves every later central to nothing and puts producing nothing inside every band.
  A season lost to injury is never read as evidence of less future playing time (below).
- **Injury proneness** (owner-attested known fact, D-053): its effect on usage and aging is measured on the save's
  history and used only at two standard errors; it moves the central and never narrows a band, and an unknown
  proneness widens the band by the largest effect any band showed.
- **Each season** from this one through the horizon (seven seasons) is an 80% band and a 50% band inside it, with
  the basis: the seasons read and their weights, opportunities, the regression share, the age adjustment, the usage
  band, the proneness band and the fit in force. This season's band is what he has banked (a fact) plus the band for
  the rest of it. A two-way player's band is the sum of both sides, edge with edge; a side under 100 opportunities in
  the window is not projected and the basis says so. Production spans the whole horizon for every player, held or
  not; surplus (phase 5) meets it with the control timeline.
- **Unknown** stays unknown: in phase 3a, no major-league results in the window was `unknown` (phase 3b projects such
  a player from his ratings where the evidence supports it, below), never zero and never a league average; a missing
  age, WAR, season or share of the season played is `unknown` with its reason.

**The invariants as built, stated exactly.** The rate band (80% and 50%, WAR per 600 opportunities) is never
narrower in a season further out: it is carried forward. The wins band is each season's own, so a player whose
expected playing time declines may have a narrower wins band, never a narrower rate band. Removing a season of results, or reducing its opportunities, never narrows the band **on
the same expected playing time**, and never narrows the uncertainty about his rate at all. Playing time is itself
evidence of usage: a part-timer's wins are bounded by his playing time, so a projection that reads usage from the same
lines can have a narrower band in wins when the usage it reads is lower. The projection keeps the two readings
separate, and the usage band is never narrower relative to its central when usage evidence thins. A better visible
line never lowers the central or the high edge (phase 3b: since playing time now depends on quality, a better line
can also widen the band downward; see below). Nothing in the projection knows the club.

**What phase 3a left open, and what phase 3b did about it.** In phase 3a playing time did not depend on performance,
so a player projected below replacement kept his expected usage and, worse, a star lost playing time to the
population's attrition: on the Arizona import Corbin Carroll's expected plate appearances fell from 587 in 2027 to 363
in 2031, and the held-out central sat below what happened for the top tenth of projected rate by 0.20 wins at horizon 1
and 0.33–0.44 further out. Phase 3b made playing time conditional on quality (below). The fit on a historical save
describes the real history it imported until the save's own seasons replace it.

**What phase 3b built** (`playerValueRatings.ts`, the ratings projection, pure; `playerValueRatingsFit.ts`, the
ratings fit, pure; `playerValueHistory.ts` gains the usage-only minor-league reader; `scoutedEvidence.ts` gains the
bulk glove-at-position loader and the reader of the persisted rating snapshots; the entry point loads ability through
the adapter and hands it on as evidence):

- **Ability only through the adapter** (D-017). The reader loads each player's `ScoutedAbility`, a hitter's rating
  splits and running (D-035) and his revealed glove at his listed position (D-033), with his listed position and batting
  hand (objective facts), and builds `RatingsEvidence` from them; the pure modules import the adapter's types only. No
  rating column, no `players_value`, no minor-league WAR (Q-9), no Player Development defensibility, protection tier or
  prospect decision.
- **Ratings → rate,** WAR per 600 opportunities, for hitters, starters and relievers apart, fitted per save: weighted
  least squares on the save's major leaguers with scouted ratings and at least 200 opportunities in the projection
  window, the tools' slopes never negative (a better scouted line never lowers it). A hitter's bat is his rating splits
  weighted by how often his hand faces left-handers on the save (measured), else his overall tools; running and the
  glove at his position enter as their own terms, with an intercept by listed position. Forms of the mapping without the
  glove or the running, and a pitcher's without any one tool, are fitted beside it for a player who lacks one. It is a
  **same-time fit**: ratings observed now against rates observed around now. It describes what the ratings go with on
  this save; it is not a forecast.
- **Reliability, and the leakage the same-time fit shows.** On this save the major leaguers' window rates sit *closer*
  to what their ratings imply than their own season noise allows (the held-out 80% band covers 85% of hitters and 86%
  of relievers even with no true-rate uncertainty at all): a historical start set the ratings from the same seasons. A
  same-time fit therefore cannot say how reliable the ratings are as a forecast. Until the save's own rating snapshots
  can measure it (this season's snapshot against next season's rate, fitted automatically once 50 such seasons per kind
  exist), the ratings count for what the kind's mean counts in the results fit, its backtested K, and no more: what is
  not known about a player's true rate given his ratings is the kind's population variance (noise × 600 ÷ K).
- **Blending,** for a player with major-league results: his rate is regressed toward the ratings-implied rate instead of
  the kind's mean, with reliability weights results n ÷ (n + K) and ratings K ÷ (n + K), K never below the kind's own.
  The weights are in the basis (`blend`). As his sample grows his results dominate: a regular with three full seasons
  gives the ratings about 8% (Randy Arozarena's projection moves by about 0.05 wins a season against his results
  alone). The ratings' development path enters his aging in the same proportion.
- **Development toward potential,** for a young player: his expected ability moves from current toward scouted
  potential by age on the development path in force; after it, the aging curve's decline applies (its pre-peak gains
  are the development's, never counted twice). The band spans the path's range by interval arithmetic (low edge with the
  least development, high edge with the most), so it widens with the gap and with the horizon. **The path needs ratings
  at t against ratings at t + h, and this save holds one rating snapshot**, so it is the provisional prior, labelled
  "not yet calibrated on this save": the mean scouted gap by age in the Arizona import's cross-section (not a path;
  survivors only), with a range from no further development to twice its central share. The fit switches to the save's
  own path automatically once it holds 300 snapshot pairs a season apart (policy), and the post-import refit fires by
  itself when that happens.
- **Expected playing time for a player not in the majors** comes from the save's own history: how often players at his
  level and age reached the majors h seasons on, and how much they played when they did, measured from the minor-league
  usage lines (never their WAR) with the results fit's era and hold-out rule, by age bands of at least 60 player-seasons.
  Measured now, because stat lines are longitudinal; conditioning it on his ratings needs the snapshots and follows
  automatically (the chance by potential tier, used only at two standard errors). Where it cannot be measured (no minor
  history, a level with none, or no club), it is `unknown`: the ratings prior carries no arrivals.
- **A prospect's band** is the mixture of no major-league playing time and playing time × his rate, per season; its
  central is the expected wins; **its low edge always includes producing nothing.** The basis names the ratings and
  their provenance, the arrival evidence (level, age band, chance of any major-league time per season) and the
  development path's source.
- **Partial evidence widens, never narrows.** An unknown potential, glove, running or single current pitching tool: the
  central uses what is known (no development assumed for an unknown potential; the form of the mapping without the
  missing grade), and the band runs from the lowest to the highest the missing value could make it (the full mapping
  with the grade at the 20-80 scale's ends; the largest development the save shows at his age). Any complete evidence
  consistent with what is known lies inside it. Two missing current tools, or no ratings, leave the ability component
  `unknown`; for a thin record the band then widens by the largest development the save shows at his age.
- **Playing time conditional on quality** (supervisor, 2026-09-23; method `production-3b.1`). Expected playing time at
  each horizon is the chance of any major-league playing time (a logistic: attrition) × the playing time when he plays,
  each on his window usage, his projected quality (his regressed rate above replacement at that horizon, never below
  zero) and his age, fitted per save with coefficients on usage and quality never negative. The band's tails are set per
  quality tier (bottom tenth, middle, top tenth of projected rate) as well as per usage tier. A better player keeps more
  of his playing time; a replacement-level one loses it. Proneness moves the central only, never the playing time a band
  is built on.

**The invariants as built in phase 3b.** The rate band is never narrower further out (carried forward, for the ratings
path as for results). On the same expected playing time, thinner evidence never narrows a band: removing results widens
the rate band; removing ratings makes the ability component unknown (a prospect becomes `unknown`, a thin record falls
back to results with a rate band at least as wide); partial ratings widen by interval arithmetic. A better scouted line,
or a better visible line, never lowers the central; the low edge of the wins band may move down with a better visible
line, because a better player is expected to play more (uncertainty about playing time widens the band both ways). A
fading player's cone may still narrow. No widening by organization (Q-2): no input names his club.

**What the hardening changed (2026-09-23, method `production-3h.1`; CALIBRATION.md section 6.3).** Four reviewers
found the central biased low and growing with the horizon (the save's established cohort projected 10–66% below what
its own history gives the same cohort one to six seasons on), a gate that could not see it, and labels and a fit store
that could claim more than was measured. As built now:

- **The central is the expected wins, E[rate × playing time].** Talent drifts and the players who keep playing are the
  ones who stayed good, so the rate of the players who play at a horizon is fitted apart from the chance he plays (per
  kind and horizon, on his regressed rate now, his age and his window playing time, weighted by the opportunities
  played; its slope never negative). Expected wins are chance × playing time when he plays × that rate. On the held-out
  seasons the pooled bias is −0.03 to −0.05 wins at every horizon (it was up to +0.12, starters +0.26).
- **Playing time per scheduled game.** Every season is read at its own schedule (the standings' modal games per club,
  else the most any player played), every later season at this season's; a season is short against its neighbours'
  schedules, never today's. A 60-game league, a 2020-style short season and a schedule that changed length are read at
  their own lengths.
- **A physical ceiling.** No playing-time high edge exceeds the most opportunities per scheduled game any player of
  the kind played in the save's window (hitters 4.77 PA, starters 6.31 BF, relievers 3.88 BF on the Arizona import)
  times the season's schedule, and no wins high edge exceeds that ceiling at the high edge of his rate. A measurement
  per save, never a constant.
- **Seasons before the league existed are unknown, not zero,** and **a season lost to injury is never read as
  evidence of less playing time** (owner, 2026-09-23): with an injury stated this season, a season in the window under a
  quarter of his best is not read as evidence (policy). The central reads his playing time at the pace of the seasons
  that are evidence; the band reaches the reading with the lost or missing seasons as observed; the basis says which.
- **The band** is the mixture of no playing time (the attrition's chance) and the wins when he plays (the fitted
  distribution of his cell as multiples of the spread, 15 points), as quantiles, so a point mass at nothing is exact.
  Its shape is read from his usage lines alone, regressed toward the kind's mean, and moved to his central: on the same
  expected playing time thinner evidence only widens it, and a measured effect (proneness) moves it whole. Young players
  (25 and under) have their own cells and drift. The rest of this season is in-season: measured on this season's own
  games (how much playing time the players of its first half kept in its second, per kind, carried to the rest at the
  same rate of loss per game); where not measured (under 10 games per club each half), next season's attrition scaled
  to what is left, with keeping his pace inside the band.
- **A listed pitcher's batting is not a hitter's line** (the export's own position): never a side, never a hitter case.
  A field position with a pitching role is two-way.
- **The same-time ratings pull his rate only for what his results do not already carry** until the save measures
  them as a forecast (the ratings' weight applies to their pull too), and the development path enters with the same
  weight, so a better scouted line never lowers the central.
- **Under the fallback prior** the kind's mean is the league's own (its last three seasons, where they hold 2,000
  opportunities of the kind) and the spreads scale with the league's spread of player-season rates against the prior's
  source's, stamped derived; one missing column fails one side only; an independent top-level league's majors are its
  own top level.

**The invariants as built in the hardening.** The phase 3b invariants hold, restated where the mixture made them
precise: on the same expected playing time (the same usage lines), thinner results or ratings never narrow the rate
band or the wins band; a measured proneness effect moves the band without narrowing it; the wins band may still follow
his expected playing time down as it fades.

**What hardening F4 changed for prospects (2026-09-23, method `ratings-3h.1`; CALIBRATION.md section 6.4).**

- **The arrival chance is read for a player in his own condition** (C-01). The arrival cases no longer drop a player
  called up in his origin season from the later seasons: those cases are kept apart, and a player not yet called up at
  share f of his season is read as one of the players passed over for the whole season or one of those called up
  later in theirs, the latter in proportion to the season still to play. The export dates no past call-up, so a
  call-up is taken as equally likely at any point of the season's games (policy); the band reaches none and all of
  them still to come. The rest of this season is read the same way (of the season's call-ups, those still to come,
  among the players not yet called up). At the season's start the chance is every case's own rate. On the Arizona
  import (the fit read as if adopted, below) Aidan Miller's chance reads 0.58 for the rest of 2026, then 0.77, 0.83 and
  0.90; it read 0.61, then 0.42.
- **A better prospect is likelier to arrive and plays more** (C-02, the results path's principle). His chance and his
  playing time when he plays move with his projected quality (his ratings path's rate above replacement, never below
  zero, as the results path reads it) by the results fit's own effect of quality at the same usage (so a conservative
  reading), located on each cell's players now (a sample of 20 per cell and season) so that together they keep the
  cell's measured chance and, weighted by that chance, its playing time. Where the save measures the chance by
  potential, the chance is that and only the playing time moves. Each band edge takes the playing time its own rate goes
  with. The basis says `level_age_and_quality`. **What it cannot do:** below replacement the results fit measures no
  further effect of quality, and under the provisional development prior most of the youngest cells' players are
  projected below replacement, so a weak teenager keeps about his cell's chance: a few young prospects' centrals stay
  materially negative (the worst about −1.2 wins a season on the Arizona import). Both wait on the save's rating
  snapshots (the development path, the chance by potential).
- **Two top-level leagues** (D-07). Where the export names parents, another market league's farm and independent
  leagues are left out of a league's arrival cases (a league the export no longer lists, a defunct affiliate, is kept:
  not known to be another's), and reaching any top-level league is arriving.
- **The arrival gate reads relative miscalibration** (B-15, a tightening): beside the absolute 10 points, a held-out
  chance or expected playing time biased beyond 10% of what happened and three standard errors clustered by player
  fails. The model served is the method refit through the last completed season (the approved serving rule), scored
  on held-out seasons by the method fitted through the training seasons.
- **Partial ratings widen the blend** (A-15). A missing glove, running or current pitching grade no longer enters a
  thin record's blend as its central reading alone: the band reaches the blend re-read with the grade at five stations
  across the scale (both forms of the mapping's uncertainty), so every complete reading's band lies inside it, with
  the rate band's half-widths carried forward.
- **On the Arizona import the ratings fit fails the tightened gate** (`203:2025:ratings-3h.1`): the held-out chance is
  12–20% below what happened at horizons 3 to 6 (7 to 9 standard errors), because the save's arrival rates rose between
  the training seasons (2006–2015) and the held-out ones (2016–2025) and the arrival method weighs every season alike.
  It is not adopted, so the provisional ratings prior is in force and a player not in the majors has no expected
  playing time (`unknown`, with the gate's reason); the phase 3b fit is not read under the new method. Read as if
  adopted (a diagnostic), the prospects' summed centrals are 102 / 169 / 211 wins for 2027 / 2028 / 2029 (15 / 22 / 24
  before), against the save's own history of about 144 / 260 / 362 for a population this size one to three seasons on;
  what remains short is the prospects' rate when they play (about 0.55–0.6 WAR per 600 against 1.0–1.6 for the save's
  real arrivals), which is the ratings path's (the same-time mapping and the provisional development prior).

**What hardening F5 changed (2026-09-23, method `ratings-3h.2`, the owner's option C applied to arrivals; CALIBRATION.md
section 6.4).**

- **The arrival model is judged the way it is served.** Rolling origins by the results fit's rule (shared code), each
  fitted through its season and scored on the next season's minor leaguers; a horizon only where that fit holds the
  gate's minimum cases from at least 3 origin cohorts. Each arrival fit weights a case by a 2-season recency half-life.
  The gate's errors are clustered by player and by origin; its tolerances are F4's. Arrivals are adopted only where
  the next season could be checked (a tightening: a short history no longer passes unchecked).
- **A rating snapshot is read at its point of the season** for the chance by potential: the chance it is compared
  with is that of a player not yet called up at that point (C-01's reading), from the save's own schedule for that
  season (`seasonSpans`: the share of days from its first regular-season game to its last, close to but not the share of
  games the projection itself reads); where the schedule is not exported, across the range from the season's start to its end, and a
  tier's effect is used only where it holds across the range. No save has linked snapshots yet.
- **An unknown names its source:** `basis.source` is `ratings` when his ability was projected and his playing time was
  not, `none` when nothing could be projected.
- **On the Arizona import the fit still fails** at horizons 4 to 6 (the chance 17% low, about 7 standard errors; 0 to 3
  pass), at every half-life tried: at horizon h a fit can hold no cohort later than h seasons before its last, and the
  save's long-horizon arrival rate rose cohort after cohort. Prospects stay `unknown` there. As if adopted (a
  diagnostic) their summed central is 111 / 201 / 256 / 258 wins for 2027–30.

**What hardening F6 changed (2026-09-23, method `ratings-3h.3`, the owner's option (b): the arrival model adopted
horizon by horizon; CALIBRATION.md section 6.4, Part 12).**

- **Adoption is per horizon, a contiguous run.** Each horizon's held-out check is judged by the unchanged gate. The
  horizons served run from horizon 0 (the rest of this season) through the last horizon k whose check, and every check
  before it, passed. A horizon after one that failed, or after one with too few held-out cases to be checked, is never
  served, even where its own check passes. Nothing is served unless horizon 1 (the next season) is in the run, and the
  ratings mapping's own gate must still pass (`RATINGS_POLICY.adoption`, policy). No tolerance moved.
- **A season after k is not established, on its own.** `PlayerProduction.notEstablished` lists each season of the horizon
  after the established ones, with its reason: the horizon and the gate's finding there ("4 seasons out: the save's
  held-out arrival chance ran 17% low ..., outside the gate"). It has no band, no central and no zero; nothing is
  extrapolated, carried forward from the last adopted season or averaged into it. Seasons 0 to k keep their full bands,
  exactly as a fully adopted model would give them. The served cells carry nothing past k.
- **A total over seasons is a number only where every season in it is established** (`productionTotal`): otherwise it
  is unknown and names the seasons it cannot include. The central sums; the 80% edges are added edge against edge.
- **Labels say how far.** The fit's label reads "calibrated on this save through N seasons out", with the horizons not
  established; the cone's calibration line reads "arrival calibrated through N seasons out (years not established)";
  the record carries `arrival.adoption` (each horizon's own check, whether it is served, and why not).
- **The cone** draws the established seasons and keeps a slot for each later season of control, with its control label,
  an outlined "Production not established" mark, the reason on hover and in the screen-reader table, and no band or zero there.
- **Established players are unaffected:** the results path has no season not established, and the results fit keeps its
  all-horizons rule.
- **On the Arizona import** the ratings fit is adopted through 3 seasons out (4 to 6 fail, about 17% low): 6,351
  prospects are projected for 2026 to 2029, with summed centrals of 111 / 201 / 256 wins for 2027 to 2029, and 2030 to
  2032 not established.

### 2.4 Club Finances: the save's financial reality

**League (per import):**

- **Regime:** `rules_financials`, salary cap, luxury tax, luxury and revenue sharing, minimum salary,
  `financial_coefficient`, reserve clause (FA years 0), arbitration, `rules_owner_decides_budget`. Each is read as
  exported, and a value whose meaning is not established (R-2: the luxury rate against its threshold, 140, 48) is
  shown raw and not interpreted.
- **The price of a win** (market): a band with its basis (Part 4).
- **The replacement level:** a value with its basis (Part 4.3).

**Club:** budget, payroll this season and next, revenue, market, cash available for trades (`cash_trades_available`,
never the dead `cash`), `owner_expectation` (shown as the exported code, because its meaning is not established),
and **the club's marginal value of a win** (Part 4.5).

**Unknowns (R-7):** which of the current, last and 2025 history rows is authoritative; which current-row columns are
season-to-date; the revenue trend beyond one prior season, which accrues from Pennant's own snapshots.

**As built (phase 2).** `playerValueFinances.ts` composes it and `playerValue.ts` reads it (`clubFinances`,
`leagueFinances`); the regime is `LeagueRules.finance`, read through the parent league like the contract rules. The
authoritative-row question is settled by a stated rule and left open as a fact: each figure comes from the row that
names its season, `team_financials` for this season and `team_history_financials` for a past one.
`team_last_financials` names no season, so it is reported beside last season where it disagrees (Arizona: $265.0M
against the 2025 row's $274.3M) and never used or blended (`FINANCE_ROW_CALIBRATION`, policy). A row whose every money
field is zero is a placeholder, read as unknown, never $0: every club-season before 2025 and one club's 2025 row
(`PLACEHOLDER_ROW_CALIBRATION`). The luxury-tax figure (30), the luxury-sharing cap (140), the revenue-sharing figure
(48), the salary scale, `arbitration_offering`, `rules_fa_compensation`, `market`, `owner_expectation`, `mode`, the
media-contract `expires` columns and the zero sharing columns are shown as exported with `meaning: 'unknown'`
(`Uninterpreted` in `provenance.ts`) and never interpreted. `cash` is never read.

**Hardening (D-17).** A league that runs no financials (`rules_financials = 0`) is valued in wins, and so is its club:
budget, payroll (now, next season, offered), revenue, expenses, cash for trades, media money, last season and the revenue
trend are `unknown` with that reason, never the figures the export may still carry and never $0; the league's summed
payroll follows. Scales and codes that are not money (fans, market, owner expectation) are still shown as exported. Where
whether the league runs financials is not established, each figure stays as exported and says so.

### 2.5 Surplus

Per controlled season: production value (wins × price of a win) less cost, discounted to today, and summed. It is
reported as a band **with every component visible**: the wins band, the price band, the cost band, the discount, and
the seasons included. Part 5 sets out the arithmetic and the sunk-cost rule.

**As built (phase 5a, 2026-09-24; `playerValueSurplus.ts`, pure).** Every valuation that computes production and cost
carries `surplus` (`PlayerSurplus`): per controlled season within the horizon (Q-3), the wins band counted, the price of a
win in force and its stage (the opening price, or the one measured per win produced), the cost band with its basis, what a
replacement costs, the discount weight, the ways the season can go (an option's two branches, a season he may leave in),
and both views (contract surplus and retention margin), each a band with its central, before and after discounting; then
each view summed over the seasons with the seasons it covers, and his wins over a replacement's, summed the same way. The
entry point hands it the market (`surplusMarketFrom`); every read serves the same answer (the card's route
`/api/player-value/:playerId/surplus`, `playerSurplus`, Payroll's players and `leaguePlayerValues`). Part 5 has the rules.

---

## Part 3 — Units, bands and uncertainty

- **Wins** are the production unit. **Dollars** are derived from the save's own economy (Part 4). When the league
  has no financials (`rules_financials = 0` with no salaries), value is reported in wins and dollars are `unknown`,
  stating why.
- **A band is three numbers and a basis.** It is not a confidence interval Pennant cannot justify. Until a band's
  coverage is calibrated it is labelled a *range of reasonable readings* and each edge says what produced it. Expected
  production (phase 3a) is calibrated: an 80% and a 50% central interval, whose held-out coverage per horizon is
  measured on the save's own history and recorded with the fit (D-053, Part 7). Every season carries its targets
  beside the coverage the fit in force observed at that horizon for the ESTIMATOR SERVED (`coverage.target`,
  `coverage.observed`; hardening, B-05): at the season's own horizon (2027 seen from May 2026 is horizon 1.7, the fit's
  figures interpolated between horizons 1 and 2 and said so); `null`, "not measured", under the fallback prior, for the
  rest of a season under way (never backtested), and for a projection that leans on his ratings (the same-time blend
  cannot be backtested on this save; the results-only figure is named beside it as `coverage.reference`). The interface
  can say "80% target · 82% observed" only where 82% was measured for what it shows.
  A projection from ratings alone (phase 3b) cannot be backtested until the save holds rating snapshots across
  seasons: its seasons carry `observed: null`, "not measured", and its development range is the provisional prior's
  range of readings. Its arrival part is checked on held-out seasons (the ratings fit's record).
- **Combining bands** uses interval arithmetic: low with low, high with high, cost subtracted edge against opposite
  edge. That widens honestly and assumes no independence the evidence cannot support. Phase 5 may replace it with a
  calibrated method once coverage is measured. **One exception, the owner's (2026-09-24):** Payroll's sum over a club's
  players combines each player's distance from his central as independent across players (root sum of squares, low and
  high sides apart), keeping at its edges what is not noise (a status left open, a range of arbitration classes, a season
  he may not be held); it is labelled "players combined as independent; not a calibrated interval", shown with the
  edge-to-edge sum in its details, and never narrows a player's own band (2.2, `COST_COMBINATION_POLICY`). A class's
  line error, shared by its players, is read as independent too, so the range is a reading, not a coverage claim.
- **The same player has the same value whichever consumer asks.** One module computes it and every consumer reads
  it (Part 7).

---

## Part 4 — The price of a win

### 4.1 The opening price, from import one

The owner's decision is that dollars are available from the first import. The opening method:

> price of a win = salary above the league minimum ÷ wins above replacement, over the contracts that are market
> prices.

"Market prices" means the contracts of players with free-agency-eligible service (six years in the league's own
service-year length; R-3). Pre-arbitration and arbitration salaries are held below the market by rule. Using them
gives a floor, which is shown as a floor.

**Worked on this save (R-5):**

| Basis | $ per win |
|---|---|
| Floor: every major leaguer, salary above minimum ÷ WAR | $4.2M–$4.3M |
| FA-eligible service, 2025 WAR / two-season WAR / 2026 pace | $7.3M / $7.2M / $9.5M |
| FA-eligible, contracts starting 2026 (salary / AAV / 2026 pace) | $6.1M / $6.5M / $6.8M |

**Opening reading: about $7M per win, band $6M–$10M, floor $4.3M, at the export's replacement level (.29).** The
band is the spread of defensible bases, not a statistical interval. It is shown with every assumption R-5 lists:
the export's WAR, this season's salary, FA eligibility by service, a replacement player at the minimum and zero WAR,
prior WAR standing in for expected WAR, and the 27.6%-of-a-season pace as the widest basis.

**The opening price is the imported market.** On a historical start the opening contracts are the real world's
(R-1). The price is labelled with that basis until OOTP's own signings are observed.

**As built (phase 2), and why it differs from R-5 by exactly 17 players.** A market contract is one whose holder
Player Rights finds free-agency eligible *this* season (`evaluateContractControl`, service at the last winter, when
the salary was set; `MARKET_CONTRACT_CALIBRATION`, policy). R-5 counted service including this season's days. On the
Arizona import that is 253 market contracts against R-5's 270: the 17 who crossed six years during 2026, whose 2026
salaries were set before they could reach the market. The floor, which does not depend on the market, reproduces R-5
to the cent (A $4.22M, A′ $4.33M, 877 players, $4,425.9M above the minimum, 1,049.3 and 1,022.3 WAR). The market
bases move with the 17: B $7.50M, B′ $7.32M, B″ $9.78M, C $6.57M (124 contracts starting 2026), C′ $6.92M, C″ $7.19M.
**Central $7.25M (median of the six), band $6.57M–$9.78M, floor $4.22M–$4.33M**, against R-5's about $7M, $6M–$10M
and $4.2M–$4.3M. A read-only query of the same export under R-5's reading returns R-5's figures exactly (7.28 / 7.16 / 9.47 / 6.13 / 6.51 /
6.80), so the difference is the reading, not the arithmetic. Basis D is named as not used. A single market reading is
not a band: the price is then `unknown`, never a point. The price has no input from earlier imports.

**Hardening (B-13): enough of a season, enough of a market.** A season's WAR prices this season's salaries only on this
season's footing: each past season's WAR is divided by the share of this season's schedule it covered (its games per club
over this season's games per team, `scheduleShareOf`), both ways, and the basis says so ("2025 WAR, scaled from 37% of this
season's schedule"). Read as a full season, a 60-game 2020 made bases A, B, C and C2 about 2.7 times the price and B2
about 1.5 times. A season whose share is not established is not assumed full. Two policy minimums
(`OPENING_PRICE_MINIMUMS`, Part 11): a basis rests on at least a quarter of a schedule, for a past season and for this
season's pace alike, and on at least 20 contracts. Below either it is not computed and says why; with fewer than two bases
the price is `unknown`. On the Arizona import every basis clears both, and the figures above are unchanged (B2's WAR moves
from 454.6 to 454.7 for 2024's rain-outs and rounds to the same $7.32M). The pace bases rest on 27.6% of the season, just
over the quarter. Not done here: a sampling component for the band (a bootstrap over contracts) before the opening band is
compared with a measured one; that comparison is phase 4's, and the bootstrap belongs with it. *Built in phase 4b (4.2).*

### 4.2 How it tightens

At every import the market figures are snapshotted (Part 7). From the second import across an off-season,
contracts whose `season_year` or `years` changed, or whose club changed, are observed signings (R-6). Their salary,
set against the signed player's expected wins at the time, is a direct price observation. The measured price
replaces the opening one **when its band is narrower than the opening band** (owner, Q-4): the evidence decides,
not a fixed count of signings. The band narrows only as those observations accumulate. The history of the price stays visible, so drift can be seen.
Arbitration awards are identified the same way and measure the arbitration ladder (4.4).

**As built (phase 4b, 2026-09-23; `playerValueSignings.ts`, `playerValueContractStore.ts`, CALIBRATION.md section 9).**

- **What each import records.** Before the market snapshot, the import records its contracts in `history.db` (table
  `value_contract_snapshots`, with a header in `value_contract_imports`), keyed by the save's identity (its name and the
  league's fingerprint, hardening F1), the market league and the game date, idempotent per key and never able to fail the
  import: every player the league's clubs hold (term, salaries, club, organization, placement, a signed extension, whether
  he has a line in the league's statistics) and every unsigned player whose production is established; for a major-league
  deal, a placed player or an unsigned one also Player Rights' standing for this season and the two after it (standing,
  the statuses it lies between, the trip) and its reading of his service banked, his expected production per season as the entry point served it (central, 80%
  edges, expected opportunities, the model's label; since the review also the chance he plays at all, for a player
  projected on one side) and the cost the timeline priced for the season the coming winter sets (this season when the
  import is before Opening Day, else the next; review R3-08). A minor-league deal or a row with no term carries its terms
  only. On the Arizona save: 8,229 players, 1,841 with the full record, about 3.2 MB. **Since the review (2026-09-24)**
  each import also records whether its season had begun (before Opening Day by the schedule or the league's start date,
  or no game of the season has a line while earlier seasons do, as when OOTP moves `season_year` on beside last season's
  standings, D-08: then the share played is recorded as 0) and how much of it had been played (its games, plate
  appearances and batters faced), and the pair it forms with the import recorded before it is observed once and stored
  (`value_contract_pairs`, with the reading's method, `SIGNINGS_POLICY.method`): recording an import reads that one
  earlier import, never the whole history, so capture time stays flat as imports accumulate (review R3-03: 3.65 s with
  29 earlier imports before, 2.43 s after, the same as with one; a pair is read again from its two snapshots only when
  the method changes). **Kept at the winters (owner, 2026-09-24):** a full snapshot is kept only for the imports that
  bracket a winter (each endpoint of a pair of imports across one: the last before it, any inside it and the first after
  it) and for the most recent import (the next pair needs it). When an import is recorded, after its pair is stored, the
  other imports' snapshot rows are removed in one transaction that records a `pruned` event (`pruneContractSnapshots`,
  `retainedImports`); never across save identities, never the latest, and never a snapshot that a pair not yet stored
  under the current method still needs. The import's header, every stored pair and every event are kept: the pairs are
  the durable record, and what the market reads (the measured price, awards, renewals, replacement) is the same after
  pruning as before. **The consequence:** a later change of `SIGNINGS_POLICY.method` can re-read a pair only where both
  its snapshots were kept (the winter pairs); an in-season pair whose snapshot was pruned is read as stored, under the
  method it was stored with, and the observed market says how many (`retention`). A pruned import reads as not recorded,
  never as an import with no contracts. On R3's 30-import probe the snapshot table holds 8,229 rows (2.9 MB) instead of
  246,870 (86.1 MB); SQLite keeps the freed pages for later imports (the file does not shrink without a VACUUM, which
  Pennant does not run).
- **What changed, and how it is read** (R-6, D-020). Two consecutive imports are compared. A contract whose first season,
  length or organization changed is an observed change, and it is named for what changed ("first season 2026 → 2027;
  length 1 → 3; club 4 → 9"). It is then read through Player Rights' standing **at the earlier import** for the new
  contract's first season: free-agency eligible, with an organization that did not hold him (or when no club held him),
  a **free-agent market signing**; in arbitration, a one-year deal with his club, an **arbitration salary** ("an award
  or a settlement; the export does not say which"), and at the league minimum not read as one (4a's rule); before
  arbitration, a one-year deal a **renewal**; under a reserve clause a **reserve-clause renewal**; a longer deal while
  controlled, or a new deal over seasons his contract still covered, an **extension**; the extension the earlier import
  already held taking effect is not a new observation. The same terms with a new organization is the contract **moving
  with him** ("a trade or a claim; the export does not say which"), never a signing. A controlled player no club holds
  later **was not tendered or was released; the export does not say which**. Ambiguous changes are named, counted and
  left out of every measurement: a free agent re-signed by the club that held him (whether he reached the market first
  is not exported), a controlled player's new deal with another organization, a standing that was indeterminate or not
  recorded. Nothing reads the live log, and no change is given a transaction type the export does not carry.
  **Reviewed (2026-09-24):** the extension the earlier import held taking effect is never a signing, whether or not he
  changed clubs with it (R3-02); a free agent signed by an organization his lines show held him during the season before
  (a deadline acquisition re-signed) is counted and left out like a re-signing, and where his lines cannot be read he is
  left out and it says why (R3-04); a term that now ends no later than it did is a **term changed within its seasons**
  ("an option declined, a buyout, an opt-out or a restructure; the export does not say which"), never an extension; a club
  change between rows with no exported term says how he moved is not in the export, never "the same terms"; a major-league
  deal from his own organization after a row with no term is his organization adding him; a controlled player no club in
  this league holds later "was not tendered, was released, or is held outside this league" (R3-09).
- **A winter is read by the calendar** (review R3-01, R3-11, R4-12). An import in a season under way comes before the next
  winter; an import before its season has begun is inside that season's winter. A pair of imports spans the winters
  between; several imports across one winter count one winter (four pairs across the 2041 winter are one winter, not
  three), a deal for a season not yet begun at the earlier import is never "already under way", and last season's
  standings beside a new season number are never games played in it (the market's share played is unknown there, as
  production reads it, D-08). A pair a winter or more apart says so and is counted, never measured as one winter's
  signings. Production itself is unknown at an import after the bump (the D-08 guard), so a signing first seen after one
  enters only the reading that needs no projection (the realized basis, below).
- **Two timelines are never compared** (review R3-05). Imports are paired in the order they were recorded. An import dated
  at or before the one recorded before it (the save went back), or a date already recorded imported again with its
  season's play different (a reloaded save played again; the same play with other contracts is a move made on the same
  day, on the same timeline), starts a new timeline: no pair is formed across it, what the abandoned timeline observed
  after the date the new one starts from is left out, and so is any import dated after the export. The observed market
  says so (`timeline`).
- **The estimator, as bases** (reviewed 2026-09-24, R4-01, R4-02, R4-03, R4-07). The measured price is read like the
  opening one: a set of bases over the free-agent signings whose first season had not begun at the earlier import, each a
  ratio of sums (salary above the later import's minimum, never clipped, as the opening reads it):
  **over the deal**, per win projected at signing (the deal's seasons the earlier import projected; a deal running past
  that horizon, or with a season's salary not stated, is left out of this basis and counted, never cut short, and the
  largest signing's share of its money is shown); **the first season**, per win projected at signing; **the first season
  if he plays**, his expected wins over his chance of any major-league playing time (one side projected: he produces
  nothing when he does not play, so this is exact, not invented); and, once the signing's first season is completed in
  the export, **the first season per win he produced in it**, his WAR that season on its schedule's footing: the opening's
  own unit, with no projection in it. The projected bases read expected wins that include the chance a player does not
  play at all; for the players who did sign they sit below what signed players go on to produce, so the price per
  projected win reads high (on the Arizona market the free-agency class's salaries are $10.60M per projected 2027 win
  against $6.42M per 2025 win produced). **Each basis's band** is its signings resampled 1,000 times (by winter, then by
  signing within each, once two winters are observed, so a price that moved between winters shows as a wide band rather
  than a precise lagging one, R4-05), 10th to 90th percentile; at 20 to 40 signings a percentile bootstrap covers less
  than its 80% (about 75% in a Monte Carlo on the Arizona market, R4-09) and the text says so. Each basis needs the opening
  basis's minimum, 20 signings. **The price is per win produced** (owner, 2026-09-24): its central and its band are the
  realized basis's own (its ratio of sums and resampled band), the opening's unit; a basis whose band has no upper edge
  leaves the price not measured. **The readings per win projected at signing are its check** (`MeasuredPrice.check`):
  their median and spread with each one's sampling, and the ratio of that central to the price per win produced (how far
  the earlier import's expected wins sat from what the signed players went on to produce; 1.65 on the Arizona market's
  free-agency class, R4-01), shown beside the price and never in it. Until the realized reading exists the measured price
  is not measured, says it waits for the signings' first season to be completed, and shows the check. Signings are pooled
  over the winters observed, each in its own winter's dollars, undiscounted.
- **The opening band, like for like** (B-13's deferred component). Each opening market basis is resampled over its own
  contracts the same way; **the opening band with its sampling** is the spread of the bases with each basis's resampled
  band in it. The served opening price, band and floor are unchanged (Arizona $7.25M, $6.57M–$9.78M); the comparison band is
  $5.95M–$11.22M.
- **Adoption (owner Q-4, reviewed 2026-09-24).** The measured price replaces the opening one only when its band is narrower,
  in dollars, than the opening band with its sampling; an opening band whose sampling has no upper edge (or whose
  resampling failed, which is read as unbounded, never dropped) is wider than any bounded band (R3-07, R4-04). Two
  conditions come first, as policy tightenings: the measured price must **exist per win produced** (the realized reading;
  the owner's decision of 2026-09-24 that the price in force is per win produced, so a price per win projected at signing
  is never swapped in, R4-01), and the priced signings must **cover the winter's free-agent class**, at least
  5 in each third of it by expected wins at the earlier import (`SIGNINGS_POLICY.coverage`), so a winter of cheap deals,
  or of stars alone, never sets the price of every win (R4-02). The reason names the price per win produced and its check per win
  projected at signing, with their ratio, and flags a measured central below the opening floor or outside the opening band
  with its sampling (R4-11). Otherwise the opening price stays in force and says why: "The opening price stays: Not
  measured per win produced: 199 free-agent signings observed …; the price of a win is per win produced in the first
  season (owner, 2026-09-24), and that reading waits for the signings' first season to be completed … The check on the
  projection, per win projected at signing: $5.60M …", or "No off-season observed yet: the measured price needs two imports across a winter (one before its
  signings and one after). This save has 1 import recorded (2026-05-16)." The floor stays the opening's. When the measured
  price is in force its stamp, band rule and central rule are the measured price's own (per win produced); the opening bases are shown as
  the opening reading, not in force (R3-12). Every consumer reads the price in force through the entry point (`priceOfWin`,
  with `stage` and `adoption`); the arbitration ladder is priced against it.
- **The history** of the price is recorded with the market snapshot (`basis_json.adoption`: which was in force, both
  readings, why, and the check per win projected at signing with its ratio; each history row serves the check beside the
  price per win produced) and served by `GET /api/club-finances/:orgId/price-history` (with every observed change) and in
  `/api/club-finances/:orgId` (`priceHistory`); Payroll's price line lists it. A row written before phase 4b reads its
  price as the opening one and says the measured reading was not recorded.

### 4.3 Replacement level

The opening replacement level is **the one the export's WAR already uses**, measured from the save as (league wins −
league WAR) ÷ league games: .288 in 2024 and .293 in 2026 to date, about 47 wins per 162 (R-4). Phase 2 measures it
per season from the export (`replacementLevelOf`): **2024 .2877, 2026 to date .2933, 2025 not measured**, because the
2025 standings lack the Athletics (club 20) while their players have WAR; a level from the 29 clubs that remain would
not be the league's. Adopting it keeps
Pennant's wins and the game's WAR in the same units. It is stamped **provisional**. It is OOTP's convention, not a
measurement of the talent a club can actually get for the minimum. That measurement (the production of waiver
claims, minor-league free agents and call-ups) is phase 4 work. A change of 0.01 moves every price of a win by about
5%, and the snapshot records the level used.

**Measured from freely available talent (phase 4b).** A player acquired for nothing is one who joined an organization
from outside it on a minor-league deal, or on a major-league deal at the league minimum, and has a line in the league's
own statistics (a newcomer or an amateur is not a measure of freely available major-league talent). The live log is not
read, so a claim is not separated from a trade (the contract moving with him); only acquisitions the contract snapshots
identify count. Replacement is their major-league WAR per 600 opportunities (plate appearances and batters faced) for the
club that took them, in the season they joined it (review R4-06: a pickup who became a regular does not keep adding
seasons), with its resampled band, once 30 such players have major-league opportunities (`SIGNINGS_POLICY.replacement`).
Only pickups who played are in it, which pushes it up; it says how many acquired players did not play. Until then the
export's convention stays, labelled provisional, and says how many were observed (Arizona: none yet). **How it enters
(reviewed 2026-09-24, R3-06, R4-06): it does not, yet.** The measured replacement is shown and never applied: the
opening price, the measured price, the cost ladder and production all stay in the export's WAR, because applying a level
to one side only (as phase 4b first did to the measured price) put the price in a different unit from everything it was
compared with and multiplied. Surplus (phase 5) applies one level to both sides. A synthetic save measured 0.13 WAR per 600
(band 0.09–0.16) on 40 players.

### 4.4 Arbitration

**As built (phase 4a, 2026-09-23; `playerValueCost.ts`, CALIBRATION.md section 8).** Until arbitration awards are
observed across an off-season (phase 4b), an arbitration season's cost comes from the save's own cross-section at each
import, measured, never assumed:

- **The ladder, by class.** Player Rights says who is in arbitration this season and his class (by his service at the
  winter: this season's trip is counted from his service class, so a Super Two's hidden earlier trip sits in the class
  his service puts him in, and a fourth trip in the last class). Over the class's one-year major-league contracts set
  this winter, pay above the minimum is read against the **platform**: the mean WAR of the two seasons before the
  arbitration winter, each on its schedule's footing. A contract at the league minimum is kept out of the line and
  counted with its platform: pay there is held at the floor, not set by the platform, and which transaction produced it
  (an award, a non-tender re-signed) is not in the export and is never named. The line is a **base** (the class's pay at
  no platform wins) and a **pay per platform win** (the rung), in the import's own dollars, read **robustly**
  (Theil–Sen, the median of the slopes between every two contracts; review R2-04: on Arizona least squares let one
  market contract and one star move class 3's rung from $2.5M to $3.5M a win). Its spread is the 10th to 90th percentile
  of the class's pay around it, and the line's own uncertainty (from 200 bootstrap refits of the same line, about 1.3 of
  its standard errors each side) widens it. The two-season platform is policy, chosen because arbitration pays for a
  body of work and, on the Arizona import, explains every class's pay better than the platform season alone.
- **The season's band.** The minimum plus the class's line at the platform seasons' production (the export's WAR for a
  past season; the 80% production band for a future one, meaned edge with edge), every corner taken (interval
  arithmetic, Part 3), never below the least the class was paid above the minimum, except that where the save shows
  one-year contracts in the class at the league minimum a season whose platform low edge reaches as low as theirs has a
  low edge at the minimum, and says so (review R1-04). Where the trip is a range the band covers every class in it, and
  the class his service puts him in (Player Rights' `serviceClass`: the ladder reads a player of his service there, so a
  Super Two's later trips are covered where the next import will measure them; review R1-05); where the trip is not
  counted, every class from his service's up. A line measured on the save's own contracts is in this import's dollars,
  so the price of a win's band is not applied to it (and an unknown price leaves it standing); the prior, stated in
  shares of the price, carries the whole price band, and only then does the basis name the price band. A platform
  beyond the platforms a class was measured on says so; the line is extrapolated there, never capped.
- **Its central.** The class's line at the platform's central production (the price's central for the prior), in the
  class the trip counts (in his service's class where that lies wholly below it), inside the band. Where the trip is not
  counted, or the season lies between statuses Player Rights leaves open, each class's or status's central is named and
  none is chosen (D-018). A band is three numbers and a basis (Part 3); it remains a range of reasonable readings, edge
  against edge, not a calibrated interval, until phase 4b scores it against observed awards.
- **Thin classes.** Below 30 contracts a class has **no line of its own** (review R1-01, R2-02: a line on three to five
  contracts, extrapolated, set bands at five times a small league's largest salary, while one or two contracts were
  ignored): it is the provisional prior's reading (the same method on the imported real-world contracts, R-6, in
  minimums and shares of the price) hulled with the range the save paid the class above the minimum, so each of its own
  contracts only widens the band, and says provisional; only where the regime as read is MLB's (the comparison Super Two
  makes). Elsewhere a thin class is unknown with the reason: the range a handful of the save's own contracts paid says
  nothing about a player whose platform lies outside theirs, so it is not read alone (the owner may choose a thin
  measured line with t-based widening instead; open). A minimum of $0 carries no prior (it is in minimums).
- **Never MLB's ladder where it does not apply.** A league with no arbitration has no ladder (its players are renewed
  to free agency at its own renewal spread, and Player Rights lists no season as possibly arbitration); an arbitration
  rule the export does not state leaves the season indeterminate and its cost unknown.
- **Unknown stays unknown.** A platform season whose production is unknown or not established, an unknown price of a
  win where the prior is read, or a league without financials leaves the cost unknown with its reason.
- **Never below the previous salary** (owner-attested, 2026-09-24: "I've never seen a drop"; review R2-05). An
  arbitration salary is never below the player's previous season's salary: a rule of the game as the owner attests it,
  stated once by Player Rights (`ARBITRATION_NO_CUT_ATTESTATION`, `arbitrationSalaryFloor`, basis `owner_attested`, like
  Super Two) for every league whose regime as read has arbitration, and consumed by the ladder. It is not MLB's cap on a
  cut (to 80%), which is not applied. Every season priced as arbitration (and the arbitration branch of a season between
  statuses) has its low edge, its central and each class's central at least the previous salary where it is known: this
  season's contract salary for next season, and for a later season the season before's low edge (the least he is paid
  then if held), so a held player's arbitration low edges never fall year to year. Where the ladder's every reading lies
  below it (a market contract read as arbitration by service, such as Imanaga's $22.02M) the season is at his previous
  salary, a point, and says so. Where the previous salary is not known (not in the export, a $0 salary, an option whose
  declined branch ends his control) the basis says the rule cannot bind. It binds a salary the club tenders: every
  arbitration basis says a non-tender stays possible. On the Arizona save 526 of the 2,566 arbitration-priced seasons
  move (median lift $0.83M); no 2027 arbitration season's low edge or central sits below the 2026 salary (196 and 74
  did), and no held player's low edge falls from one arbitration season to the next (112 did).

On the Arizona import the three classes are measured on 74, 51 and 47 contracts: $0.38M, $1.04M and $0.65M above the
minimum plus $0.96M, $1.75M and $2.54M per platform win (13%, 24% and 35% of the price's central; least squares had
read 14%, 26% and 49%, R-6's ratio on the same cases 19%, 40%, 52%, against its own 22%, 42% and 53%). It is never
assumed to be the league minimum, and never a point.

**Observed awards (phase 4b).** Across a winter, a one-year deal with his club for a player Player Rights had in
arbitration for its first season is an observed arbitration salary (award or settlement, not said). Each is **scored**
against the band the earlier import's timeline priced for that season: how many fell inside it, overall and by class,
reported with its count and never gated (the ladder's bands are ranges of reasonable readings), and, since the review
(R4-08), beside how wide the bands scored were (their median ratio of top to bottom and width as a share of the salary:
on Arizona the next-season bands average about 6.5 times as high at the top as at the bottom, so near-full coverage says
little alone). An award is read in the class the ladder reads the same contract in: the lowest class of his trip (the
later import's reading for the season where recorded, else the earlier's), a trip beyond the top class in the top class,
as the ladder reads a later trip; an award whose trip was not recorded is scored in the total and in no class (R3-10). A
class the ladder does not establish on the import (unknown) is not priced by observed awards yet (open, R4-08). Once a class holds the
ladder's own minimum of observed salaries (30), pooled over the winters observed, they are **a reading of the class**
by the ladder's own line (each salary in its own winter's dollars, its platform read from the export), added beside the
import's cross-section; the season's band covers both, and its cost basis says the class is measured in part (a prior
class joined by observed awards is no longer "the provisional prior" alone). The cross-section stays: it is this winter's one-year salaries
in this import's dollars (the same contracts as the latest winter's awards), and the pooled awards add the earlier
winters. A league without arbitration has none to score and says so. **An observed arbitration salary below the player's
previous salary** (his contract's salary for the season before, as the earlier import recorded it) contradicts the
owner-attested rule: it is flagged, counted and named on Payroll's awards line (`AwardScore.belowPrevious`), still scored
as observed, never silently absorbed; one whose previous salary the earlier record does not state is counted as not
checked. **Reserve-clause renewals** observed across
imports (a one-year deal with his club under a reserve clause) price a reserve-clause season by the renewal spread's
method once 30 are seen: from the league minimum to the upper confidence bound of their 90th percentile.

### 4.5 Two prices of a win

| | League market price | Club's marginal value of a win |
|---|---|---|
| Question | What does a win cost to buy on this league's market? | What is one more win worth to this club now? |
| Source | Contracts and signings (4.1–4.2) | Competitive position: standings, schedule, playoff odds (`posture.ts`, `playoffs.ts`) |
| Nature | League fact | **Club fact, not philosophy.** A club four games out in August gains more from a win than a club twenty games out |
| Unit | Dollars per win | Playoff odds per win at first. Dollars only once the revenue link is measurable (Q-6) |

The win curve (how much a win moves this club's playoff odds) comes from the same odds model that already feeds
the deadline read. The export has one season of `playoff_revenue` (R-7), so the link from odds to money cannot be
fitted yet. Until it can, the club's marginal value of a win is stated in odds, not converted to dollars with an
invented curve. Philosophy's competitive window is a *different* thing, an identity: it can lean through the lens
and never replaces this fact (D-036 keeps window and season apart for the same reason).

**As built (phase 5b, 2026-09-24).** `playerValueWinValue.ts` (pure, `winValueOf`) reads the deadline read's odds model as
the entry point hands it over (`clubWinValue(teamId)`); `posture.ts` now exports the model it always used (`oddsModelOf`,
`oddsAt`, `shownOdds`, `RIVAL_TALENT`), and the deadline read is computed from it unchanged. The model: talent from this
season's runs (Pythagorean, exponent 1.83), the club holding (or chasing) the place read as a .520 club, the gap in games
from the standings (`playoffs.ts`), the difference over the games left read as normal. **One more win** is a loss turned
into a win: the gap to the place closes by a game, or a cushion grows by one. The answer is the odds now (as the deadline
read shows them, within 1%–99%), the value of one more win in points of playoff odds (read on the model itself, before those
display bounds), and the curve from three wins fewer to five more over the rest of the season (`WIN_VALUE_POLICY`), stamped
provisional (`WIN_CURVE_CALIBRATION`), with its basis in words. **Unknown stays unknown:** before a game is played, without
standings, or where the club is not in its conference's standings, it is unknown with the reason, never the deadline
read's own default of a level race; with no games left a win can no longer be added (`no_games_left`); where the place is
beyond reach by the model's arithmetic (a cushion or a gap larger than the games left, both clubs with this club's games
left), or nobody is outside the club's place, a win moves nothing (`decided`, 0). A division leader is read against its
own division only: the wild card, a second way in, is not in the model, and the basis says its odds read low. It is served
on Club Finances (`/api/club-finances/:orgId`, Payroll's line under the price of a win) and with our view
(`/api/player-value/:playerId/our-view`, for the viewing organization), in playoff odds only, and it enters neither the
neutral surplus nor our view (`playerValueBoundary.test.ts`). It is the same for every organization that reads it.

**The odds model's cushion, corrected.** Building it found that `playoffPicture` measured a division leader's cushion
against the club at the BOTTOM of its division (its reduce kept the club furthest behind), so every leader read as far
clearer than it was. Arizona, 26–17 and level with San Francisco, read as 7 games clear (of Colorado) and 86% to reach the
postseason; it is 0 games clear. Fixed in `playoffs.ts` (`tests/playoffs.test.ts`), so the deadline read, the
dashboard and MLB Operations' season read see the corrected cushion too. Read against its division alone that gave 57%;
with the leader's wild-card route (the owner's answer, below) the odds read the lead over the first club outside the field,
4 games, and Arizona is 75%.

On the Arizona import (2026-05-16, 119 games left), the value of one more win now, in points of playoff odds (odds now in
brackets): Arizona **+3.89** (75%); tight races: the Dodgers +5.15 (41%), St. Louis +5.15 (54%), Atlanta +5.14 (41%), the
Angels +5.12 (55%); comfortable: Pittsburgh +1.28 (95%), Detroit +1.55 (93%), San Francisco +1.65 (93%); far out:
Cincinnati +0.08, Washington +0.03 and Miami under 0.01 (each 1% as shown). No club's place is decided in May.

---

## Part 5 — Surplus, and why sunk money never argues for keeping a player

**Contract surplus** (what the contract is worth to whoever holds it; the trade and market view):

```text
for each controlled season s:  wins(s) × price(s)  −  cost(s)       (each a band)
surplus = Σ  discount(s) × that                                      (discount: a policy rate)
```

**The retention view** (keep him or not) compares the club's two futures. Money owed whatever the club does, such as
guaranteed salary after a release, appears in both futures and cancels. Money already paid appears in neither.
What remains:

```text
retention margin = (his wins − the replacement's wins) × price  −  the costs that exist only if he is kept
```

"Costs only if kept" are arbitration raises, exercised options, a 40-man spot (stated through Player Rights, never
priced by invention) and the like. **A large remaining guarantee never makes keeping him look better.** A contract
can have a deeply negative contract surplus and a positive retention margin: the money is gone either way, and he
may still be the best use of the roster spot. The converse is shown too. Both views are displayed with their
components, and neither is a verdict.

### 5.1 As built (phase 5a, 2026-09-24)

`playerValueSurplus.ts` (pure, `surplusOf`) joins Player Value's own answers as the entry point hands them over: expected
production, the control timeline with its cost path, and the league's market (the price of a win in force, the minimum
salary, this season's replacement level). It reads no table, no rating, no philosophy and no tier. The rules, each stated
in the answer's `basis`:

- **Production value, one level of replacement on both sides.** His wins are the export's WAR, wins above its own
  replacement level; the replacement's wins are 0 there by construction of WAR; the price of a win is salary *above the
  league minimum* per win above that same level (4.1). So what the market pays for his production is the minimum (what a
  replacement at 0 WAR costs, the price's own zero) plus his wins × the price. The formula above reads `wins × price −
  cost` with the price's zero at the minimum; as built, the minimum is written out: **contract surplus = minimum + wins ×
  price − cost**, and a replacement-level player at the minimum is worth exactly nothing, never −$780K. The measured
  replacement from freely available talent (4.3) is shown beside it and never applied.
- **The price in each season** is the price of a win in force today (opening, or measured per win produced), **held flat**
  (owner, 2026-09-24: no salary inflation is assumed unless the save's own measured price history later shows drift). Its
  band is carried whole into every season.
- **The discount** is one stated policy rate, **5% a season** (owner, 2026-09-24; Q-3): a season *s* seasons from now
  weighs 1/1.05^*s*; this season's remaining part weighs 1 (`SURPLUS_POLICY.discountRate`).
- **The rest of this season** counts only its part still to be played: his wins for the rest of it (production's
  `remaining` band), and the same share of his salary and of a replacement's minimum, the share of the league's games not
  yet played (production's own reading, 72.4% on the Arizona import). What he has banked and the salary for the part
  played are **sunk for the forward view: shown, never counted** (`banked`, `paid`). Salary is taken to accrue with the
  schedule; how OOTP pays within a season is not exported, and the basis says so.
- **Edge against edge** (Part 3): a season's band is the corners of wins × price (wins may be negative) plus the minimum,
  less the cost edge against the opposite edge; its central is the components' centrals (minimum + central wins × central
  price − central cost); the sum over seasons adds edge with edge. A season whose cost lies between statuses has no
  central, and each status's central is named; a season that can go more than one way (an option exercised or declined,
  a season he may leave in as a free agent) is the hull of its ways, with each way's central named and none chosen. A sum
  over such a season has no single central and gives the range of its readings' centrals.
- **The retention margin** is (his wins − the replacement's 0) × price + the minimum a replacement would cost − the costs
  that exist only if he is kept. **Money owed whatever the club does** is a major-league contract's salary for a season it
  covers (the current deal or a signed extension; the export does not say otherwise): it is in both futures and cancels,
  so it enters neither the margin nor its words (`owedEitherWay`). **Money already paid** is in neither. **Costs only if
  kept**: a projected pre-arbitration, arbitration or reserve-clause salary (the club may decline to tender him), a
  season between statuses, the salary of a club, vesting or mutual option less the buyout the club would pay to decline
  (`onlyIfKept`). The export does not populate buyouts, so an option's buyout is read **from nothing to the option's
  salary** (a buyout above the salary would make declining dearer than exercising), and the margin's central for that
  season is a range. A player option or an opt-out is the player's decision: the margin is his staying branch, "if held",
  its salary owed if he stays. The replacement's minimum is subtracted from the costs wherever he holds a major-league
  place; a minor-league deal's salary, and whether it is owed, are not established, so such a season is unknown. **A
  40-man spot** is stated (the export's 40-man flag; what the spot allows is Player Rights', on the card's roster rights)
  and never priced.
- **Sunk salary never favours keeping a player** (behavior case): raising a past season's salary, this season's salary
  (its paid part sunk, its unpaid part owed either way) or a guaranteed later season's salary changes neither the
  retention margin nor its words, and lowers the contract surplus. Where every cost exists only if he is kept, the two
  views agree season by season.
- **Unknown stays unknown.** A season whose wins are not established (a prospect past the arrival model's adopted
  horizon, F6) or whose cost is unknown (a blank contract row, a minor-league $0 salary, a season after a minor-league
  contract) has no surplus, with its reason; a sum over it is not a number and names the seasons it cannot include (the
  `productionTotal` pattern), and the leading run of known seasons is given apart, labelled with its seasons. Unknown
  production leaves both views unknown with its reason; no club holding him leaves nothing to value (`not_held`). With no
  financials, no price of a win or no minimum the value is **in wins only** (`wins_only`): his wins over a replacement's,
  discounted, and dollars unknown with the reason.
- **No verdict.** Neither view says keep, release, trade, extend or sign; the card shows them side by side.

**Worked on the Arizona import** (2026-05-16, the opening price $7.25M a win, band $6.57M–$9.78M, minimum $780K; production
under the fallback prior, the save's own results fit having failed its gate on hitters at horizons 5 and 6; every figure
discounted):

| Player | Contract surplus | Retention margin | What it shows |
|---|---|---|---|
| Corbin Carroll (signed through 2030, club option 2031) | central $37.1M–$59.0M, range −$56.2M to $262.0M, 2026–2031 | central $139.9M–$161.8M, range $29.8M–$365.2M | A long guarantee: the salaries ($28.6M in 2029–2030) are in the contract view and cancel in the margin. The 2031 option has two ways (exercised −$0.5M central; declined into free agency with an unexported buyout, −$28.0M to $0), so no single central |
| Gunnar Henderson (first-year arbitration) | central $65.0M–$80.9M, range −$36.8M to $237.2M, 2026–2029 | $87.1M, range −$30.7M to $243.3M (if held) | 2027 arbitration $8.5M–$22.2M, central $8.9M (floored at his 2026 salary, owner's rule); costs only if kept, so both views read $29.7M there. 2029 may be free agency: "if held" |
| Nick Kurtz (pre-arbitration) | central $170.5M–$198.0M, range $5.4M–$455.3M, 2026–2031 | central $193.4M–$198.6M, range $5.9M–$455.9M | 2027 renewal at about the minimum for 6.8 expected wins: $49.0M ($22.5M–$96.1M) in both views; 2028 between pre-arbitration and arbitration (Super Two), each central named |
| Mike Trout (a big contract that underperforms) | **−$129.2M**, range −$158.4M to −$50.3M, 2026–2030 | **+$29.3M**, range $0.0M–$108.2M | The sunk-cost rule: $37.1M a season is owed whatever the club does, so it cancels in the margin; his 3.6 expected wins (−0.3 to 10.7) still beat a replacement's 0 at the minimum |
| Zac Gallen (one-year veteran) | −$2.0M, range −$12.9M to $16.7M, the rest of 2026 | $11.5M, range $0.6M–$30.2M | Only the rest of 2026 counts: $13.5M of his salary still to pay (the $5.2M paid and his 0.8 banked WAR are sunk); free agent from 2027 |
| Aidan Miller (a prospect) | unknown, all seven seasons named | unknown | 2026 on a blank contract row (salary not exported); 2027–2029 after it, control and cost not established; 2030–2032 production not established (the arrival model is adopted through three seasons out). His wins 2026–2029 are shown |
| Tyler Austin (unknown production) | unknown | unknown | "His ability is projected, but his major-league playing time is not established": no view is guessed |

76 players under major-league deals have a contract surplus below −$20M and a positive retention margin (among them
Machado, Bogaerts, Turner, Seager and Bregman); 70 have a negative retention margin central. Across the league's 12,575
valuations: 7,852 in dollars, 157 unknown production, 4,566 held by no club, none in wins only (Arizona runs
financials). A sum is a number for 1,048 players, every one on a major-league deal: contract surplus central 10th
percentile −$17.7M, quartiles −$1.9M, $1.0M and $11.5M, 90th $32.7M, 457 negative; band width median $76.2M, 90th
percentile $232.3M. The rest are unknown for a stated reason: a blank contract row this season (6,740, the minor
leaguers), a minor-league $0 salary (50), a season whose control is not established (8), a season whose production is not
established (6).

---

## Part 6 — The philosophy lens

The neutral valuation is computed without philosophy, cached, and served as it is. The lens runs **at read time** on
a neutral valuation and produces "our view" beside it. Changing philosophy never recomputes the neutral value.

**It reads** the dimensions `competitiveWindow`, `riskTolerance`, `payrollFlexibility`, `costEfficiency` and
`teamControl`, and the policies `agingContracts`, `arbitrationExtensions`, `rentalAcquisitions` and `salaryDumps`
(`philosophy.ts`, unread today).

**It may:** weight near seasons against far ones (window); read the band nearer its low edge or its centre (risk
tolerance); weight controlled seasons (team control); weight cost against production (cost efficiency, payroll
flexibility); and word emphasis for aging contracts, extensions, rentals and salary dumps.

**It may not:** change any neutral fact, band, price of a win, replacement level, control status or cost; turn an
`indeterminate` into a number; read or write the club's marginal value of a win as if it were identity; or lean
unseen. Every lean is a named reason (dimension, value, what it did), the `ShadeReason` pattern of D-036. "Our view"
always states the neutral figure it started from.

### 6.1 As built (phase 5b, 2026-09-24)

`playerValueLens.ts` (pure, `ourViewOf`) is the one Player Value module that names philosophy. It is handed a neutral
valuation (5a's surplus with its seasons and components, exactly as every read serves it) and the organization's
philosophy (`LensPhilosophy`: each dimension's effective value and the policies), and returns `OurView` beside the neutral
one. It imports `philosophy.ts` for the dimensions and the default policies only, never the settings that store a
philosophy; it reaches no production, cost, fit, table, rating, protection tier, defensibility or club value of a win
(boundary test). The route `/api/player-value/:playerId/our-view` (`server/ourViewRoutes.ts`, a consumer outside the
neutral path) resolves whose view it is (the organization the page names, else the configured default, else the club the
save is played as), reads that organization's philosophy from settings at read time and hands it to the lens; a
philosophy edit invalidates nothing and recomputes nothing.

| Read | What it does in our view | Policy (`LENS_POLICY`, stamped `LENS_POLICY_CALIBRATION`) |
|---|---|---|
| Every dimension | Inside 40–60 (D-036's lean thresholds) it leans on nothing; beyond, the lean grows linearly from the band's edge to its limit at 0 or 100 | `band` |
| `competitiveWindow` | Our discount instead of the neutral 5%: toward 15% a season at 100 (a win-now club counts later seasons less), toward 0% at 0 (a club building counts them as much as this one). This season's remaining part weighs 1 either way | `window` |
| `riskTolerance` | Reads each season's range from its centre toward its low edge, up to half way at 0. At or above the band it reads the centre, as neutral: never above the centre, never below the low edge (Part 6) | `risk` |
| `teamControl` | The seasons the club controls at its option (pre-arbitration, arbitration, the reserve clause, a club option, or a season Player Rights leaves between those only) weigh 1 ± 0.2 | `teamControl` |
| `costEfficiency` | His cost weighs 1 ± 0.2 against his production, in both views (in the retention margin, only the costs that exist if he is kept) | `costEfficiency` |
| `payrollFlexibility` | Guaranteed salary in later seasons weighs 1 ± 0.2, **in the contract view only**: in the retention margin that money is owed whatever the club does and cancels, and no philosophy brings sunk money back | `payrollFlexibility` |
| `agingContracts`, `arbitrationExtensions`, `rentalAcquisitions`, `salaryDumps` | Words only: a note names the policy and the seasons or facts it points at (seasons at 33 or older; arbitration seasons; a player another club holds whose control ends with this season; a contract below zero with guaranteed salary still to come). No number moves, and the default policy says nothing | `aging` |

The rules, each in the answer's basis:

- **The neutral figure is never changed.** Our view restates each neutral total it started from (`neutral`) beside its own
  (`ours`); the valuation handed in is untouched (a property test over hundreds of random philosophies deep-freezes it).
  A philosophy with every dimension inside the band and the default policies leans on nothing: our view is the neutral
  view exactly (the served figures, not a recomputation), with no lean and no note. On this save the owner's configured
  philosophy is exactly that (every dimension 50, the default policies), so our view is the neutral view for every player.
- **Every difference is named.** Each lean is a `LensLean` (the dimension, its value, a few plain words for the card, a
  sentence with its numbers, the seasons it touched) with **by how much** it moved our central reading in each view. The
  leans are applied in a stated order (cost efficiency, payroll flexibility, risk tolerance, competitive window, team
  control) and each amount is its step after the ones before, so the amounts add up to the difference. A dimension read but
  not leaning says why (inside the band; no season it applies to; it made no difference). `read` lists all nine.
- **Bands and centrals.** A cost weight on a season with a single central moves the band's edges and the central exactly
  (the edge that made each edge); where a season has no single cost reading (between statuses, several ways) the
  adjustment is a range taken edge against edge, only ever wider. Risk tolerance moves the reading, never the band. Our view
  has its own band (the season bands under our weights), never the neutral one changed.
- **Unknown stays unknown.** A total unknown in the neutral view is unknown in ours with the same reason; where the neutral
  view gives the leading run of known seasons apart, ours does too, leaned.
- **The club's value of a win is not read.** It is served beside our view as context (4.5); Part 6 forbids reading it as
  identity, and no lean uses it (an owner question, Part 9).

**Worked on the Arizona import** under three philosophies: the owner's configured one (every dimension 50, the default
policies: no lean for any player); a win-now philosophy (window 90, risk 70, payroll flexibility 30, cost efficiency 35,
team control 45; aging contracts willing, rentals aggressive); and a rebuild (window 10, risk 20, payroll flexibility 85,
cost efficiency 80, team control 85; aging contracts avoid, extensions prefer, salary dumps willing). Contract value and
the value of keeping him, most likely (or the range of readings), neutral then ours:

| Player | Neutral (= owner's) | Win-now | Rebuild | The leans |
|---|---|---|---|---|
| Corbin Carroll | $37.1M–$59.0M; keeping him $139.9M–$161.8M | $43.7M–$59.6M; $122.7M–$138.6M | −$16.1M–$8.4M; $116.7M–$141.1M | Win-now: window 12.5% a season (2031 weighs 0.55 against 0.78), payroll flexibility 30 (+$3.6M, contract only), cost efficiency 35. Rebuild: risk (−$23.3M), cost efficiency (−$10.3M), payroll flexibility (−$10.1M), window 1.25%, the 2031 club option weighed 12.5% more |
| Gunnar Henderson | $65.0M–$80.9M; $87.1M | $61.0M–$74.5M; $80.2M | $38.4M–$53.9M; $59.6M | Rebuild: risk −$26.1M to −$30.7M; team control +$4.0M on 2027–2028 (arbitration; 2029, which may be free agency, is not weighed); note: extensions preferred, arbitration seasons 2027–2029 |
| Mike Trout | −$129.2M; $29.3M | −$102.5M; $27.1M | −$184.7M; $23.0M | Win-now: window +$16.4M (later guaranteed seasons count less), payroll flexibility +$6.4M; note: aging contracts willing, 2026–2030 at 34–38. Rebuild: payroll flexibility −$18.1M and cost efficiency −$15.8M in the contract value, **the value of keeping him moved only by risk (−$7.3M) and the window**: his guarantee is owed either way; notes: aging contracts avoided, salary still owed 2027–2030 |
| Zac Gallen | −$2.0M; $11.5M | −$1.7M; $11.5M | −$6.1M; $8.8M | Only the rest of 2026 counts, so the window has no later season to weigh (said) |
| Nick Kurtz | $170.5M–$198.0M; $193.4M–$198.6M | $149.4M–$170.5M; $166.1M–$170.8M | $145.7M–$174.0M; $167.7M–$173.3M | Win-now: window −$21.5M to −$29.0M. Rebuild: risk −$42.1M to −$50.0M, team control +$15.2M (2027–2030), window +$8.0M to +$12.1M |

---

## Part 7 — Compute and caching

- **League-wide, once per import.** Every active player (12,575 on this save; R-9) is valued, including unsigned
  players and other organizations'.
- **Lazily, on the first request**, computed once and shared by every concurrent request (single-flight).
  Optionally it is warmed after an import finishes, fire-and-forget, never able to fail the import (the pattern of
  `takeSnapshot` in `api.ts` `runImport`).
- **A disposable derived store keyed by the import** (save name, game date, import finish time). It is dropped
  where `clearValuationCaches()` is called today and can be deleted at any time without loss. It is not `history.db`.
- **The philosophy lens at read time**, so a philosophy edit never recomputes anything. As built (phase 5b): the lens
  takes the neutral valuation every read serves and the organization's philosophy, reads no table, and costs 248 ms for
  all 12,575 valuations of the league (about 20 µs each); the card's `our-view` route computes the same per-request
  valuation the `surplus` route does and applies the lens (4.37 s for 40 players over HTTP, about 110 ms each, the
  valuation's time). The club's value of a win reads the standings once per request. No store.
- **Market figures snapshotted per import into `history.db`** (D-009): the price of a win (band and basis),
  replacement level, league regime, league payroll, the observed signings counted, and since phase 4a the cost ladder
  (the renewal spread and the arbitration ladder, in `basis_json.costs`; optional on read: a key first written before
  4a has none, since a key is never rewritten, and the review changed a reading's shape, so a reader checks it); since phase 4b which price was in force and
  why (`basis_json.adoption`) and what the imports observed (`basis_json.observed`). **The contracts themselves are
  snapshotted per import** (phase 4b, `playerValueContractStore.ts`, 4.2), before the market row, so the next import's
  signings are observed against them. Keyed by save, league and game
  date, idempotent per key, so drift is visible across imports. The ladder a valuation prices with is measured once per
  import and market league (a cache cleared with the production caches after an import), from the same population, WAR
  and price as the market.
- **No periodic timer.** Data changes only on import (D-009). The server's start records the market and contracts of the export already imported when this build has not yet (`recordImportMarket`, the import's own call, idempotent per key): a save imported before phase 4b gets its first contract snapshot at the next start, not at its next import (supervisor's call, approved by the owner 2026-09-24). It reads the imported database only; nothing new is imported.
- **One domain API** (D-008). Browser, desktop, static export and AI read the same routes. The AI receives the
  decomposition with its basis and never a bare number (the lesson `VALUE_PERCENTILE_NOTE` records).

Phase 1 times the full-league compute on this import before choosing lazy-only or warm-after-import (R-9 sizes it
at a few hundred thousand rows).

**The production fit store (phase 3a, D-053; hardened 2026-09-23).** Table `value_production_fits` in `history.db`
(`playerValueFitStore.ts`, Player Value's second writer): one row per save, league, last completed season and
method version (the primary key). The save is its IDENTITY, not its configured name alone: the `save_name` column holds
the name and a fingerprint of the league's own history (its id and name, its first season with major-league lines and
that season's first players with their dates of birth, `leagueFingerprint`), so a new save under a reused name and
league id never inherits another's fit (D-01); the market snapshot is keyed the same way, and a rating snapshot whose
age disagrees with the player's date of birth is not read as his history. Rows written before the identity (the plain
name) are simply never matched: the first start after the upgrade refits, and no migration is needed. A fit in force
is never through a season the league has not completed (a reverted save, A-21); a season is complete only when every
club has played its schedule, no scheduled regular-season game is unplayed and the league has that season's lines
(D-08); a forced refit that fails the gate never replaces an adopted row (A-02). The table is additive (`CREATE TABLE IF NOT EXISTS`) and idempotent (`INSERT OR IGNORE`; only a
developer's forced refit replaces a row). Each row holds the fitted model as JSON, the run record (window, training and
held-out seasons, sample, prior weight, held-out coverage per horizon for both bands, pooled, by kind and by usage
tier, the aging summary, the proneness findings, the gate's verdict and reason), whether it was adopted, the import's
game date and the time the fit took; the wall-clock time is a diagnostic only. The model in force is the adopted row
with the latest completed season; with none, the provisional fallback prior, labelled "not yet calibrated on this save
(N seasons)" with why. **Refit:** after the import has finished, `runImport` computes the refit in a WORKER THREAD
(`playerValueRefitWorker.ts`, its own read connections; better-sqlite3 works in a worker; A-17) and the main thread
records the result only if no import started while it read; every failure is caught and logged, and without a worker
the same work runs in-process after the turn. It can never block or fail the import, and it no longer blocks the
server: on the Arizona import the refit takes 20.4 s in the worker under `production-3h.2` (production 17.4 s: nine
fits, one per rolling origin and the served one; ratings 2.2 s), recording takes 81 ms, and the main thread's event loop
was never held more than 2 ms (under 3h.1, four fits, 12.0 s). A league's last
completed season is this season once every club has played its schedule (`team_record`), else the one before; a key
already fitted is skipped, so a re-import without a newer completed season fits nothing. The same background refit also runs once at server start for a save that is already imported (`bootstrapData`), so a save with no fit for its latest completed season (a new install, or a method version that ignores the stored fit) is fitted without waiting for an import; it does not need the export folder. No timer, no wall-clock
date. **Served** by `GET /api/player-value/production-fit/:orgId` (the fit in force, the latest attempt, the targets)
and in every production answer's basis. **Forced** by `npx tsx scripts/calibrate.ts production --refit`.

**Measured in phase 5a** (read-only, the Arizona import, a scratch `history.db`): the surplus is computed with every
valuation that computes production and cost, from answers already in hand and the market the cost ladder already reads
(cached per import and market league), so it adds no query. The league-wide pass for all 12,575 players takes 3.24–3.29 s
warm with it (4.60 s cold) against 2.95–3.05 s on `origin/main` (4.82 s cold); one organization 191–207 ms (186–219 ms
before); the card's route about 100 ms a player (40 players in 4.06 s over HTTP). **Choice: still computed per request,
no store.**

**Measured in phase 4b** (read-only, the Arizona import, a scratch `history.db`): the contract snapshot takes about
**2.5 s** inside the import (one league-wide valuation with production and costs; the market row after it), writes 8,229
rows (about 3.2 MB with the key index: 2.7 MB of pages, of which 1.72 MB are the 1,841 full rows' data and 0.15 MB the 6,388
terms-only rows; the production label is stored once per import), and a second capture writes nothing in about 1 ms.
`leagueFinances` with the observed market and the opening sampling takes about 150 ms (unchanged: the resampling is
1,000 draws per basis over its own contracts, and the observed market is read once per import and cached). The size is
bounded per import; since the owner's decision of 2026-09-24 only the imports that bracket a winter and the latest keep
their full snapshot (4.2), so it no longer grows with in-season imports: on R3's 30-import probe (29 in-season copies of
the Arizona import, then the export's own) the snapshot table holds 8,229 rows, 2.9 MB, against 246,870 rows, 86.1 MB,
before (pages in use 5.6 MB against 103.1 MB; the file keeps its freed pages for reuse), with 30 import headers, 29 pairs
and 30 events kept; the capture removes 29 imports' rows in one transaction. **Since the phase 4b review** (R3-03) the capture reads only the import recorded before it
and stores the pair the two form (with the reading's method); the market reads the stored pairs. With 29 earlier
imports of the same size (98 MB of `history.db`) the capture took 3.65 s and loaded every snapshot (217 MB of them by
R3's count); it now takes 2.43 s, the same as with one earlier import, and `leagueFinances` cold 0.42 s against 0.82 s.
A same-date re-capture also reads the season's play (one query) to tell a move made that day from a replayed day.

**Measured in phase 3a** (read-only, the same import, a scratch `history.db`): a full refit takes **4.6 s** end to end
(history read 0.16 s: every major-league line 2002–2025; fit 4.5 s on 5,956 players), in the background after an import. Serving
production reads the fit in force from `history.db` per request. `playerValues` for one organization (285 players,
contract, control and production) takes **37–40 ms**; the league-wide pass for all 12,575 active players takes
**568–614 ms** with production and 221–378 ms without it. **Choice: computed per request, no store.** Every route that
serves production asks for a player, a list or an organization, well under half a second; nothing asks for the
league-wide pass except `npm run value:report`. The disposable per-import store above is built when a consumer needs
production league-wide per request (Free Agents or Org Comparison, phase 6), and is then dropped where
`clearValuationCaches()` is called, never kept in `history.db`.

**Measured in phase 3b** (read-only, the same import, a scratch `history.db`). Production now covers the whole league:
8,072 of the 12,575 active players have a band (3a: 1,721). A results refit takes **5.1 s** (fit 5.0 s: the playing-time
model is now a logistic and a regression per kind and horizon, and the tails are set for nine cells); the ratings refit
**1.5–1.6 s** (reading 1.7 s of evidence: 1,721 major leaguers' ratings, the minor-league usage of 42,598 players,
8,009 rating snapshots; fit 0.5 s), both in the background after an import. Per request: **one player 29–34 ms**, one
organization (285 players) **62–71 ms**, 500 players (the route's cap) **73–81 ms**; the league-wide pass **1.24–1.49 s**
with production and 223–246 ms without it. **Choice: still computed per request, no store.** Every route that serves
production asks for a player, a list of at most 500 or an organization, well under half a second; only `npm run
value:report` asks for the league-wide pass. The disposable per-import store is built when a consumer needs production
league-wide per request (phase 6), keyed by the import and dropped where `clearValuationCaches()` is called, never in
`history.db`.

**Measured in phase 2** (`npm run value:report`, read-only, same import): `leagueFinances` (the regime, the valuation
of the 901 major leaguers on active and injured lists, three seasons of WAR, the standings, the price and replacement
level) plus `clubFinances` takes **132–150 ms** per pass over three passes, and 603 ms for the first, cold pass of a
process (statement preparation included); `clubFinances` alone is under 1 ms. **Choice: computed per request, no
store.** A Payroll load stays well under half a second, so the disposable per-import store above is still not built;
it is built when production (phase 3) makes a pass expensive. The **market snapshot** is built: table
`value_market_snapshots` in `history.db` (`playerValueSnapshot.ts`, the one Player Value writer), primary key
(save, league, ISO game date via `parseGameDate`), `INSERT OR IGNORE` after an existence check that skips the
compute. It records the price's label, unit, central, band, floor and note, the market-contract count, OOTP's league
payroll, the replacement level per season, the regime and the full basis as JSON. `runImport` calls it once, after
the rating and roster-state snapshots, inside a try/catch, and the writer itself returns errors rather than throwing.
The table is `CREATE TABLE IF NOT EXISTS`, as every history.db table is: additive for existing files. Its history is
served by `/api/club-finances/:orgId`.

**Measured in phase 1** (`npm run value:report`, read-only, on the Arizona import at 2026-5-16): contract facts and
the control timeline for all **12,575** active players (12,575 contract rows, 35 extensions with terms, 15 leagues;
54,143 timeline seasons) in **203-294 ms** per pass over three passes, the first including statement preparation.
That is cheap enough that phase 1 computes per request, for the players asked about, with no cache; the store in
this part is built when production and the price of a win (phases 2 and 3) make a pass expensive, and the choice
between lazy and warm-after-import is re-timed then. Counts on that pass: 8,009 players held by a club and 4,566
unsigned (no timeline; no club holds them); 6,954 had their contract regime read through the parent league. Next
season: 216 pre-arbitration, 197 arbitration, 120 free agents, 192 under contract, 60 option seasons and 7,224
`indeterminate`: 6,952 after a minor-league contract (what follows is not established from the export), 234 in the
Super Two window, 38 with the free-agency line inside this season's projection. Over every timeline season 42,889
of 54,143 are `indeterminate`: 41,712 after a minor-league contract, 683 in the Super Two window, 494 with the
free-agency line inside the projection. Against the old `controlAfterThisSeason` on the 1,057 major-league deals,
272 next-season answers became `indeterminate` (137 pre-arbitration and 97 arbitration in the Super Two window, 38
"leaving" with the line inside the projection); none changed from one definite status to another. The Trade
Center and the player card had read the rules of the player's own club's league, so 171 major-league deals held in
the minors read "reserve clause" from a minor league's zeros: R-2's error, live there. They now read the parent's
regime (66 pre-arbitration, 28 arbitration, 12 leaving, 65 `indeterminate`).

**After the owner's Super Two ruling** (same import): the projected cutoff at the end of 2026 is **469–478 days
(2.125–2.134 years.days)**, a class of 117–220 players with 26–48 qualifiers. The real world's estimate for 2026 is
2.130–2.134. Of the 234 next-season answers that the blanket window had left `indeterminate`, 104 are now
pre-arbitration (below the cutoff even if they stay up) and 130 stay `indeterminate`: each one's own service range
overlaps the cutoff, or he has not yet banked 86 days. On 2026-5-16 nobody has 86 days, so no one is yet certainly
a Super Two. Next-season `indeterminate` answers among the 1,057 major-league deals fall from 272 to 168 (130 Super
Two, 38 with the free-agency line inside the projection).

---

## Part 8 — Consumers and the migration

**Replace, don't run in parallel.** Each consumer migrates in the same change that deletes its `players_value`
reads. Until its phase, a surface may show facts only (contract, service, payroll) and drop its verdict, rather than
keep an invalid one. The order:

| # | Consumer | Reads today (`players_value` and around it) | Becomes |
|---|---|---|---|
| 1 | Contracts (`contracts.ts`) — **migrated, phase 6a** | Was: `valuesByPlayer`, `mlbPercentiler`; percentile cut-offs at 70/75 (`recommendOnValue`); `contractsByPlayer`. Now: none | Contract facts, control and cost path, production, surplus and our view, as built (below). The percentile advice deleted; `controlAfterThisSeason` stays as the timeline's reading of next season (hardening F2), no service arithmetic |
| 2 | Payroll (`payroll.ts`) — **on Player Value since phase 1 (facts, control) and 4a (projected cost); plain words, phase 6e** | Facts only; its control column comes from `controlAfterThisSeason` | The control timeline from concern 2, and club finances from concern 4 |
| 3 | Trade Center (`trade.ts`, `tradingblock.ts`, AI trade context) — **done (phase 6b, 2026-09-24; below)** | `analyze` summed raw `overall_value`; fits, trade talk, the roster picker, the trading block and the AI context read `overall_value`, `oa`/`pot` and value percentiles | Both sides' value decompositions side by side: each player's contract value and value of keeping him, control season by season with its cost, expected wins. The difference between the sides is shown as a band with its components (owner, Q-8), never as a point, a single score or a verdict. As built: `playerValueTrade.ts` (`tradeValueOf`), read by `trade.ts` and `tradingblock.ts`; fits and the trading block order by expected wins, shown; the AI context carries the decomposition and the desk gives no accept-or-reject line |
| 4 | Free Agents (`freeagents.ts`) — **migrated, phase 6c (2026-09-24; below)** | Was: `valuesByPlayer`, `mlbPercentiler` (Value and Talent percentiles, a 40th-percentile cut on who is listed, the order), `contractsByPlayer` (last salary), `rosterHoles` (OOTP's overall value). Now: none | Expected production and the market price; cost as the market's band. As built: each free agent's expected wins, his scouted tools and a season of his production at the market (`marketValueOf`: the minimum plus his wins × the price of a win in force), everyone reaching the market listed, ordered by expected wins; the thinnest positions by expected wins (`positionNeeds.ts`) |
| 5 | Org Comparison (`franchise.ts`) — **migrated, phase 6d** | Was: `players_value` joined directly (`overall_value` summed for the roster, `talent_value` for the farm and the under-22s, ranks by each). Now: none | Each club's record, the roster's expected wins for the rest of the season and its contract value, the farm's expected wins next season and its top contributor, OOTP's payroll and budget; each sum its players' served figures combined as independent, unknowns named; no rank (below) |
| 6 | Player card — **migrated, phase 6a** (`player.ts`); the roster's OA/POT (`api.ts`) and the lineup (`lineup.ts`) — **moved to `scoutedEvidence.ts`, phase 6d**; `valuation.ts` `rosterHoles` — **replaced, phase 6c** (`positionNeeds.ts`, expected wins) | The card: was Value and Talent percentiles, OA/POT from `players_value` and a direct `players_contract` query; now none. Others: `players_value` | The card's header: his contract in a phrase, the Value section's headline, his scouted tools through `scoutedEvidence.ts` (below). The others are classified in phase 6: a read that is not a value question (a lineup's quality of cover) moves to `scoutedEvidence.ts` under its owner, not to Player Value |

The end state: no production module reads `players_value`, `mlbPercentiler` and `VALUE_PERCENTILE_NOTE` are gone,
and the evidence boundary test's allow-list for `players_value` is empty. *Met in phase 6e (2026-09-24, below): the
allow-list is gone, and no server, client, script or desktop module names `players_value` or one of its figures.*

**The player card shows expected production (2026-09-23), ahead of its phase-6 migration.** An "Expected production"
section draws the production cone (`src/ProductionCone.tsx`, visx, D-054): wins per season with the 80% and 50% bands
as nested washes, the expected path as a dotted line with a marker per season, replacement level (0) as a labelled
dashed baseline, and each season's control beneath it (signed, an option, pre-arbitration, arbitration *n*, reserve,
not established, an opt-out, an extension, and "free agent after" on the last controlled season, naming the season
before too where the last may itself be free agency). Seasons run from this one to the last
controlled season, capped by the production horizon; where the end of control is not established (unsigned, unknown,
or past the horizon) the whole horizon is drawn and each season says so. The legend says what the bands are: with
the save's own fit in force, "80% band (target)", which each season's observed coverage qualifies; with the fallback
prior, "80% range of reasonable readings (not yet calibrated)", never "80% of outcomes fall inside" (hardening F2,
D-19). Hover or keyboard focus on a season shows its central and both bands, each band's
"target · observed" coverage ("not measured on this save" when the fit did not measure it, never the target), the
seasons and plate appearances or batters faced it rests on, playing time and control. One line under the chart states
calibration: "Calibrated on this save: 2006–2025, refit after the 2025 season", or "Not yet calibrated on this save
(N seasons)". Unknown production draws no cone and states the reason. A cone may narrow (a fading player's playing
time), and negative wins stay on the axis. The join is Player Value's (`playerValueCone.ts`, `productionCone`, served
at `/api/player-value/:playerId/cone`); the card computes nothing. The card's existing `players_value` reads (Value,
Talent) are untouched until phase 6. A static site export does not carry the route, so its cards omit the section.
The card is a modal dialog: focus moves into it, Tab stays inside it, Escape closes a season's detail first and
then the card, and focus returns to what opened it; it fits the window with a 16px gutter at any width, and below
552px the season detail sits under the chart. A figure the server sends that is not a number draws no cone and says
so, never blanking the card; near-zero wins print "<0.1", never "0.0" (hardening F2).

**The player card shows value (phase 5a, 2026-09-24), ahead of its phase-6 migration.** A "Value" section below the
production cone (`src/ValueSection.tsx`, the card's own type and tokens) shows the contract surplus and the retention
margin side by side, each with its central (or the range of its centrals where a season has none), its range, the seasons
it covers and "discounted", and a line saying what each view is; then, in a disclosure, the season-by-season table (wins,
price, cost, discount, contract surplus, retention margin, "rest of season" with its share, "if held") and the basis:
each unknown season's reason, each open season's named centrals, what is sunk, the price in force, the discount, one
level of replacement, the 40-man spot stated, the rules. An unknown sum says why and gives the known seasons apart; in
wins only it says dollars are unknown and why and shows his wins over a replacement's. It is served by
`/api/player-value/:playerId/surplus` and computes nothing. The card's existing header Value and Talent (`players_value`)
are untouched until phase 6, and no other consumer (Contracts, the Trade Center, Free Agents, Org Comparison) is
migrated. A static site export does not carry the route, so its cards omit the section.

**The Value section in plain words, our view and the club's value of a win (phase 5b, 2026-09-24).** The owner asked for
plain words with the explanation on hover (the `Tip` component, keyboard-reachable on the card): "Contract value" (the
API's contract surplus: "What he's worth beyond what he's paid") and "Value of keeping him" (the retention margin: "What
you'd give up by letting him go"), each "Most likely $X" (or "$X to $Y depending on the 2031 option") and "could be $A to
$B (2026–2030)", "if kept" for a season counted only if he is held, one short sentence where it is not valued ("Not valued
yet: his pay for 2026–2029 isn't known, and his production is only projected through 2029"), the reasons in the
"Season-by-season breakdown" whose headers each carry a hover, and what the figures rest on in plain sentences (the API's
precise basis stays in the API). Below the two figures, **our view** under the selected organization's philosophy ("Contract
value: $21.5M (neutral $28.0M)", then each lean as a short phrase with its amount and its sentence on hover, or "doesn't lean
on him"), and **this club's value of a win** as context ("A win right now moves the Arizona Diamondbacks' playoff odds by
about 3.9 points (now 75%)", on hover: context from the standings, not part of the value). Payroll shows the same line under
the price of a win. No old term ("central", "retention margin", "edge against edge") is in the section's visible text
(`valueSection.test.ts`).

**The card's header and Contracts on Player Value (phase 6a, as built, 2026-09-24).** Consumers 1 and 6 (the card)
migrated in one change that deleted their `players_value` reads (`player.ts` and `contracts.ts` name no
`valuesByPlayer`, `mlbPercentiler`, `contractsByPlayer`, `oaRating` or percentile; `playerValueBoundary.test.ts` and
`evidenceBoundary.test.ts` hold it, and the boundary's PENDING list is empty).

- *The card's header* (`src/PlayerHeaderValue.tsx`) shows three tiles and a date: **Contract** ("$18.7M in 2026",
  "Signed through 2028", then what happens after this season and when control ends: "Arbitration in 2027 · Free agent
  after 2028 or 2029", options and no-trade where the export records them, "Some terms not in the export" with the
  unpopulated flags on hover); **Contract value** (the Value section's headline, "Most likely $X" and "could be $A to $B
  (2026–2030)", or the range of its most likely readings where a season has no single one, or "Not valued yet" with the
  reason on hover; in a league without dollars, "Wins above replacement"); **Scouted** (his scouted tools averaged now →
  at their ceiling, 20–80, from `scoutedEvidence.ts`; a missing grade reads "not scouted", never a stand-in); and "As of
  May 16, 2026", with a warning where the export is behind the save or could not be checked. The Value and Talent
  percentiles and OOTP's Overall / Potential are gone from the card and its hover (fog of war: nothing establishes they
  are the organization's view; the Roster's OA/POT column is consumer 6's, migrated in phase 6d). The totals are the ones the
  Value section is served, from the same valuation read with the same freshness. The card's contract table reads the
  contract facts: a salary the export does not state is "not in the export", never $0.
- *Contracts* (`server/contracts.ts` `computeContracts`, `src/pages/Contracts.tsx`) lists the club's rostered players
  (every one: a blank contract row is shown as "no terms", not dropped) in groups in the order a GM works through them:
  free agents after this season, options, arbitration, pre-arbitration, reserve clause, not settled, signed short term,
  long-term deals (three seasons or more). The columns, each sortable from the keyboard with its explanation on hover:
  this season's salary, signed through (with options and clauses), service, free agent after (`controlEndOf`: the
  cone's own reading of when control ends, "2028 or 2029" where the later season may itself be free agency, "2031 or
  later" where the last seasons laid out may each be, "past 2032"), with next season's status under it; next season's
  cost (most likely over its range, "if kept", "—" for a free agent); next season's wins; contract value; keeping him;
  and our view (the lens under the club's philosophy, "same" where it leans on nothing, the leans on hover). An unknown
  is a short word with its reason on hover and sorts after every known figure in either direction. A row opens the card;
  its disclosure shows his seasons under control (status, cost and wins each season) and what the figures rest on. Group
  chips, a pitchers / position players filter and a name search filter the table; it scrolls in its own box. No
  recommendation of any kind: `recommendOnValue`, the 70/75 cut-offs, the "Hold off" veto and the dashboard's
  "Extension candidates" count are deleted (the dashboard counts "Heading to arbitration" instead); the briefing, the
  storylines and the chat read the same rows, told they carry no recommendation. `controlAfterThisSeason`,
  `seasonCost` and the finance cards stay (Payroll, Free Agents and the Trade Center read them).
- *A-20, for these routes.* `freshnessCue` (`server/dataStatus.ts`) states the export's game date and its freshness
  against the save; Contracts, the card's route and the one-player value routes (`/api/player-value/:id`, `/cone`,
  `/surplus`, `/our-view`) hand that state to Player Value as `currentState`, so a stale export leaves service,
  control and what rests on them not established, on the page and the card alike, and Player Rights' unverified
  limitation reaches the GM in the date's hover. Payroll, Free Agents and the Trade Center read with the default
  (`unverified`) until their own migration; on a current export their figures are identical. *Since phase 6c they pass
  the export's freshness too (below).*

**The Trade Center reads Player Value (phase 6b, 2026-09-24).** `server/playerValueTrade.ts` (pure, `tradeValueOf`) is handed
each player's neutral valuation exactly as every read serves it and, where the caller has one, our view of him; it returns
both sides' decompositions, each side's total and the difference between the sides. `trade.ts` (`analyzeTrade`, `POST
/api/trade/analyze`) resolves the viewing club (the organization the page names, else the configured one, else the managed
club), reads its philosophy from settings at read time and hands the lens's view beside the neutral figures. The rules:

- **The trade view is contract value.** A trade moves each player's remaining salary with him, so the sides are summed on
  contract value (the contract surplus, Part 5: what his contract is worth to whoever holds it). The value of keeping him is
  shown on each row and never summed: its guaranteed money cancels only for the club that already owes it. Each player's
  figures are the card's, never recomputed, narrowed or re-read.
- **Players combined as independent** (`TRADE_COMBINATION_POLICY`, policy, the owner's Payroll rule of 2026-09-24 extended
  here by the supervisor and confirmed by the owner, 2026-09-24, Part 12): around the sum of the players' most likely readings, each
  player's own distance from his on each side in root sum of squares; an open season (an option's ways, a status Player
  Rights leaves open, whether he stays) keeps his most likely a range and stays at its edges, added. The every-player-at-his-
  edge sum is kept beside every figure; one player's side is his own band exactly. The price of a win, shared by every player
  on both sides, is read as independent too (its common part partly cancels in the difference, which the reading does not
  credit), so the range is a reading, not a coverage claim.
- **The difference is what comes in less what goes out**, a player going out entering with his figure reversed (his high
  edge lowers the difference's low edge): most likely (or the range of its readings) with the range it could be, each
  player's signed part named, never a point, a single score or a verdict. **Unknown stays unknown:** a player whose value is
  not known is listed with one short reason and left out of the sums, which name him; a side with no player valued has no
  total and the difference is not a number, never a zero. A deal with a player valued in wins only is read in wins
  throughout.
- **Context, never a figure:** the viewing club's value of a win (then the other clubs in the deal), salary this season on
  each side (a salary the export does not state is named, never $0).
- **The page** (`src/TradeAnalysis.tsx`, `src/pages/TradeCenter.tsx`): the two sides side by side, each player a compact row
  (name, position, age, club; contract value most likely and "could be"; his control in a line with each season's cost on
  hover; his expected wins; keeping him; our view where it leans), each side's total ("Together"), then "The difference ·
  Coming in less going out" with a bar around zero (visx, D-054; the range as a wash, the most likely as a marker or a darker
  stretch, zero dashed, "More going out" and "More coming in" at the ends, a hover saying what it is and is not, a visually
  hidden table), the players' parts in a disclosure, our view, salary and the clubs' value of a win. The deal is weighed as
  it is built; empty, one-side, loading and error states are designed; the rows and figures are keyboard-reachable; no
  jargon or verdict word is in the visible text (`tradeCenter.test.ts`). Offers on the table and trade talk read the same
  analysis (the difference line; a target's contract value and control), never a percentile.
- **Trade fits** read expected wins this season (the part still to be played, most likely): a club's three weakest positions
  by its best player's figure, and a match where a player who is not his club's starter is expected to add more than the
  other club's best there, both figures shown; the clubs are ordered by the count of matches, a shown number. **The trading
  block** carries each player's contract value (or its reason), his expected wins and his control, ordered by expected wins
  (shown, unknown last, never zero), and says so (`order`). **The AI's trade context** carries each player's `value` (contract
  value, keeping him, our view), `expectedWins` and `control` (text and cost path), and the deal's `value` (both sides, the
  difference with its parts and what it leaves out); the desk is told to quote these as ranges, never to produce a value
  number of its own, and to give no accept-or-reject line (its opening answer is a one-line "Read", D-001, D-004). Deleted:
  `trade.ts` and `tradingblock.ts` read no `players_value`, `valuesByPlayer`, `mlbPercentiler`, OOTP rating or percentile;
  the trade desk's prompt no longer carries `VALUE_PERCENTILE_NOTE`; the evidence boundary's `players_value` allow-list is
  `valuation.ts` and `franchise.ts`.

**Free Agents and the AI's value context on Player Value (phase 6c, as built, 2026-09-24).** Consumer 4 and the AI's
value context migrated in one change that deleted their reads: `freeagents.ts`, `rosterops.ts`, `ai.ts` and `chat.ts` name
no `valuesByPlayer`, `mlbPercentiler`, `contractsByPlayer`, percentile or percentile note; `valuation.ts`'s `rosterHoles`
and the note are deleted. `valuesByPlayer` and `mlbPercentiler` stay in `valuation.ts` for `api.ts` and `lineup.ts`, which
migrate separately (phase 6d), and go in the final cleanup (the evidence boundary's indirect-reader list is `valuation.ts`,
`api.ts`, `lineup.ts`).

- **What a free agent's value means.** A player no club holds has no contract and no control: no contract value and no
  value of keeping him (his surplus is `not_held`). What can be said, and what a GM weighing a signing needs, is what the
  market pays for the play he is expected to give: **one season of production value**, the same figure the contract value
  is built on (5.1), the league minimum (what a replacement at 0 WAR costs, the price's own zero) plus his expected wins ×
  the price of a win in force, held flat, edge against edge, its central from the components' centrals, undiscounted
  (`marketValueOf`, pure, in `playerValueSurplus.ts`; the league's market through `surplusMarketOf`, the same market every
  held player's contract value is read in). Free Agents shows it for **next season**, the first season a signing covers in
  full, for both lists; the rest of this season is shown as his expected wins only. It is not an asking price, an offer or
  his worth to any one club (none of those is in the export), and the page's hover says so in one plain paragraph ("What
  this league's market pays for a season of his expected play in 2027: the league minimum plus his projected wins × what a
  win costs here…"). Production value against the minimum was chosen over wins × price alone because it is what the price
  itself measures (salary above the minimum per win) and what the card's contract value already uses, so a free agent's
  figure and a held player's production value are the same arithmetic; a low edge below the minimum is shown, not clamped
  (his expected play may be below a replacement's). Unknown production, or a league with no price or minimum, leaves it
  "not known" with the reason, never $0; in a league without dollars it is not known and says why.
- **The page** (`src/pages/FreeAgents.tsx`, types in `src/freeAgentsApi.ts`) follows Contracts: the finance cards; "Free
  agents" with the export's date (`FreshnessCueLine`); one line saying what the figures are and what a win costs here (the
  price on hover); the club's thinnest positions with each best player and his expected wins; two chips, "Available now"
  and "Free agents after 2026", switching one table; filters for pitchers or position players, position, age (27 and under,
  28 to 31, 32 and over), "only our thin spots" and a name search, with a count and "Show everyone"; a table scrolling in
  its own box, each header a keyboard-reachable sort button with its explanation on hover: player (position, club, a "Thin
  spot" tag with its reason on hover), age, scouted (now → ceiling, the organization's grades through `scoutedEvidence.ts`,
  "not scouted" where a grade is missing), this season's wins, next season's wins, next season at the market, and for the
  second list his salary this season. An unknown is "not known" with its reason on hover and sorts after every known figure
  in either direction; the default order is the server's (expected wins next season, most first, not known last), said
  under the table. Players whose reaching the market could go either way, or who have an option or opt-out next season,
  are counted in one line with the reason on hover (*since phase 6e those free agency is open for are listed instead, as a
  third chip, "Might reach the market", below*). Loading, empty ("No free agents are available in this league right
  now."), no-match and error (with "Try again") states are designed. No percentile, no signing advice and no method word is
  in the visible text (`freeAgents.test.ts`).
- **No hidden cut, no hidden score.** Every player the control timeline finds reaching free agency after this season is
  listed (the old page kept those above OOTP's 40th value percentile, capped at 80); both lists are ordered by expected wins
  next season, a shown figure. **The thinnest positions** (`server/positionNeeds.ts`, `positionNeeds`) are each fielding
  position's best major-league player by his expected wins for the rest of this season, most likely, each figure shown,
  thinnest first; a position with nobody valued (nobody listed there, or no one whose production is established) is named
  apart and never read as zero. One reading for Free Agents, the draft board (its "thinnest spots", which now sends each
  position's best player instead of OOTP's value) and the trade desk's `clubNeeds`; the Trade Center's fits share its
  depth and weakest-position helpers.
- **The AI's value context.** The prompts' note on OOTP's value percentiles is deleted (no context carries a percentile
  any more); the briefing (`briefingSystem`) and the staff chat (`systemPrompt`) carry one plain note instead: Pennant's
  value figures are its own readings, most likely with a range, a null is not known; quote them as ranges, never produce a
  value number of your own, and they recommend nothing (D-001, D-052). The free-agents tool describes its figures and hands
  the model each list in its stated order, trimmed to 40 with "shown" saying how many of how many. The briefing's context
  and the trade desk's carry the export's date and warning (`dataFreshness`). The roster tool (`get_roster`) still carries
  the roster's OA/POT until `api.ts` migrates (6d).
- **A-20 on Payroll, Free Agents and the Trade Center.** `computePayroll`, `computeFreeAgents` and `analyzeTrade` take the
  data status (default: read now), hand its freshness to Player Value as `currentState` and return it with Player Rights'
  limitations; each page shows "As of May 16, 2026" and the warning in the same component (`src/FreshnessCue.tsx`), on
  Payroll above the finance cards and on the Trade Center beside "The difference". The trade fits and the trade desk read
  with the same state. On a current export every figure is the one the league-wide read serves.

**The Roster's scouting column, the Lineup and Org Comparison (phase 6d, as built, 2026-09-24).** Consumer 5 and the rest of
consumer 6 migrated in one change that deleted their `players_value` reads: `api.ts` and `lineup.ts` no longer call
`valuesByPlayer`, and `franchise.ts` no longer joins `players_value` (`evidenceBoundary.test.ts`: the direct allow-list is
`valuation.ts` alone, the indirect one `valuation.ts` and `freeagents.ts`, and `lineup.ts` joins the guarded modules;
`playerValueBoundary.test.ts`: `franchise.ts` a migrated consumer, the three pages free of OOTP's figures).

- *The Roster's scouting column* (`/api/roster/:teamId`, `src/pages/Roster.tsx`) is not a value question, so it reads
  `scoutedEvidence.ts`, not Player Value: "Scouted", the scouts' tools averaged now → at their ceiling on the 20–80 scale,
  the card header's figure (`scouted: { now, ceiling, status, missing }`); a tool not graded leaves its side "not scouted",
  never OOTP's Overall or Potential in its place. Sorted by it, a player not scouted comes after every scouted one either
  way. `TIP_OA` (`src/playerModal.tsx`) says what it is, what it leaves out (defence, speed, stamina) and that it sits on one
  major-league scale. The rating bars beside it still read the rating columns directly, outside the adapter (found, not
  fixed here; measured in phase 6e and left as an owner question, Part 9).
- *The Lineup* (`lineup.ts`, MLB Operations territory) changed its evidence source and not its solver. The bat against a
  hand was OOTP's `offensive_value_vsr / _vsl`; it is now the calibrated tools model (`toolsModel.ts`) on his split grades
  against that hand (D-035), his overall grades where the export has no split grades (`batBasis: 'overall'`, said on the
  card), in tenths of a point of wOBA (`BAT_POINTS_PER_WOBA`, a unit: on the Arizona import the major-league bats' spread,
  19.6 wOBA points, is a tenth of OOTP's 196, the two readings correlating at 0.94), so `DEF_POINTS_PER_RATING`, the
  half-point tie-break, `chooseFielders`, the slot rules and the run search are untouched. Gloves are `scoutedGloves` (the
  revealed grade, the same visibility rule as before, and 20–80 on every display scale); contact, power, eye and speed come
  from the adapter's profiles and a grade not given is passed over for a traditional slot rather than read as zero. A hitter
  with no graded bat is named ("Not scouted"), kept off the ranking and used only to fill a position nobody graded is left
  to play. The card shows "Bat vs RHP/LHP" in wOBA points above the league's major-league hitters. The before/after diff
  on every club is in Part 9.
- *Org Comparison* (`franchise.ts` `computeOrgComparison`, `/api/org-comparison/:orgId`, `src/pages/OrgComparison.tsx`)
  shows every major-league club of the viewer's league side by side: the record; **Roster, rest of the season** (the
  rostered players' expected wins, the part of this season still to be played, or the whole season before it starts);
  **Farm, next season** (the organization's players on its affiliates, their expected wins next season, arrival included)
  with its top contributor named with his figure; **Contract value** of the roster (each player's card figure, summed by
  the Trade Center's side total, `tradeValueOf`); **Payroll** and budget as Club Finances reads them (unknown, never $0);
  and the players on the roster and the farm. Each wins sum is `groupWinsOf` (pure, `playerValueTrade.ts`): around the sum
  of the players' most likely wins, each player's own distance combined as independent (`TRADE_COMBINATION_POLICY`, the
  owner's Payroll rule), the every-player-at-his-edge sum beside it; a player whose figure is unknown is named with one
  short reason and left out, and the sum says so ("N not counted" on the page, the names on hover). No rank is computed or
  sent; the table starts in club order and sorts by any shown column from the keyboard, unknown last either way; the
  viewer's club is highlighted and its four figures sit above the table beside the league's middle club (a median, each
  edge of a range of readings on its own; never a place, and never a midpoint made up inside a range). The export's freshness is handed to Player Value as `currentState` and said with the game date (A-20). The
  page talks in plain words (`orgComparison.test.ts`), with designed loading, empty and error states, and the table scrolls
  in its own box.

**The cleanup, Payroll in plain words and "Might reach the market" (phase 6e, as built, 2026-09-24).**

- *The last readers go.* `valuation.ts`'s `valuesByPlayer` (with its `PlayerValue` type), `mlbPercentiler` (with its
  percentile type and pools), the unused `contractsByPlayer` / `ContractInfo`, the unused `ROLE_STARTER` and their caches
  (`clearValuationCaches`, and its callers) are deleted, with `percentilePool.test.ts`, which tested only them.
  `evidenceBoundary.test.ts` holds no allow-list: no server module reads `players_value` or names `valuesByPlayer` /
  `mlbPercentiler`, and no module under `src/`, `scripts/` or `electron/` names a `players_value` figure (overall or talent
  value, `oa_rating` / `pot_rating`, `oaRating` / `potRating`) or a percentile of one. A module that starts is a failure,
  never an addition. Plain `pot` on the draft board and depth chart is the scouts' composite (`scoutedEvidence.ts`), not
  OOTP's.
- *Payroll in plain words* (`src/pages/Payroll.tsx`, now a pure `PayrollView` the tests render from the routes;
  `payrollPage.test.ts`). Every figure stays; the method words move to hovers and breakdowns:

  | Was (visible) | Now (visible) | Where the basis went |
  |---|---|---|
  | "Price of a win (opening: the imported market): **$7.25M** a win (band $6.57M–$9.78M); floor $4.22M–$4.33M" | "**A win costs about $7.25M here** · could be $6.57M to $9.78M" | The server's label, the floor ("$4.22M to $4.33M, a floor under the price") and its note on the hover; every basis in "How it's measured" |
  | "Controlled seasons: pre-arbitration renewal $780K–$790K (measured, 249 renewals); arbitration ladder measured (class 1: 74, class 2: 51, class 3: 47 contracts)" | "What a season the club controls costs: a renewal costs **$780K to $790K** (249 renewals this season) · an arbitration year is read from 172 contracts (74 in the 1st year, 51 in the 2nd year, 47 in the 3rd year)" | Measured or provisional, and each class's line, on the hovers of "a renewal" and "an arbitration year"; the rules in "How they're priced" |
  | "+$16.4M–$49.0M range (players combined as independent; not a calibrated interval), central $22.7M–$29.7M (16, 2 if held)" | "+ most likely $22.7M to $29.7M · could be $16.4M to $49.0M (16 players, 2 if kept)" | The owner's label, the method and the combination's own text on the hover of "most likely"; the edge-to-edge sum in the breakdown |
  | "The range beside each season is what pre-arbitration and arbitration seasons could cost (players combined as independent; …); a range of reasonable readings, not a forecast…" | "Beside each season is what the players you still control could cost: most likely, and the range it could be. It's never added to the total or the room." | `PROJECTED_TIP` on the hover |
  | "Every player at his edge, summed (edge against edge)" | "If every player landed at the same end of his range" | The breakdown's lines keep "edge against edge" and the counts |
  | "arb 1-2", "arb (Super Two)", "pre-arb", "reserve" | "arbitration, year 1 or 2", "arbitration (Super Two)", "pre-arbitration", "reserve clause" | — |
  | "→ $A–$B if held" (a mini-table cell, basis in `title`) | "→ $X if kept" over "$A to $B" | Most likely, the range's meaning, "if kept" and the timeline's basis on the hover |
  | "arbitration or leaving" | "arbitration or free agency" | The reason on hover |
  | "opt $X" / "or $A–$B" | "option $X" / "or $Y if declined" | Both branches on the hover |
  | A season cell "$A–$B if held" | "$X if kept" over "$A to $B" | As above |
  | "Dead money — not established" and the note in full, naming "(R-6)" | "Dead money — not known"; "Retained salary isn't in the export" | The note on the hover |
  | "N salaries not exported" / "N not priced" | "N salaries not in the export" / "N not priced yet" | — |

  The card's production cone says its bands and calibration the same way: "80% range (target)" / "50% range (target)" with
  the save's fit, "80% range (not yet checked on this save)" / "50% range" without it, "Checked against this save's own
  seasons" / "Not yet checked against this save's own seasons" under the chart, the method's words ("a range of reasonable
  readings, not yet calibrated", the calibration statement itself) on hover; its season detail and its table for screen
  readers say "range", "most likely" and "if kept". On the Arizona import no method word remains in the visible text of
  Contracts, Free Agents (all three lists), Org Comparison, the Trade Center, Payroll, or the card's header, Value section
  and cone; the cone's axis keeps its short control codes ("Arb 2–3"), spelled out in the key beneath it.
- *The trading block reads on the export's freshness* (`tradingBlock(opts, status)`), as the Trade Center does: Player Value
  is handed it as `currentState`, and the block returns it with Player Rights' limitations for the assistants.
- *Might reach the market* (the owner's answer, Part 12). Free Agents' third chip lists every major leaguer elsewhere whom
  the control timeline leaves between staying and free agency after this season (`marketOpenness` in `freeagents.ts`, read
  from `controlAfterThisSeason`): an option or opt-out whose declined branch is, or may be, free agency ("Club option",
  "Player option", "Can opt out" …) and a next season not settled that may be free agency ("Close to free agency" where it
  lies between arbitration and free agency, "Not settled" where the export names nothing), the timeline's reason on hover,
  the same columns (with this season's salary) and order as the other lists, unknown last, never in "Free agents after
  2026" and never a verdict. A player the club keeps whichever way an open question goes (between pre-arbitration and
  arbitration, an option declined into arbitration) is not listed. The staff chat's free-agents tool carries the list,
  trimmed like the others. On the Arizona import (current): 101 free agents after 2026, 222 might reach the market (47
  options or opt-outs declined into free agency, 5 declined into a season not settled, 28 close to free agency and 142 not
  settled, most of them a blank contract row the export does not explain), and 124 open questions that stay with the club
  either way (112 in the Super Two window, 12 options or opt-outs declined into arbitration or renewal) are not listed.
- *The briefing points, it does not instruct.* Its last heading is "Worth a look this week" (was "Recommendation of the
  Week"), and the prompt asks for one thing worth the GM's attention and why, worded as something to look at, never as an
  instruction or a decision made for him (D-001).
- *Hovers near the bottom of a scrolling table open upward.* A table in `.contracts-table-scroll` (Contracts, Free Agents,
  Org Comparison) or `.payroll-table-scroll` scrolls sideways, so its box clips anything below it; on the last four rows a
  hover opens above its row (CSS only, `tableHovers.test.ts`). Its colours are the popup's own tokens in both themes.

**Consumers read the timeline as it is (hardening F2, 2026-09-23).** `controlAfterThisSeason` reports an option or
opt-out next season as `option`, with whose decision it is and where he falls if it is declined, never "signed";
"extended" only when next season is the extension's; a player whose control ends this season is leaving. The AI
prompts say what `option` means. **Payroll** reads Player Value's contract facts through `payrollValuations`, not
raw columns: where the export does not populate `retained`, dead money is "not established" (with the contracts the
club is of record for), never $0; a club, vesting or mutual option season is counted apart from committed money
(a player option or opt-out season is committed, flagged); a covered salary the export does not state is "?", never
$0; the season is the league's, never the wall-clock year; the price of a win shows its floor as a range, the
server's label and its basis as a keyboard-reachable list. **Contracts** shows service as years.days. **Free Agents**
asks the timeline about every major leaguer elsewhere and counts option seasons as undecided. Both pages' finance
cards are Club Finances' figures, a missing one "unknown", never $0.

---

## Part 9 — Phases and exit criteria

| Phase | Builds | Exit criteria |
|---|---|---|
| **0** (this document) | Design, research, D-052, behavior cases | Done: the owner accepted D-052 and answered Q-1 to Q-10 (Part 12) |
| **1** Contract facts and control — **done** (2026-09-22; evidence in Part 7 and below) | Concerns 1 and 2. Arbitration and free-agency eligibility added to `playerRights.ts` (Q-1). **One `LeagueRules`** (merge `valuation.ts`'s into `leagueRules.ts`'s `Sourced` form: every column guarded, no 6/3 fallback, service-year length from `rules_min_service_days`, the regime through `parent_league_id`). Missing service time is `unknown`, never 0. `controlAfterThisSeason` replaced in place. The boundary test (Part 10). A timed league-wide compute | Every active player has a control timeline, with every `indeterminate` counted and its reason named. Payroll's control column reads it. The boundary test passes. The full-league time is recorded here. Player Value has an `AGENTS.md` routing row and a Claude rule (Q-10). `tsc`, `npm test` and the build are clean |
| **2** Club Finances and the opening price — **done** (2026-09-22; evidence in 2.4, 4.1, 4.3, Part 7 and below) | Concern 4. The per-import market snapshot in `history.db`. The opening price of a win and the replacement level with their bases | This save's opening price reproduces R-5's band from code. A snapshot is written once per import key. A league without financials yields wins and dollars `unknown`. No timer |
| **3a** Expected production from results — **done** (2026-09-22; evidence below, Part 7, CALIBRATION.md section 6) | Concern 3 for players with a major-league record, in wins, an 80% and a 50% band per season (Part 2.3). Calibrated per save (D-053): the fit and its backtest, the fit store, the refit after an import, the gate, the provisional prior. Injury proneness read as a known fact and its effect measured | A fit is recorded with its run record and adopted through the gate. The band invariants (Behavior cases) pass. Held-out coverage is reported per horizon for both bands. The timing is recorded |
| **3b** Expected production from ratings — **done** (2026-09-23; evidence below, Part 7, CALIBRATION.md section 6) | Ratings through `scoutedEvidence.ts` for prospects and players with thin or no major-league results, partial-rating widening, a prospect's low edge including producing nothing. Also (supervisor, 2026-09-23): playing time conditional on quality | The 3b behavior cases pass. Removing a rating never narrows a band; no ability evidence leaves that component `unknown` |
| **4a** The cost of controlled seasons — **done** (2026-09-23; evidence below, 2.2, 4.4, CALIBRATION.md section 8) | The pre-arbitration renewal band and the arbitration ladder measured on each import from the save's own contracts (status and class from Player Rights), priced into every controlled season with the platform seasons' production and the price of a win; the provisional prior below the policy minimum where the regime is MLB's; the ladder in the market snapshot. Payroll, Contracts and the card show the bands | Every pre-arbitration, arbitration and open season is priced or says why. An arbitration season is never assumed to cost the minimum and is never a point (review: every priced band has a central, a thin class no line of its own); a league without arbitration never gets MLB's ladder; thinner evidence never narrows; committed payroll never includes a projected salary |
| **4b** Measured price and observed awards — **done** (2026-09-23; evidence below, 4.2 to 4.4, CALIBRATION.md section 9) | Observed signings and arbitration awards across imports. The measured price replaces the opening one once its band is narrower (Q-4). Observed awards test and then measure the ladder; reserve-clause renewals are measured. Replacement is measured from freely available talent | On an off-season import, signings and awards are identified and counted. While the measured band is still wider, the opening price stays and says why. The price history is visible |
| **5a** Neutral surplus and the retention margin — **done** (2026-09-24; evidence below and 5.1) | Concern 5: Part 5's two views, season by season with every component, the owner's 5% discount, one level of replacement on both sides; the card's Value section; the invariants for the card and the league-wide read | The surplus and invariant behavior cases pass; sunk money never raises the retention margin on any player of the save; one valuation whichever read asks; the boundary test passes |
| **5b** The lens and the win curve — **done** (2026-09-24; evidence below, 4.5 and 6.1) | Part 6's lens, Part 4.5's club value of a win | The lens cases pass. Neutral value is identical under every philosophy. Every lean is named |
| **6** Consumer migration — **done** (2026-09-24: 6a the player card's header and Contracts; 6b the Trade Center; 6c Free Agents and the AI's value context; 6d Org Comparison, the Roster's scouting column and the Lineup; 6e the cleanup, Part 8) | Part 8, in order, one consumer per change | Each change deletes that consumer's `players_value` reads. Finally, the `players_value` allow-list is empty (met in 6e: it is gone). 6a: `player.ts` and `contracts.ts` read none; the boundary's PENDING list is empty; A-20 met for their routes; the sweep's Contracts and card checks pass on the Arizona import (Part 9, below) |
| **6b** The Trade Center — **done** (2026-09-24; evidence below and Part 8) | Consumer 3: the trade analysis, trade fits, offers and trade talk, the trading block and the AI's trade context on Player Value; the difference between the sides as a band with its parts (Q-8) | `trade.ts` and `tradingblock.ts` read no `players_value`; the difference band contains its most likely; an unknown player is named and changes no known sum; the neutral reading is the same under every philosophy and for every viewer |
| **6c** Free Agents and the AI's value context — **done** (2026-09-24; evidence below and Part 8) | Consumer 4, the club's thinnest positions (`rosterHoles` → `positionNeeds.ts`) and the AI's value context on Player Value; a free agent's production at the market (`marketValueOf`); A-20 on Payroll, Free Agents and the Trade Center | `freeagents.ts`, `rosterops.ts`, `ai.ts` and `chat.ts` read no `players_value` figure or percentile; every listed free agent's wins are production's and his market figure the entry point's; unknowns last; the GM told how current the export is on the three pages |
| **6d** The Roster's scouting column, the Lineup and Org Comparison — **done** (2026-09-24; evidence below and Part 8) | Consumer 5 and the rest of consumer 6: the Roster shows the scouts' view; the lineup reads every rating through `scoutedEvidence.ts`; Org Comparison on Player Value and objective facts, no hidden score | `api.ts`, `lineup.ts` and `franchise.ts` read no `players_value`; the lineup's choices unchanged where the evidence is the same, every other difference explained; every club's sums equal its players' served figures, unknowns named |
| **6e** The cleanup — **done** (2026-09-24; evidence below and Part 8) | `valuation.ts`'s readers deleted and the allow-list emptied; Payroll (and the card's cone) in plain words; the trading block on the export's freshness; the owner's answers on 6a to 6d, with "Might reach the market" and "Worth a look this week" built | No server, client, script or desktop module reads `players_value`; Payroll's visible text carries no method word and keeps every figure, its basis in the hovers and breakdowns; the listed "might reach" players are exactly those the timeline leaves free agency open for |

**Phase 6a exit criteria, as met (2026-09-24).** `player.ts` and `contracts.ts` read no `players_value` figure and no
contract row of their own (`playerValueBoundary.test.ts`: the phase-6 migrated consumers, the pages' sources and the
empty PENDING list; `evidenceBoundary.test.ts`: the `valuesByPlayer`/`mlbPercentiler` readers only shrink). The
full-save sweep on the Arizona import (read-only) ran every club's Contracts page and 50 cards: 30 pages and 901 rows,
2,963 seasons on the rows' paths, every row's contract value, keeping him and wins equal to the league-wide read's
totals, next season's cost and every path season's cost equal to the timeline's, wins equal to production's, control's
end equal to the timeline's (never guessed), our view equal to the lens under each club's philosophy, no verdict word
in any payload, every rostered player listed; each card's header equal to its Value section, no `players_value` figure,
the scouted figure on the 20–80 scale or unknown (200 checks, none failing; the 180 of phase 5b unchanged). A club's
page takes about 220 ms (the first about 600 ms); the card's route and its Value section's together about 230 ms a
player. `tsc`, `npm test`, the build and the desktop build are clean.

**Phase 1 exit criteria, as met.** Every active player has a control timeline (8,009 laid out, 4,566 unsigned with
none), every `indeterminate` counted with its reason (Part 7). Payroll's control column and lists read it
(`controlAfterThisSeason` in `contracts.ts` now reads the timeline; `SERVICE_DAYS_PER_YEAR` is gone). One
`LeagueRules` in `leagueRules.ts`, every column guarded, the regime through `parent_league_id`; `valuation.ts`'s
duplicate is deleted and every caller migrated (Contracts, Payroll, the Trade Center, the player card, the AI rules
briefing, Free Agents). `tests/playerValueBoundary.test.ts` passes, with `playerValueControl.test.ts` and the phase-1
half of `playerValueCost.test.ts`. The full-league time is in Part 7. `AGENTS.md` routes Player Value and
`.claude/rules/player-value.md` exists. `tsc`, `npm test` and the build are clean.

Judgments made in phase 1 beyond the text above: consumers that hold no freshness reading pass `unverified`, so
their answers stand with that limitation (a stale export still makes eligibility `indeterminate`, D-023); a minor-league
contract is held for this season at an unknown cost and what follows it is `indeterminate`; a vesting option is its
own status beside club and player options; an unsigned player has no timeline rather than a `free_agent` season.

**Phase 4b exit criteria, as met (2026-09-23).** The behavior cases (BEHAVIOR_CASES.md "Player Value", phase 4b) are in
`playerValueSignings.test.ts` (25: observed changes, the estimator, adoption, awards, reserve-clause renewals,
replacement), `playerValueCrossSave.test.ts` (9 multi-import sequences through `advanceWinter`), `playerValueFinances.test.ts`
(2), `playerCard.test.ts` (1, Payroll's price line) and `playerValueBoundary.test.ts` (the two new modules, the third
writer, the new stamp, Player Rights' answers only and no transaction type the export does not carry). Each was run
before the code and failed for the reason expected (no `playerValueSignings` or `playerValueContractStore` module, no
`priceHistory`, no price-history list on Payroll, the module list, the writers and the stamps).
**On an off-season import, signings and awards are identified and counted:** on a synthetic off-season (16 clubs), 197
free-agent signings, 2 free agents re-signed by their club (left out), 7 arbitration salaries (7 of 7 inside the band the
earlier import priced), 2 at the minimum, 2 controlled players no club holds, 2 extensions, 9 renewals and 1 contract
that moved on the same terms, each named for what changed. **While the measured band is still wider, the opening price
stays and says why:** 21 signings at wild prices gave a measured band $12.72M–$25.28M against the opening $5.67M–$11.40M
with its sampling, and the opening stayed; 115 one-year signings at $4.0M a win gave $3.99M–$4.01M, narrower, and the
measured price took over; 12 signings were not measured. **The price history is visible:** every import's opening and
measured reading and which was in force, on Payroll's price line and through `/api/club-finances/:orgId/price-history`.
**On the Arizona save** (one import): no off-season is observed and every 4b reading says so; the opening price is
unchanged. The regression sweep passes 99 of 99 checks (4a's 81 and 18 for 4b: the snapshot written once per key, the
store's rows, the honest no-off-season state, the opening price unchanged, the sampling band holding the served one, the
history and both routes).

Judgments made in phase 4b beyond the brief: a free agent re-signed by the club that held him is left out of the price
(the export cannot say whether he reached the market first); a signing's price covers the deal's seasons whose
production was established at the earlier import, not only its first; a deal starting in a season under way at the
earlier import is left out; the adoption comparison is in dollars against the opening band with its sampling (the
served opening band is unchanged); pooled winters are not deflated (the history shows drift); observed awards join the
cross-section as a second reading of the class (a hull), not a replacement of it; replacement, once measured, enters
the measured price only, with production left in the export's WAR for phase 5 to apply; a reserve-clause renewal is
measured by the pre-arbitration renewal spread's method; the contract snapshot keeps a minor-league deal's terms only.

**Phase 4b review (2026-09-24).** Two reviews (correctness R3, method R4) were fixed before 4b merged; the behavior cases
are the "phase 4b review" row, each written first and failing on `feature/player-value-phase-4b` (cf27c0f) for the reason
expected (23 unit cases in `playerValueSignings.test.ts`, 10 multi-import sequences in `playerValueCrossSave.test.ts`, 1
in `playerCard.test.ts`; the output is kept with the review notes). What changed: a winter is read by the calendar and
counted once (R3-01, R3-11, R4-12; a sequence of five imports across one winter, two of them after the season number moved
on, sees all 132 signings as market prices and one winter, where the pair after the bump had been read as no winter and its signings as "already under way", R3's probe); an extension
that moves with a traded player and a deadline acquisition re-signed are never market prices (R3-02, R3-04); a term
changed within its seasons, rows with no term and a call-up from one are named for what the export shows (R3-09); two
timelines are never compared (R3-05); recording an import reads one earlier import and stores the pair it forms (R3-03:
with 29 earlier imports on the Arizona scratch copy, 3.65 s before (every snapshot loaded, 217 MB of them by R3's count),
2.43 s after (one snapshot loaded), the same time as with one earlier import; the market reads its stored pairs in 0.42 s against 0.82 s); the measured price is a set of bases
read like the opening price, compared only when it holds the realized reading and covers the class, its central in the
opening's unit (R4-01 to R4-03, R4-05, R4-07, R4-09, R4-11); an unbounded opening sampling band is wider, never narrower
(R3-07, R4-04); measured replacement is shown and never applied (R3-06, R4-06); awards are scored with the width of their
bands and read in the ladder's class (R4-08, R3-10). **R4's probes, re-run:** before, 11 of R4's 12 single-winter
synthetic probes adopted the measured price (a winter of cheap deals, a 30% over-projection with a band $0.00M wide, a
doubled economy); after, none does (no realized reading after one winter, and the reason names both units). Carried
one more winter so the first season completes, the $5M-per-expected-win market reads $5.54M per realized win and is
adopted; a market that pays $5M per win produced reads $4.97M per realized win (its projected bases $7.59M) and is
adopted at $4.97M; the winter of cheap deals is not (its signings fill 2, 47 and 0 of the class's thirds). On the Arizona
market (Monte Carlo, 400 draws): at 20 signings adoption falls from 91-93% to 2% (the projected and realized readings
disagree by 65% there, so the band holds both), the band covers the per-realized-win truth 88% of the time, and the
central's error is -24% to +32% (10th to 90th percentile), centred; at 150 signings adoption is 18%, coverage 93%. The
regression sweep passes 112 of 112 checks (re-baselined for the 4a review: 99, and 13 for the review). Arizona is
unchanged: one import, no off-season observed, the opening price in force.

Judgments made in the phase 4b review beyond the brief: the realized reading is required before any comparison (a price
per projected win is never compared with, or swapped for, the opening's price per win produced, until the owner rules
on the unit; he ruled on 2026-09-24: per win produced), and the measured central is the realized reading's; the coverage rule is 5 priced signings in each third
of the winter's free-agent class (players whose deals end before the winter's season and whom Player Rights has
free-agency eligible, with expected wins), unsigned players at the earlier import not in the class; a signing with no
projection at the earlier import still enters the realized reading; an award is read in the ladder's own class (the
lowest class of his trip, as the cross-section reads a range) rather than left out for a range, since the ladder's
cross-section classes the same contract that way, and an award with no trip is in no class; a date imported again is
compared on its season's play (games, plate appearances, batters faced), so moves made on the same day stay on the
timeline and a replayed day does not; the pair a new import forms is stored when it is recorded (derived data, read
again from the snapshots when the method changes), and the nextCost recorded is the one priced with the price in force
before this import's own pair (R3-08, documented rather than priced twice). Left open then, and decided by the owner on
2026-09-24 (below): which unit the served price uses, snapshot retention. Still open: an unknown arbitration class priced by observed awards, production at an import
after the season number moved on (the D-08 guard leaves it unknown, so a signing seen then has no projected reading), the
re-signing policy as a sensitivity basis, discounting both sides (phase 5).

**Phase 5a exit criteria, as met (2026-09-24).** The behavior cases (BEHAVIOR_CASES.md "Player Value", phase 5a) are in
`playerValueSurplus.test.ts` (18: sunk salary, every component, the rest of this season, edge against edge, unknowns,
wins only, the discount, options and "if held", the basis, no verdict), `playerValueInvariants.test.ts` (5: one valuation
through the route, the one-player read, Payroll and the league-wide read; an unrelated player changes nobody else's; a
market contract changes another's only through the price, and then by the price alone; value and the tier never read
each other), `valueSection.test.ts` (6, the card) and `playerValueBoundary.test.ts` (the new module, pure and verdict-free,
and the new stamp). Each was run before the code and failed for the reason expected (`surplusOf is not a function`, no
`surplus` on a valuation, `surplusMarketFrom is not a function`, no `src/ValueSection`, the module list and the stamps).
**On the Arizona save** the worked examples are in 5.1. The regression sweep passes 156 of 156 checks (125, re-run on
`origin/main` first and unchanged, and 31 for 5a: a surplus on every valuation, no verdict word, finite numbers, the
discount weights, this season's share, the flat price, ordered bands with a central inside or named, discounted = band ×
weight, never narrower than the parts, the retention margin never below the contract surplus where one way, a sum unknown
exactly when a season is and naming it, sums edge with edge, the served surplus equal to the pure one, **the guarantee
doubled on each of the 1,054 players with a guaranteed season never changing the retention margin** and lowering the
contract surplus, the one-player read, Payroll's players and the route serving the league-wide answer).

Judgments made in phase 5a beyond the brief: the minimum is written into production value (the price is above the
minimum, so a replacement-level player at the minimum is worth nothing, not −$780K); an option season's contract surplus
is the hull of its two ways and chooses no central, while the retention margin is the branch where he is kept; an
unexported buyout is read from nothing to the option's salary; a minor-league deal's season is unknown in the retention
margin (whether it is owed is not established); the 40-man spot is the export's flag, with Player Rights' roster rights
named as where its consequences are read; his wins over a replacement's are discounted like the dollars; the rest of this
season is read at production's share of the league's games.

**Phase 5b exit criteria, as met (2026-09-24).** The behavior cases (BEHAVIOR_CASES.md "Player Value", phase 5b) are in
`playerValueLens.test.ts` (17: the neutral valuation identical and untouched under 150 random philosophies for each of eight
kinds of valuation; our view restating the neutral figure; the neutral band leaning on nothing; every difference named with
amounts that add up; one dimension at a time; why a dimension does not lean; each lean's reach; sunk salary never favouring
keeping a player in our view; unknowns; the policies as words; no verdict; nothing recomputed), `playerValueWinValue.test.ts`
(8: far out, a tight race and a place beyond reach; the curve; odds not dollars with its basis; no philosophy; before a game,
no standings, no games left, the race not established), `playoffs.test.ts` (1, the leader's cushion),
`playerValueFinances.test.ts` (the phase-2 `it.todo` built: Club Finances serves the club's value of a win),
`valueSection.test.ts` (10, the card in plain words, our view, the club's value of a win) and `playerValueBoundary.test.ts`
(the lens the one value module that names philosophy, never the settings; the win value pure; only the reader reads the odds
model; neither the surplus nor the lens reads it; the neutral pass never calls either; the new stamps). Each was run before
the code and failed for the reason expected (`ourViewOf is not a function`, `clubWinValue is not a function`, the cushion 10
where 5 was expected, no `playerValueLens.ts`, the module list and the stamps, "Contract surplus" where "Contract value" was
expected). **Neutral value is identical under every philosophy** and **every lean is named**: the regression sweep checks
both on every valuation of the save under three random philosophies each. It passes 180 of 180 checks
(5a's 156, unchanged, and 24 for 5b: the default philosophy leaning on nothing for every valuation; the neutral
valuation unchanged; our view restating the served figure; unknown with the same reason; every difference named; the
amounts adding up; our reading inside our band; finite; every lean a read dimension with its value; notes moving nothing;
no verdict words; payroll flexibility never touching the value of keeping him; the guarantee doubled never changing our
value of keeping him; every club's value of a win known or with its reason, in odds, between 0 and 1, its curve never
falling, its first step the value per win, the same on a second read; every division leader's cushion to its nearest rival;
the route serving the lens under the configured philosophy with the managed club resolved and the club's value of a win).

Judgments made in phase 5b beyond the brief: the lens leans only outside D-036's 40–60 band, linearly to its limit (a
philosophy of 51 leans on nothing); the steps are sequential so their amounts add up; a season between pre-arbitration and
arbitration counts as controlled, one that may be free agency does not; payroll flexibility is the weight on guaranteed
salary in later seasons only (this season's is largely sunk); the win curve is read on the model before the deadline read's
display bounds, and the deadline read's own defaults (a level race where the club is not in its conference's standings, a
one-game cushion where nobody is outside its place) are unknown or decided here, never a number; the club named in "our
view" and in the club's value of a win is the viewing organization's (the one selected in the app), not the player's.

**Phase 5b owner answers (2026-09-24).** (1) The club's value of a win stays context only: no lean reads it until odds
link to revenue (Q-6). (2) The lens weights (`LENS_POLICY`: the 40–60 band, 0%–15% against 5%, half way to the low edge,
±20%, aging from 33) are approved as policy; they are shown with every lean and change by decision. (3) The odds model
gives a division leader his wild-card route: the playoff odds read `playoffPicture`'s `playoffCushion` (a leader's lead
over the first club outside the field, or his division lead if larger), so a caught leader still has the wild card
(Arizona, level with San Francisco: 75%, where the division-only reading gave 57% and the old last-place cushion 86%). A
richer odds model (roster-based team strength from Player Value's projections, the schedule, every rival, simulated
seasons) is on the roadmap. (4) A club accepting variance leans on nothing (Part 6 forbids reading above the centre).

**Phase 6b exit criteria, as met (2026-09-24): the Trade Center.** The behavior cases (BEHAVIOR_CASES.md "Player Value",
phase 6b) are in `playerValueTrade.test.ts` (12: each player's figures served unchanged; the difference a band with its signed
parts, received less sent, never a point or a verdict; players combined as independent, inside the edge-to-edge sum, around
the most likely, never narrower than any one player's own distance, over 40 random deals; an open season at its edges; an
unknown player named and never changing the known sum; a side with nothing valued; a league in wins; the neutral reading
identical under 60 random philosophies with every lean named; the neutral band's our view; the control line and cost path;
expected wins), `tradeAnalysis.test.ts` (5, on a synthetic save: the card's valuation in every row and the route; the same
neutral reading for three viewing clubs under three philosophies and none; the unknown player; the AI's context; the desk's
prompt), `tradeCenter.test.ts` (6: the page's sides, rows, totals, difference, bar and parts; the unknown sentence; our
view; no jargon or verdict word; the empty, one-side, loading and error states; the bar's geometry),
`tradingBlock.test.ts` (3 new: no `players_value` field; Player Value's facts; ordered by a shown fact),
`evidenceBoundary.test.ts` (the `players_value` allow-list is `valuation.ts` and `franchise.ts`; `trade.ts` and
`tradingblock.ts` name no value field, percentile or OOTP rating) and `playerValueBoundary.test.ts` (the trade reading
pure, lens types only, no philosophy, no verdict; the trading block a migrated consumer; the new stamp). Each was run
against `origin/main` (a7f4aef) and failed for the reason expected (`tradeValueOf is not a function`, `analyzeTrade is not
a function`, no `src/TradeAnalysis`, the trading block's `oa`, the allow-list holding `trade.ts`, the module list and the
stamps; the AI context also failed on the synthetic save's missing `zr` column, a pre-fork schema gap fixed here).

**The difference band contains the most likely difference, unknown players are excluded and named, and the neutral trade
value is unchanged under any philosophy:** the regression sweep (Reviewer C's, widened) passes 205 of 205 checks: 5b's 180,
unchanged, and 25 for 6b over 200 random deals between major-league clubs (mostly valued players, some not, so 76 deals
carried an unknown player and 11 had a side with nothing valued): each player's figure the league-wide one; every side's
range inside its edge-to-edge sum and around its most likely; the difference band holding its most likely, inside the
edge-to-edge sum, equal in its most likely to the sum of the parts and never a point; unknown players named and never moving
a known sum; the neutral reading the same under a random philosophy and for another viewing club; our view's band holding its
most likely; the viewer's value of a win the entry point's; no verdict word; no non-finite number; the AI context free of
value fields and percentiles; the trading block's order stated; for every club, fits whose candidates are each expected to
add more than the other club's best there and whose counts are their matches; the route resolving the managed club. The
trading block is empty on this save (no club has listed a player), so its rows are covered by the fixture's cases. Timing: a
deal analysed in about 0.1 s warm (0.7 s cold), one club's fits in about 0.2 s warm (1.3 s cold).

**Worked on the Arizona import** (2026-05-16; the opening price $7.25M a win; the owner's philosophy, every dimension 50,
leans on nothing, so our view is the neutral view; every figure contract value, discounted):

| Deal (Arizona sends / receives) | Sending side | Receiving side | Difference: coming in less going out | What it shows |
|---|---|---|---|---|
| Prospect for a veteran: Tyler Locklear (1B, 25, Triple-A) and Tommy Troy (2B, 24, Triple-A) / Taylor Ward (LF, 32, BAL, $12.2M, free agent from 2027) | Locklear most likely $6.7M to $7.9M, could be −$41.8M to $80.2M (his 2028–2029 status and 2032 open); Troy not valued: "his pay for 2026–2029 isn't known, and his production is only projected through 2029", left out and named | $3.5M, could be −$8.0M to $27.1M (keeping him $12.3M) | most likely −$4.4M to −$3.3M, could be −$77.6M to +$50.8M (every player at his edge −$88.1M to +$69.0M); leaves out Troy | A controlled bat's long range against a rental's short one; a win-now philosophy reads it −$3.7M to −$2.4M, a rebuild +$7.6M to +$10.3M, the neutral figures unchanged. Arizona's win moves its odds 3.9 points (75%), Baltimore's 2.8 (85%) |
| Salary dump: Eduardo Rodriguez (P, 33, $21.0M, signed through 2027, club option 2028) / Vince Velasquez (P, 33, CHC, the minimum) | most likely −$40.8M to −$25.4M (depends on the 2028 option), could be −$70.0M to $5.8M; keeping him −$5.1M to $10.3M | $0.0M, could be −$2.9M to $3.3M | most likely +$25.5M to +$40.9M, could be −$5.9M to +$70.2M | Moving a contract worth less than it pays reads positive for the club sending it: his salary goes with him. $21.0M of salary out this season, $0.8M in |
| Balanced swap: Pavin Smith (1B, 30, arbitration 2027, 2028 arbitration or free agency) / Rhys Hoskins (1B, 33, CLE) and Danny Coulombe (P, 36, BOS), both free agents from 2027 | most likely $5.8M to $7.1M, could be −$32.5M to $61.2M | together most likely $5.1M, could be −$3.9M to $21.8M (every player at his edge −$6.5M to $26.9M) | most likely −$2.1M to −$0.8M, could be −$56.9M to +$41.0M | Near even at the most likely, with a range wide on both sides of zero: two short contracts against a player with control left |

Judgments made in phase 6b beyond the brief: the sides are summed on contract value only (a trade moves the salary; the
value of keeping him is shown per player); the owner's Payroll combination is extended to a trade's sides and difference
(policy, an owner question below); a player going out enters reversed; a side with nothing valued makes the difference not a
number, while a side with some players valued sums those and names the rest (the brief's rule); a deal with any player valued
in wins only is read in wins; the trading block and the fits order by expected wins for the rest of this season (shown,
unknown last) and fits compare most likely figures only; the AI desk's opening answer is a one-line "Read" with no
accept-or-reject verdict (D-001, D-004, AGENTS.md: no LLM in the decision path); the AI context keeps its roster reading
(season lines, fielding, incumbents, needs, the trading block) and drops OOTP's overall and potential; `fieldingRecord` reads
zone rating only where the export has the column.

**Phase 6d exit criteria, as met (2026-09-24): the Roster's scouting column, the Lineup and Org Comparison.** The behavior
cases (BEHAVIOR_CASES.md "Player Value", phase 6d) are in `rosterScouted.test.ts` (5: no `players_value` figure on a roster
row and the rows unmoved when OOTP's figures are planted; the scouted figure the adapter's; a tool not graded "not scouted";
unknown sorted last either way; the page's words), `lineupEvidence.test.ts` (8: the talent order from the scouts' bat against
each hand while OOTP's valuation says the opposite; unmoved when OOTP's offensive value moves; no `players_value` figure and
each bat's basis; overall grades where there are no split grades, said; an ungraded bat named and never ranked; gloves the
revealed grades; the traditional and production orders; the page's words), `orgComparison.test.ts` (13: every club once,
the viewer's marked, no rank; the roster's, the farm's and the contract sums each equal to the players' served figures,
their members exactly the group; a player with unknown production named and left out; payroll and budget Club Finances';
unmoved by planted or absent `players_value`; `groupWinsOf` pure; the page's words, its loading, empty and error states and
its sort, unknown last), `roster.test.ts` (2 rewritten: the scouts' view, no OOTP Overall exact or rounded),
`evidenceBoundary.test.ts` (`lineup.ts` guarded; the direct allow-list `valuation.ts`; `api.ts`, `lineup.ts` and
`franchise.ts` name no value field, percentile or OOTP rating) and `playerValueBoundary.test.ts` (`franchise.ts` a migrated
consumer; the three pages free of OOTP's figures). Each was run against `origin/main` (51bbbc8) and failed for the reason
expected (`oaRating` on the rows, no `scouted`, no `sortRosterPlayers`, `RosterTable`, `LineupView` or
`OrgComparisonPanel`, slot 2 going to OOTP's best bat, no `batBasis` or `notScouted`, no `isViewer`, `roster` or `farm`
on the clubs, `franchise.ts` still a `players_value` reader and not on the entry point, `api.ts` and `lineup.ts` still
reading `valuesByPlayer`, the rating columns in `lineup.ts`). The lineup's metamorphic case first passed on `origin/main`
for the wrong reason (`valuesByPlayer` is cached until an import); it clears the caches as an import does, and then failed.

**The lineup's choices are unchanged where the evidence is the same, and every other difference is explained.** On the
Arizona import every club's card was built three ways for both hands, both orders and both sorts (240 cards each):
`origin/main`; an evidence-only variant (the new code with only the bat put back to OOTP's offensive value); and the new
code. The variant equals `origin/main` on all 240 (lineup, slots, positions, gloves, reasons, bench, unavailable): the
adapter's gloves, tools and roster read exactly what the columns did. The new card equals the old on 37; the other 203
differ only through the bat, and each is explained: 88 change who plays or where (72 one player, 16 two), and on each the
old card is the solver's best under OOTP's bat and the new one its best under the scouts' (the objective recomputed both
ways; e.g. Arizona against right-handers: Carlos Santana at DH and Tim Tawa in left for Lourdes Gurriel Jr. and Alek Thomas,
OOTP's valuation having Gurriel 68 of its points ahead of Santana, the scouts' grades Santana 5.3 wOBA points ahead of
Gurriel); 68 keep the nine and reorder them on a talent card, where the two readings rank some pair of the nine
differently; 47 change only the bench's order, where the readings rank (or one ties) a pair differently. The two bat
readings agree closely (correlation 0.94 against right-handers), so most differences are one close call going the other way.

**Org Comparison on the Arizona import** (2026-05-16, the export current): 30 clubs, every sum equal to its players' served
figures (the checks below). The league's middle club: 20.2 wins from its roster over the rest of 2026, 6.0 from its farm in
2027, contract value most likely $100.8M to $199.1M (the median of the clubs' low readings to the median of their high ones,
never a midpoint made up between them), payroll $173.9M. Arizona (26–17): roster 19.6 wins (could be 13.5 to 26.5), farm 8.8 (4.2 to
17.2; 247 players, top contributor Tommy Troy, 1.0), contract value most likely −$57.7M to $157.6M depending on open seasons
(could be −$291.9M to $595.7M; 2 players not counted), payroll $190.7M. Every club's contract value has an open season
somewhere on its roster, so its most likely is a range on every club. A club's farm includes established major leaguers
optioned down (Boston's top contributor is Jarren Duran, 3.1 wins).

The regression sweep passes 263 of 263 checks: 6b's 205 unchanged, 6a's 20 folded back in, and 38 for 6d: every roster
of the league and its affiliates (232 clubs, 7,861 rows) with no `players_value` figure, the scouted figure the adapter's and
on the 20–80 scale or unknown with its missing tools named (15 not scouted now, 5 at the ceiling); the lineup's 240 cards
(the variant equal to `origin/main`, no `players_value` figure, every ranked bat read with its basis, every glove the
revealed grade, every difference explained); Org Comparison's route equal to the page, every club once, no rank, no verdict
word, and for each club and each of its three sums the group exactly counted or named, the most likely and the edges the sums
of the players' served figures, the range inside the edges holding its most likely, the combination and the players left out
said; payroll and budget Club Finances'; the top contributor the farm's most expected; the record the export's; no
non-finite number. Timing: the page takes about 2.5 s (it values every rostered and farm player, about 7,500); a club's
roster about 0.12 s; a lineup card about 0.65 s.

Judgments made in phase 6d beyond the brief: the Roster's column keeps the name `TIP_OA` for its hover (AGENTS.md cites it
as the voice to follow); the lineup's bat unit (`BAT_POINTS_PER_WOBA`, tenths of a wOBA point) was chosen so the solver is
untouched rather than restating its glove weight; a hitter with no split grades is read on his overall grades, labelled,
where `origin/main` fell back from OOTP's split value to its overall value (an owner question below); an ungraded bat can
still fill an otherwise empty position, batting last and said; Org Comparison's roster is the club's active roster and
injured list (as Contracts lists it), its farm the organization's players on affiliates (optioned major leaguers
included); its contract value is the Trade Center's side total (`tradeValueOf`), so a no-dollar league reads it in wins;
the wins sums go through a new pure `groupWinsOf` in `playerValueTrade.ts`, because the boundary keeps consumers from
combining players themselves; the viewer's figures sit beside the league's middle club, a median, never a place; the table
starts in club order.

**Phase 6d owner questions (answered 2026-09-24, all as recommended: the labelled overall-grades reading stays, the contract-value column stays as a range, the farm column keeps established players; Part 12).** (1) A bat with no split grades against a hand is read on his overall grades and labelled
"overall"; should it instead be unknown (and the hitter not ranked) until split grades exist? No hitter on Arizona's major-league
rosters lacks them; older exports may. (2) Is a roster's summed contract value useful on Org Comparison when every club's
most likely is a range several hundred million dollars wide? The alternative is to show only the players whose most likely
is a single figure, or to leave the column out until an owner rule on open seasons in club totals. (3) Should the farm
column leave out established major leaguers optioned down (Duran, Volpe), so it reads as prospects only? Today it is every
player on the affiliates, and the top contributor's hover says it is the nearest help, not the best prospect.

**Phase 6b owner questions (answered 2026-09-24, all as recommended: players combined as independent for a trade, no accept-or-reject line, fits by most likely wins; Part 12).** (1) Is the Payroll rule (players combined as independent) right for a trade's sides and
the difference? The alternative is edge to edge (Part 3's default), shown in the details today; on the worked deals it is 8% to 30%
wider. (2) Should the AI desk give an accept-or-reject line? It no longer does (D-001); its answer opens with a plain "Read".
(3) Trade fits compare most likely expected wins only; a match can rest on a difference of a few hundredths of a win. Should a
match need the candidate's range to clear the other club's best, or stay a shown comparison?

**Phase 6c exit criteria, as met (2026-09-24): Free Agents and the AI's value context.** The behavior cases (BEHAVIOR_CASES.md
"Player Value", phase 6c) are in `freeAgents.test.ts` (14, on a synthetic save with free agents made the way the export writes
them: both lists and no value cut; wins as production serves them; the market figure the entry point's, the minimum plus wins
× the price, a band around its most likely; the scouted tools the evidence boundary's; an unknown free agent shown with his
reason and last in every sort; the thinnest positions by expected wins; no percentile, cut or verdict; the page's visible
text, sortable headers, scroll box, unknowns, empty, loading and error states; the date and a stale export),
`aiValueContext.test.ts` (6: the percentile note gone from the server; the briefing's context carrying the card's totals and
the date; the briefing's and every chat voice's prompt; the free-agents tool's payload and description),
`pageFreshness.test.ts` (8: Payroll's and the Trade Center's date, a stale export's statuses and the unchecked limitation, the
panel's and the shared cue's words), `evidenceBoundary.test.ts` (`freeagents.ts` off the indirect-reader list; `freeagents.ts`,
`rosterops.ts`, `positionNeeds.ts`, `ai.ts` and `chat.ts` name no value field, percentile or note; `valuation.ts` no longer
holds `rosterHoles` or the note) and `playerValueBoundary.test.ts` (Free Agents and `positionNeeds.ts` migrated consumers; the
page and its types show no `players_value` figure; `marketValueOf` in the surplus module and no consumer multiplying wins by a
price). Each was run against `origin/main` (51bbbc8) and failed for the reason expected (no `positionNeeds` module, no
`FreshnessCue` component, no `briefingContext` or `briefingSystem` export, the note in `ai.ts` and `chat.ts`, `freeagents.ts`
still reading `valuesByPlayer`, `rosterHoles` in `valuation.ts`, the Free Agents page's percentiles, no `marketValueOf`); one
case's own reading of who reaches the market was wrong (it missed a timeline that lays out the free-agent season) and was
corrected after the code ran.

**Every listed free agent's wins are production's, and no payload carries a percentile or a verdict:** the regression sweep
passes 250 of 250 checks (6b's 205 with 6a's 20 folded back in, and 25 for 6c): every club's Free Agents page (30 pages, 3,491
rows, 3,462 priced at the market and 29 not known with their reason) lists exactly the players the timeline finds reaching the
market, in order of expected wins next season with unknowns last; each row's wins this season and next are production's, its
market figure the entry point's and the minimum plus wins × the price within a dollar, its scouted tools the evidence
boundary's on the 20–80 scale; no percentile, `players_value` field or verdict word in any payload; each club's thinnest
positions are `positionNeeds`' with each best player's figure production's; Payroll, Free Agents and the Trade Center say the
export's date and state; the briefing's context for every club carries the card's totals and the date and no value
percentile, the trade desk's context none either, and neither the briefing's prompt nor any chat voice's names a percentile.
On this current export the pages' reading (`current`) serves every player the same figures as the league-wide read. The
sweep's first run flagged the briefing's context for "percentile": a cost band's basis naming the 90th percentile of the
save's renewals, a statistic of salaries and not a value percentile; the check was narrowed to value percentiles. Timing: a
club's Free Agents page about 0.52–0.58 s warm (2.8 s cold, production for the league's 870 major leaguers elsewhere and the
free agents); Payroll 0.35 s.

**Worked on the Arizona import** (2026-05-16, current; the opening price $7.25M a win, $6.57M–$9.78M; the minimum $780K):
Arizona's thinnest positions are CF (Jordan Lawlar, 0.5 wins the rest of 2026), 3B (Nolan Arenado, 0.5) and 1B (Pavin Smith,
0.7). Eleven players are available now, the most productive Tommy Pham (LF, 38; 0.3 wins the rest of 2026, 0.1 in 2027; 2027
at the market $1.4M, could be −$1.6M to $5.4M) and Gary Sanchez (C, 33; $1.2M, $0.8M to $1.8M); Walker Buehler (P, 31) reads
$0.4M, could be −$5.1M to $8.2M: a wide range around an expected level just below replacement. 101 players reach free agency
after 2026 (282 more could go either way, 64 have an option or opt-out next season); the first are Kris Bubic (P, 28, KC; 2.7
wins in 2027, $20.2M at the market, could be $2.1M to $52.2M), Ian Happ (LF, 31, CHC; 2.6, $19.5M) and Gleyber Torres (2B, 29,
DET; 2.4, $17.9M); the last, Tyler Austin (1B, 34, CHC), is not known: his club is a major-league one but he has no
major-league line in the window, so his playing time is not established.

Judgments made in phase 6c beyond the brief: a free agent's figure is production value at the market (minimum plus wins ×
price), one season, next season, undiscounted, for both lists (the rest of this season as wins only); a low edge below the
minimum is shown, not clamped; the thinnest positions keep the Trade Center's reading (the rest of this season) so the two
pages agree; the free-agents tool trims each list to 40 in its stated order and says so; the briefing's and the trade desk's
contexts carry the export's date; the draft board's "thinnest spots" now come from `positionNeeds` (its page type moved from
`bestValue` to each position's best player); an export without `free_agent` or `last_league_id` lists no available players
and says why (the old page failed). `valuesByPlayer` and `mlbPercentiler` stay in `valuation.ts` (the parallel 6d migration
still needs the first; `mlbPercentiler` now has no production caller) and go in the final cleanup.

**Phase 6c owner questions (answered 2026-09-24, all as recommended: one season at the market, "Might reach the market" built as its own chip, "Worth a look this week"; built in phase 6e, Part 8, Part 12).** (1) A free agent is shown with one season at the market. Should the page also show a
multi-season reading (say the three seasons a typical deal covers, discounted like contract value)? Recommendation: not yet;
one season is the clearest reading and multi-year terms are the GM's to set. (2) On this import 282 players "could go either
way" about reaching the market and are counted, not listed. Should they be listed as a third group ("might reach the market")
with the reason on each? Recommendation: yes, as its own chip, never mixed into the free agents after 2026. (3) The briefing
prompt still asks the assistant for a "Recommendation of the Week" heading, older than Player Value. Should it become "Worth a
look this week" to keep the AI explaining rather than recommending (D-001)? Recommendation: yes.

**Phase 6e exit criteria, as met (2026-09-24): the cleanup, Payroll in plain words and the owner's answers.** The behavior
cases (BEHAVIOR_CASES.md "Player Value", phase 6e) are in `evidenceBoundary.test.ts` (no server module reads
`players_value`, directly or through another's reader; no module under `src/`, `scripts/` or `electron/` names one of its
figures or a percentile of one; no allow-list), `payrollPage.test.ts` (7: projected seasons and options to read; no method
word in what the GM reads; "most likely", "could be" and "if kept"; every figure kept; the basis in the hovers and
breakdowns; an option's both branches in plain words; an unknown price a short word), `freeAgents.test.ts` (5 new: the
"might reach" list exactly the players the timeline leaves free agency open for, with a club option planted the way the
export writes one; a player the club keeps either way left off; a short word for why and the reason on hover; the order
and figures of the other lists; its chip, with no verdict or method word and the old count line gone), `aiValueContext.test.ts`
(1 new: "Worth a look this week", never "Recommendation of the Week" or an instruction), `tradingBlock.test.ts` (1 new: the
block read on the export's freshness, a veteran's free agency stated on a current export and not on a stale one) and
`tableHovers.test.ts` (2: the last rows' hovers open upward; the box still scrolls sideways). Each was run against
`origin/main` (38cd361) and failed for the reason expected (`valuation.ts` still reading `players_value` directly and
through `valuesByPlayer` / `mlbPercentiler`; no `PayrollView`, so Payroll could not be rendered from its data, which the
first case confirmed exists; no `mightReach` on the payload and no third chip; the prompt asking for "Recommendation of the
Week"; no `freshness` from the trading block; no upward rule in the stylesheet). `percentilePool.test.ts`, which tested only
the deleted percentile, is deleted; the pinned words of the card's price line and cone (`playerCard.test.ts`,
`productionCone.test.ts`) follow the new copy.

**On the Arizona import** (2026-05-16, current), the regression sweep passes 329 of 329 checks: 6d's 263 unchanged, 6c's 25
folded back in (the union of 6c's and 6d's sweeps) and 41 for 6e: no module anywhere reads `players_value`; every club's Payroll (30) carries no method word in what the
GM reads, shows each season's projected range and most likely (150 seasons), keeps the every-player-at-his-edge sum in the
breakdown and the combination's own words and the owner's label on the hover, every projected season's basis on its hover
(2,687), the price of a win with its range on the page and its floor on the hover; every club's Contracts and Free Agents
(all three lists), Org Comparison and a deal on three clubs, and 20 player cards, carry no method word in what the GM reads
(the cone's axis codes aside; the trade row's "pre-arb" became "pre-arbitration" on this check); every club's "might reach"
list is exactly the players the timeline leaves free agency open for, never in the free agents after this season, listed
plus staying-either-way equal to the unsettled plus the options, ordered, each row's reason the timeline's and its wins,
market figure and scouted tools the entry point's and the boundary's (6,728 rows); the trading block says the export's
state; the briefing asks for "Worth a look this week". Arizona's Free Agents: 101 after 2026, 222 might reach the market
(42 club options, 6 player options, 4 opt-outs, 28 close to free agency, 142 not settled), 124 open questions that stay with
their club either way.

**The Roster's rating bars, measured and not moved (item 3 of the brief).** Read through `scoutedEvidence.ts` with the fields
it already exposes (tools now and at their ceiling for the player's own kind, running speed from the hitter profile), every
roster of the league and its affiliates (232 clubs, 7,861 rows, 117,915 values) would not be byte-identical: 62,337 values
equal, 55,546 absent because the adapter serves a pitcher's batting grades and a hitter's pitching grades to no one (the page
never shows them, the payload carries them), and 32 grades of 0 read as unknown (25 of them in bars the page shows: a "0"
bar would become "—"). Nothing else differs, and the bars' scale is the same on this save. Moving them needs either those
cross-kind fields approved in the adapter or the owner's word that the payload may lose them and a 0 may read as not
scouted, so they stay on the approved columns, read directly (D-017's remaining gap).

Judgments made in phase 6e beyond the brief: `clearValuationCaches` is deleted with the caches it cleared (no cache is left in
`valuation.ts`), and the unused `ROLE_STARTER` export with it; Payroll became a pure `PayrollView` so a test can render it;
the owner's "players combined as independent; not a calibrated interval" label moved into the hover with the method, as the
writing rule places method words; the card's production cone got the same plain-words pass (its legend, its calibration
line, "if kept" and "range" in its detail and screen-reader table), since the brief's sweep covers the card; the trade row's
"pre-arb" is spelled out; "might reach the market" includes a season the export leaves unsettled with nothing named ("Not
settled", mostly a blank contract row) because free agency cannot be ruled out (D-018), and leaves out an option declined
into arbitration or a season between pre-arbitration and arbitration; the free-agents tool carries the list for the
assistants, trimmed like the others; the payload keeps the two counts (`upcomingIndeterminate`, `upcomingUndecided`) though
the page no longer prints them.

**Phase 6e owner questions (open).** (1) The Roster's rating bars: may they read through the scouting adapter if a grade of 0
then shows as not scouted (25 bars on this import) and the roster payload stops carrying a pitcher's batting grades and a
hitter's pitching grades (never shown on the page)? Recommendation: yes; it closes D-017's last gap without a new field.
(2) "Might reach the market" lists 142 players on this import as "Not settled", nearly all a blank contract row whose
next step the export does not state. Keep them there, or show them only behind a "show unsettled" switch? Recommendation:
keep them, with the reason on hover; hiding them would read an unknown as "staying".

**Phase 4 owner decisions (2026-09-24).** The owner ruled on the four open questions of the phase 4a and 4b
reviews (Part 12); the behavior cases are the "phase 4 owner decisions" row, each written first and failing on
`feature/player-value-phase-4b` (e077265) for the reason expected (20 unit cases, 2 multi-import sequences; kept with the
decision notes). (1) The price in force, once measured, is per win produced: the realized reading's central and band,
the per-projected-win readings its check with their ratio. (2) Payroll combines players as independent around the sum of
centrals, what is not noise at its edges: Arizona 2027–2031 $16.4M–$49.0M, $15.1M–$50.2M, $8.1M–$57.1M, $12.7M–$52.1M,
$14.6M–$48.7M against edge to edge $15.8M–$75.8M, $13.5M–$92.8M, $7.8M–$111.6M, $7.8M–$108.0M, $7.0M–$97.6M (Pittsburgh
2029 $37.6M–$113.0M against $17.8M–$228.2M; Cincinnati 2029 $27.6M–$114.0M against $16.7M–$233.0M), 36–57% of the
edge-to-edge width, as R2-01's simulation had it. (3) An arbitration salary is never below the previous season's salary
(owner-attested): 526 of 2,566 arbitration-priced seasons on the save move; Megill 2027 $1.24M–$9.92M → $4.70M–$9.92M
(his 2026 salary $4.70M), Henderson 2027 $2.75M–$22.16M → $8.50M–$22.16M and 2028 $3.15M → $8.50M at the low edge,
Dunning unchanged ($780K, the minimum); observed awards below the previous salary are flagged. (4) Full contract
snapshots are kept only at the winters and for the latest import; every pair and event kept. The regression sweep passes
125 of 125 checks (112, with two re-baselined for the decisions, and 13 new).

**Phase 4a exit criteria, as met (2026-09-23).** The behavior cases (BEHAVIOR_CASES.md "Player Value", phase 4a) are
in `playerValueCost.test.ts` (15 new, the reserve-clause case rewritten), `playerValueCrossSave.test.ts` (6 new cases and cost invariants on
every save), `playerValueControl.test.ts` (2, Player Rights' regime and open-season trip), `payrollControl.test.ts` (2),
`playerValueCone.test.ts` and `productionCone.test.ts` (1 each), and `playerValueBoundary.test.ts` (the new module, its
stamps, and its reading of Player Rights' answers only). Each was run before the code and failed for the reason expected
(no `playerValueCost` module, no `arbitrationRegimeOf`, no `tripIfEligible`, no `costs` on a league's finances, no
projected money on Payroll, no `nextCost` on Contracts, no cost on the cone, the module list and stamps). On the Arizona
import (scratch `history.db`, read-only league): the renewal band $780K–$790K on 249 renewals; the arbitration ladder
measured in all three classes (74, 51 and 47 contracts; 14%, 26% and 49% of the price per platform win on bases of
$0.44M, $1.35M and $0.41M); 1,465 arbitration seasons, 359 renewals and 1,101 open seasons priced among the rostered
league's players, 16 arbitration seasons unknown (the platform's production unknown). Worked examples are in CALIBRATION.md
section 8. The regression sweep passes 81 of 81 checks (the 65 of F6 and 16 for the cost bands: ordered bands, no
arbitration season at the minimum, the classes covering each arbitration year, open seasons covering their statuses,
the prior only where the regime is MLB's, and, through Payroll's own route for all 30 clubs, committed totals holding
guaranteed money only). The league-wide pass takes about 1.5 s as before; the first valuation after an import measures
the ladder once (about 0.15 s warm); Payroll, which now computes production, about 130–150 ms a club.

Judgments made in phase 4a beyond the brief: the ladder is a per-import measurement snapshotted with the market, not a
D-053 fit (one cross-section has no held-out outcome to gate on; phase 4b scores it against observed awards); the
performance basis is the two-season platform with a base, rather than R-6's one-season ratio; a contract at the minimum
in the arbitration class is kept out of the line (first read as a non-tender; the review stopped naming a transaction);
a Super Two's fourth trip is priced in the last class, where his service puts him; a season that may be free agency is
priced as if held and adds nothing to Payroll's low edge; reserve-clause renewals stay unknown (phase 4b).

**Phase 4a review (2026-09-23).** Two reviews (correctness R1, method R2) were fixed before 4a merged; the behavior
cases are the "phase 4a review" row, each written first and failing on 6020184 for the reason expected. The class line
is Theil–Sen with a bootstrap of the same fit (Arizona: $0.96M, $1.75M and $2.54M a platform win against least squares'
$1.04M, $1.92M and $3.54M; the prior re-measured by the same method); below 30 contracts a class has no line of its
own, the prior widened by the range the save paid it (the synthetic eight-club save's highest arbitration edge fell from
$83.3M to $14.5M against a largest salary of $15.2M; one, two and three contracts at extreme pay each widen the band);
every priced band carries a central (none chosen between statuses, each named); Payroll sums the centrals beside the
range; the price band is named, and applied, only where the prior is read, and an unknown price leaves the save's own
line standing; a contract at the minimum lets a season whose platform reaches as low reach the minimum, said; a branch
the player decides is "if held"; the class his service puts him in is covered beside his trip (Player Rights'
`serviceClass`), which also widens next season's low edge for a player who, optioned for the rest of this season, would
be read in the class below (Henderson 2027: $4.6M–$25.3M became $2.7M–$22.2M, central $8.9M); Player Rights lists no
arbitration in a league without it; a reading without production prices nothing (Free Agents); a platform past what a
class was measured on says so; the labels say "range of reasonable readings", show "if held" and never print a band as
a point. Owner questions left conservative: combining players statistically at Payroll (R2-01; edges still summed) and
MLB's 20% maximum cut (R2-05; not applied). The regression sweep passes 91 of 91 checks (the 81 before, two of them
restated for the reworded cases, and 10 new: centrals inside their bands and summed at Payroll, the price band named only
where the prior is read, plain text, no Super Two clause for a non-Super-Two, an extrapolated platform said, the robust
measured line, the ladder's text, and no second cost without production). The thin-class, no-arbitration and all-prior
checks have nothing to check on this save (every class is measured) and are carried by `playerValueCost.test.ts` and
`playerValueCrossSave.test.ts`. The league-wide pass takes about 1.7 s (1.5 s before; the bootstrap measures each
market league's ladder once per import, about 0.2 s).

**Phase 3b exit criteria, as met.** The 3b behavior cases pass (`playerValueRatings.test.ts`, 19; the widened
production, fit and boundary files); each failed on the pre-3b code for the expected reason. Removing a rating never
narrows a band, and no ability evidence leaves that component `unknown` (tested for prospects and thin records). On the
Arizona import (scratch `history.db`, read-only league):

- **Fits recorded and adopted.** Results `203:2025:production-3b.1` passed the gate (held-out coverage as served, 80% /
  50%: horizon 1 82.1 / 56.0, 2 81.1 / 52.8, 3 81.2 / 52.9, 4 82.4 / 55.6, 5 82.2 / 58.3, 6 83.3 / 61.5, 7 84.7 / 64.9).
  Ratings `203:2025:ratings-3b.1` passed the gate: the same-time mapping's held-out coverage 84.5 / 57.2 on 1,147 major
  leaguers (hitters 85.5 / 57.8, starters 79.6 / 56.7, relievers 85.9 / 56.4); arrivals measured from 571,079
  player-seasons at levels 2, 3, 4 and 6, the held-out chance of any major-league time within 0.1 to 2.5 points of what
  happened at every horizon (4.6% predicted and 4.7% observed the same season, 8.7% and 11.1% six seasons on).
- **Fitted now, and on the prior.** Fitted on this save: the ratings mapping (same-time), how often each hand faces
  left-handers (L .199, R .320, S .279), the stamina cut for a pitcher with no professional games (50, misclassifying
  11% of major-league pitchers), the arrival rates by level and age, the largest scouted development by age, and the
  quality-conditioned playing time. On the prior: the development path (0 of 300 snapshot pairs a season apart: one
  snapshot, 2026-5-16), the arrival chance by potential (0 of 300 linked seasons) and the ratings' reliability as a
  forecast (0 of 50 per kind): until measured the ratings count for the kind's K.
- **Bias for stars, before and after** (held-out, actual − central, wins, top tenth of projected rate within each kind;
  horizons 1–7): before +0.20, +0.33, +0.37, +0.41, +0.44, +0.44, +0.41; after −0.12, −0.01, −0.00, +0.05, +0.11,
  +0.14, +0.16. Coverage of the top tenth rose from 64–72% to 78–81% (80% band) and from 30–40% to 48–52% (50% band);
  the bottom tenth is 79–84% and 51–61%. Corbin Carroll: 2027 656 plate appearances and 4.6 wins, 2031 574 and 3.2
  (were 587 and 4.1, 363 and 2.0); Bobby Witt Jr.: 2027 709 and 6.9, 2031 620 and 4.9 (were 586 in 2027 falling to 403 by
  2030).
- **Counts.** 8,072 of 12,575 active players have a band: 1,721 from results and ratings, 6,351 from ratings alone.
  4,503 are `unknown`: 4,346 no club holds and no major-league line places (unsigned: their season and playing time
  are not established), 149 whose club's level is the majors with no major-league line (signed amateurs not yet
  assigned; how much such a player plays is not measured), and 8 with no scouted ratings. On the major-league active
  and injured lists, 897 of 901 have a band.
- **Timing** is in Part 7.

Judgments made in phase 3b beyond the text above: the ratings' reliability is the kind's K until it can be measured
out of time (the same-time fit shows leakage); a development range and a missing grade enter by interval arithmetic,
never as a midpoint; the ratings prior carries no arrivals; a player whose club is at the majors without a major-league
line is `unknown` for playing time rather than read from a minor level; the current season's arrival nodes are scaled
by the share of the season left, the chance is not; the batting-hand exposure, the stamina cut and the largest
development by age are measured per save; the test "a better visible line never lowers either edge" became "never
lowers the central or the high edge", because a better player now keeps more playing time and that widens his band
both ways.

**Hardening (2026-09-23), as met.** The findings, their fixes and the fail-first evidence are in BEHAVIOR_CASES.md
("Player Value", hardening) and CALIBRATION.md section 6.3; 42 new or changed cases in `playerValueProduction.test.ts`,
`playerValueProductionFit.test.ts` and `playerValueCone.test.ts` failed on the phase 3b code (f1e0911) for the reason
expected. On the Arizona import the method `production-3h.1` is calibrated to within 5 points of both targets pooled and
in every subgroup at every horizon; its central is within 0.05 wins pooled; the established cohort's summed central is
within 1–10% of what the save's own history gives the same cohort one to six seasons on (it was 10–66% short). **The
gate did not adopt it**: 13 subgroup-horizon cells over-project by more than 10% of the mean outcome and three standard
errors (hitters at horizons 3–7, regulars at 4–7), all within 0.02 wins in sample, i.e. the drift between the imported
2006–2015 and 2016–2025 eras. The fallback prior (the same method on every season, stamped provisional) is in force on
this save until a refit passes or the owner changes the tolerance. Reviewer C's sweep passes every structural check but
one (C-06, opt-outs, F2's); 8,072 of 12,575 players have a band; the league-wide pass takes 1.4–1.9 s and one
organization 71–80 ms.

**Option C (owner, 2026-09-23): the rolling-origin backtest, method `production-3h.2`.** The owner kept the gate's
tolerances and replaced the single hold-out block with rolling origins: every completed season from the window's start
+ 5 to the season before the last (at most 8, always the first and the last) is scored by the method fitted through it,
a horizon only where that fit has 200 cases from at least 3 origin cohorts, the pooled cases clustered by player and by
origin; each fit weights seasons by a recency half-life of 2 seasons (policy). On the Arizona import (origins 2011–2024)
pooled coverage is 79.2–81.1 / 49.7–50.9 and the pooled bias −0.01 to −0.04 wins at horizons 1–7, every subgroup within
10 points; the gate fails on two cells, hitters at horizons 5 and 6 (−0.096 wins, 21% and 27% of the mean outcome),
scored only from origins 2017–2018 into 2022–2024. The tolerances were not loosened, so the fallback prior (fitted to
the league's own WAR scale) stays in force until the save's own seasons pass it or the owner rules on the long-horizon
bias rule (CALIBRATION.md section 6.3). The cross-save suite turned every F1 finding it held as a todo into a real case
(D-01, D-02, D-05, D-06, D-08, D-09, D-12, D-13, D-15, D-16 and `ratingsHistory`'s unknown share), each failing first
where the fix was new (D-08's season read as played with nothing in it, D-09, D-12, D-15).

**Phase 3a exit criteria, as met.** On the Arizona import the fit `203:2025:production-3a.1` (window 2006–2025, 2020
skipped, trained through 2015, held out 2016–2025; prior weight 0.02) passed the gate and was adopted. Held-out
coverage, 80% / 50% band, as fitted: horizon 1 80.4% / 53.3%, 2 79.2% / 52.7%, 3 78.4% / 52.0%, 4 80.1% / 54.2%, 5 80.5% /
55.1%, 6 80.9% / 57.2%, 7 81.6% / 59.0%. As served (with the prior's widening and hold-out widening): 82.9% / 55.4%,
81.8% / 54.7%, 81.1% / 53.5%, 82.4% / 56.5%, 82.3% / 57.6%, 82.6% / 59.2%, 83.6% / 61.1%. Part-time and regular thirds sit
within two points of 80% at every horizon and within 7 of 50%; the fringe third over-covers (84–88% / 58–72%) because
most of its outcomes are exactly zero (no playing time), which any band around a small central contains. The full tables, the aging curve, the regression and the proneness evidence are in
CALIBRATION.md section 6. On this save 1,721 of 12,575 active players have a band and 10,854 are `unknown`, pending
phase 3b; on the major-league clubs' active and injured lists 897 have a band and 4 do not. Median band width (80% /
50%, wins) among those 897: 2026 (the rest of it plus what is banked) 1.94 / 0.89, 2027 2.64 / 1.03, 2028 2.52 / 0.83,
2029 2.25 / 0.69, 2030 1.76 / 0.56, 2031 1.30 / 0.45, 2032 0.96 / 0.37: the cone narrows in wins as expected playing time
fades, while every rate band widens. The timing is in Part 7. `tsc`, `npm test` and the build are
clean.

Judgments made in phase 3a beyond the text above: the invariant "removing results never narrows the band" is held on
the same expected playing time (Part 2.3); a rolling window of three season-lengths, the current partial season in it
at its own opportunities; production spans the horizon for every player, held or not; a side needs 100 opportunities
in the window to be projected on a primary player's other side; only the rate band is carried forward and the wins band is
each season's own (owner, 2026-09-23; an earlier build carried the wins band, which forced held-out coverage up to 93% /
80% at horizon 7); the tails are set per usage tier, because pooled tails left regulars covered 65–71% and 20–28%; a drift term (rate variance no sample removes) is fitted; the prior
widens the bands it serves by half its weight, and the gate judges the fit before that widening, so a thin save is not
rejected for being honest; injury only lowers a low edge (the brief's widening-only rule) even where it states days
out (superseded by the owner, 2026-09-23: known days out move the central); a proneness of 0 is unknown (the export's unfilled value); the prior carries no proneness effect.

**Phase 2 exit criteria, as met.** The opening price from code on the Arizona import is central $7.25M, band
$6.57M–$9.78M, floor $4.22M–$4.33M; the floor is R-5's to the cent and the market bases differ only by the 17 players
who crossed six years in 2026, explained in 4.1 (R-5's reading, run from the same export, returns R-5's figures).
A snapshot is written once per import key: on the real import the first call wrote one row and the second wrote
nothing (`{"written":0,"existing":1}`), and `playerValueFinances.test.ts` pins it on the fixture. A league without
financials, or without salaries, or under a reserve clause, yields wins and dollars `unknown` with the reason. No
timer. Payroll's finance header reads Club Finances, it shows one "league price of a win" line (central, band, floor,
basis on hover, "opening (imported market)"), and its lists are no longer capped at 12 rows (owner-approved): the count
shown equals the rows. `tsc`, `npm test` and the build are clean.

Judgments made in phase 2 beyond the text above: the market is Player Rights' answer for this season rather than
R-5's service-including-this-season reading (4.1); the central value is the median of the market bases (policy); the
floor is shown as the range of bases A and A′; a player with no line in the league in a season counts 0 WAR in it
while his salary stays in (R-5's arithmetic, stated as an assumption); the reserve-clause flag is read once in
`leagueRules.ts` (`finance.reserveClause`); `valuation.teamFinances()` stays, because Contracts, Free Agents, the AI
briefing context and Storylines still read it (their migration is phase 6). Two phase-1 `it.todo`s in
`playerValueCost.test.ts` are labelled phase 2 (the pre-arbitration renewal band, the arbitration ladder band); they
price costs, not the market, and are left for the phase that builds cost bands (4.4), not pulled forward. Phase 4a built
them.

---

## Part 10 — The evidence boundary test (phase 1)

`tests/playerValueBoundary.test.ts`, static, in the family of `evidenceBoundary.test.ts`,
`developmentalStakesBoundary.test.ts` and `farmOperationsBoundary.test.ts`:

1. **Ratings only through the adapter.** No Player Value module names a rating column (`*_ratings_*`,
   `fielding_rating*`) or opens `players_batting` / `players_pitching` / `players_fielding`. Ability arrives only as
   a `ScoutedAbility`.
2. **No `players_value`.** No Player Value module names `players_value`, `overall_value`, `talent_value`, `oa`,
   `pot`, `oa_rating`, `pot_rating`, `valuesByPlayer` or `mlbPercentiler`.
3. **Consumers reach value only through the module.** A migrated consumer imports value from its public entry point
   and computes no price, cost band or surplus itself. Each migrated consumer is added to an allow-list that grows
   phase by phase, and the `players_value` allow-list shrinks as it does. *Since phase 6e the `players_value` allow-list
   is empty and gone: no server, client, script or desktop module may read it (`evidenceBoundary.test.ts`).*
4. **No philosophy in the neutral path.** The neutral modules import nothing from `philosophy.ts`, `settings.ts` or
   `staffPreference.ts`. Only the lens module does.
5. **No tier and no defensibility.** No Player Value module imports `developmentFit`, `developmentalContext`,
   `prospectDecision`, `prospectAssignments` or `destinationFit`.
6. **No rights rebuilt.** No Player Value module reads option, DFA or waiver columns, or derives arbitration or
   free-agency eligibility from service time. Roster rights and contract-control eligibility come from
   `playerRights.ts` (Q-1).
7. **Nothing writes.** No Player Value module writes to `league.db`. Only the snapshot writer touches `history.db`.
8. **Every constant is declared once and stamped** (D-041), in one calibration module.
9. **Schema tolerance.** Every column read that R-10 lists as unguarded is read through a column check.
10. **Production (phase 3a).** The production modules (`playerValueProduction.ts`, `playerValueProductionFit.ts`,
    `playerValueHistory.ts`, `playerValueFitStore.ts`) read no rating at all: no `scoutedEvidence`, no rating
    column, no `players_value`, no philosophy, no tier, no defensibility. Injury proneness is read only through
    `injuryProneness.ts`. The projection and the fit are handed a model, and the reader serves the adopted fit from the
    store. Only the two writers touch `history.db`. The refit after an import is called once, in the background,
    inside a try/catch.
11. **Ratings (phase 3b).** Ability reaches Player Value only through `scoutedEvidence.ts`: the reader alone loads it
    (`loadScoutedAbilities`, `loadScoutedHitterProfiles`, `loadScoutedGlovesAtPosition`, `loadScoutedObservations`),
    and the pure ratings modules (`playerValueRatings.ts`, `playerValueRatingsFit.ts`) import its types only. No value
    module names a rating column or the snapshot table. No minor-league WAR: the minor-league reader's column list has
    none, and the arrival history carries none. The only fitted artefacts in code are `PRODUCTION_PRIOR` and
    `RATINGS_PRIOR`, both stamped provisional, and the ratings prior measures no arrivals. The ratings refit runs once,
    after the results refit, in the same background guard.
12. **The trade reading (phase 6b).** `playerValueTrade.ts` is pure: it imports the lens's types only (our view arrives
    computed), opens no table, names no philosophy, settings or club value of a win, and says no verdict; no consumer
    combines a deal's players itself. The trading block is a migrated consumer. `trade.ts` and `tradingblock.ts` name no
    `players_value`, value field, OOTP rating or percentile (`evidenceBoundary.test.ts`).

**Hardening (A-16).** Reviewer A showed the test weaker than it looked: a write to `league.db` through the fit store's
`${verb} INTO` statement, a dynamic or double-quoted import, and `contracts.ts`'s own service division all passed. The test
now reads the source through the TypeScript parser, not regular expressions over text:

- Comments are blanked by the parser, so `'a // b'` hides no code after it.
- Imports are read in every form: static, `export … from`, `import()`, `require`, type imports, packages and subdirectories
  (the whole of `server/` is walked). A value module's packages are allow-listed (`express` for the routes only), and only the
  readers may import `db.js`; the pure modules may not.
- Every database call is inspected by its receiver and its SQL, resolved through templates, identifiers (by lexical scope)
  and conditionals. A non-writer runs nothing and prepares only statements that provably read `league.db`. A writer sends
  every statement to `history.db` and reads `league.db` only by a provable SELECT, and aliases neither handle.
- Consumers import only the entry point (the snapshot writer and the routes only for their one caller each); the pricing
  functions are forbidden by name, so an alias does not hide them.
- A migrated consumer does no service arithmetic in any spelling (`service.low / perYear` included), and queries no contract
  table.
- A threshold is forbidden by name, not only as `.name`, so destructuring does not hide it.
- A module-level number of any name, or an object or array holding one, is forbidden outside the calibration module, and
  every number-holding object there has a stamp.
- `SELECT p.*` and a contract-rule query in any quotes are caught.

A known violation owned by another fix (A-22: `contracts.ts` divides service itself; A-14: Payroll queries
`players_contract`; the player card's own `players_contract` query, unassigned) is listed in `PENDING` with its finding and
asserted to be still there exactly, so it cannot hide a new one and the list only empties. Each hardened check was shown to
fail on a deliberate mutation that the earlier test passed (22 mutations in the hardening cycle, 2026-09-23; two the
earlier test already caught were kept as controls).

---

## Part 11 — Constants register

Stamps per D-041, amended by D-053: a **fitted per save** value is computed from the save's own history and stamped by
its run record in `history.db`; code holds only policy, provisional values and the fallback prior. Phase 2's stamps are
declared in `playerValueCalibration.ts`, with the label `OPENING_PRICE_LABEL` and `PRICE_NARROWS_WHEN`; it adds no
numeric constant. Phase 3a adds `PRODUCTION_POLICY` (policy) and `PRODUCTION_PRIOR` (provisional). Phase 3b adds
`RATINGS_POLICY` (policy), `RATINGS_PRIOR` (provisional) and `PRODUCTION_POLICY.qualityTiers` (policy). Phase 4a adds
`COST_POLICY` (policy) and `COST_PRIOR` (provisional); the numbers the cost ladder serves are measured on each import. Phase
4b adds `SIGNINGS_POLICY` (policy) and the label `MEASURED_PRICE_LABEL`; the numbers it serves are measured across the
save's imports. The owner's decisions of 2026-09-24 add `COST_COMBINATION_POLICY` (policy), `SIGNINGS_POLICY.priceUnit` and
`.retention` (policy), and Player Rights' `ARBITRATION_NO_CUT_CALIBRATION` (policy, owner-attested). Phase 5a adds
`SURPLUS_POLICY` (policy, stamped `SURPLUS_POLICY_CALIBRATION`): the owner's 5% discount and how the surplus is read. Phase
5b adds `LENS_POLICY` (policy, stamped `LENS_POLICY_CALIBRATION`), `WIN_VALUE_POLICY` (policy) and `WIN_CURVE_CALIBRATION`
(provisional: the deadline read's odds model, whose one number, the .520 rival, is `posture.ts`'s `RIVAL_TALENT`). Phase
6b adds `TRADE_COMBINATION_POLICY` (policy, stamped `TRADE_COMBINATION_POLICY_CALIBRATION`).

| Constant | Stamp | Basis |
|---|---|---|
| Service-year length | **none: read** | `rules_min_service_days`. Missing → unknown, never 172 (R-3) |
| FA, arbitration and minimum-salary thresholds | **none: read** | The league's rules via the parent league. Missing → `indeterminate` |
| Which contracts are "market prices" (FA-eligible service) | **policy** | What the market is taken to mean (4.1): Player Rights' free-agency answer for this season. `MARKET_CONTRACT_CALIBRATION` (phase 2) |
| Opening replacement level | **provisional** | The export's WAR convention, measured per season from the export (.2877 in 2024, .2933 in 2026 to date; 2025 not measured). `REPLACEMENT_LEVEL_CALIBRATION` (phase 2). Measured from free talent in phase 4b once 30 freely acquired players are observed (below) |
| Replacement from freely available talent (WAR per 600 opportunities, for the club that took him) | **measured across imports** | Players acquired for nothing with a major-league record, identified by the contract snapshots (4.3); 30 players (`SIGNINGS_POLICY.replacement`, policy); none on Arizona yet |
| Opening price-of-win band (spread of bases) | **provisional** | R-5's bases, computed from each import. `OPENING_PRICE_CALIBRATION` (phase 2). Replaced by observed signings |
| Central value of the opening price | **policy** | The median of the market bases that could be computed: none is preferred. `OPENING_PRICE_CENTRAL_CALIBRATION` (phase 2) |
| What a basis of the opening price needs: a quarter of a schedule, 20 contracts | **policy** | `OPENING_PRICE_MINIMUMS`, stamped `OPENING_PRICE_MINIMUMS_CALIBRATION` (hardening, B-13). Below either, the basis is not computed. A season's WAR is put on this season's schedule's footing by the share it covered (a mechanism, no constant). CALIBRATION.md section 7 |
| This season | **none: read** | The league's own `season_year`, where its row states it; the regime league's only where it does not (hardening, D-14) |
| Which financial row is authoritative | **policy** | The row that names its season; `team_last_financials` named and never used (R-7). `FINANCE_ROW_CALIBRATION` (phase 2) |
| A financial row with every money field zero | **policy** | A placeholder: unknown, never $0 (R-1). `PLACEHOLDER_ROW_CALIBRATION` (phase 2) |
| When the measured price replaces the opening one | **policy** | When the measured band is narrower, in dollars, than the opening band with its sampling (Q-4; phase 4b), an unbounded opening sampling band being wider than any bounded one. No fixed count. Compared only when the measured price exists per win produced and its signings cover the class (review 2026-09-24, tightenings) |
| The measured bases, the price's unit and its check | **policy** | Over the deal, the first season and the first season if he plays, per win projected at signing; the first season per win produced, once completed. **The price in force is per win produced** (owner, 2026-09-24, `SIGNINGS_POLICY.priceUnit`): its central and band are the realized basis's; the per-projected-win bases are its check (their median and spread, and their ratio to the price), never in it (review R4-01 to R4-03, R4-07). CALIBRATION.md section 9 |
| Coverage of the free-agent class | **policy** | 5 priced signings in each third of the winter's free-agent class by expected wins (`SIGNINGS_POLICY.coverage.perThird`; review R4-02, a tightening) |
| Resampling across winters | **policy** | By winter, then by signing within each, once two winters are observed (review R4-05) |
| The reading's method | **mechanism** | `SIGNINGS_POLICY.method` (`signings-4b.3` since the owner's decisions: an arbitration salary's previous salary recorded): a stored pair is read again from its two snapshots when it changes (review R3-03), where both were kept; otherwise read as stored, under its own method |
| Which full contract snapshots are kept | **policy** | Owner, 2026-09-24 (`SIGNINGS_POLICY.retention`, `retainedImports`): the imports that bracket a winter and the most recent import; the others pruned at capture after the new pair is stored, never across save identities, never one a pair not yet stored under the current method needs; every pair and event kept |
| How a trade combines its players (phase 6b) | **policy** | Supervisor, extending the owner's Payroll rule (`TRADE_COMBINATION_POLICY`, stamped `TRADE_COMBINATION_POLICY_CALIBRATION`): each side's contract value and the difference between the sides are the sum of the players' most likely readings, each player's distance from his combined as independent (root sum of squares, low and high apart); an open season stays at its edges, added; a player going out enters reversed; labelled "players combined as independent; not a calibrated interval", the edge-to-edge sum beside it. Confirmed by the owner (2026-09-24, Part 12) |
| How Payroll combines players' projected seasons | **policy** | Owner, 2026-09-24 (`COST_COMBINATION_POLICY`, stamped `COST_COMBINATION_POLICY_CALIBRATION`): the sum of centrals, each player's distance from his central combined as independent (root sum of squares, low and high apart); status left open, a range of classes and may-leave at their edges, added; labelled "players combined as independent; not a calibrated interval", the edge-to-edge sum in the details |
| An arbitration salary is never below the previous season's salary | **policy** (owner-attested) | Owner, 2026-09-24 ("I've never seen a drop"): the game's rule as attested, basis `owner_attested`, stated by Player Rights (`ARBITRATION_NO_CUT_ATTESTATION`, stamped `ARBITRATION_NO_CUT_CALIBRATION`, `arbitrationSalaryFloor`) for every league whose regime as read has arbitration; not MLB's 20% rule. Changed only by the owner |
| The measured price of a win | **measured across imports** | Per win produced: the ratio of summed first-season salary above the minimum to the WAR the signings produced in that season (4.2; owner, 2026-09-24), with the per-projected-win check beside it; none on Arizona yet (one import) |
| How observed changes are read and measured: the bases, the resampling (1,000 draws, 10th–90th percentile, a fixed seed), 3 seasons of rights recorded, a free agent re-signed by a club that held him (at the earlier import, or during the season before by his lines) and a deal under way left out, a winter read by the calendar, replacement's 30 players (shown, never applied); the minimums reused (20 signings a basis, 30 awards a class, 30 reserve-clause renewals) | **policy** | `SIGNINGS_POLICY`, stamped `SIGNINGS_POLICY_CALIBRATION` (phase 4b). CALIBRATION.md section 9 |
| The opening band's sampling component | **policy** | Each market basis resampled over its own contracts by the same method (B-13's deferred component, phase 4b); the served opening band is unchanged |
| Observed arbitration salaries (coverage of the ladder's band; a class reading at 30) and reserve-clause renewals (the renewal spread at 30) | **measured across imports** | 4.4; none on Arizona yet |
| Arbitration ladder (per class: base, pay per platform win, spread, the line's bootstrap error, floor, the at-minimum deals and their platforms, the platforms measured on) | **measured per import** | The save's one-year arbitration contracts this season by Player Rights' class, snapshotted with the market (phase 4a, review method; Arizona $0.38M + $0.96M, $1.04M + $1.75M, $0.65M + $2.54M a platform win, 13 / 24 / 35% of the price's central). R-6's 22 / 42 / 53% is research; its method is the prior's source below. CALIBRATION.md section 8 |
| Pre-arbitration renewal spread and central | **measured per import** | The save's pre-arbitration one-year renewals this season (phase 4a; Arizona $780K–$790K on 249, central $780K, the median) |
| The cost ladder's method: the renewal band's 90th percentile and its 90% upper bound, its central the median; the two-season platform; a robust (Theil–Sen) line of a base and a pay per platform win; its uncertainty from 200 bootstrap refits (seed fixed); the 10th–90th spread; 1.28 of the line's standard errors, added to the spread edge against edge; 30 contracts a class (and renewals), and below that no line of its own; which contracts (one-year, set this winter, a contract at the minimum kept out of the line and letting a season whose platform reaches as low reach the minimum); a platform season needs a quarter of its schedule (`OPENING_PRICE_MINIMUMS.seasonShare`, reused) | **policy** | `COST_POLICY`, stamped `COST_POLICY_CALIBRATION` (phase 4a, review 2026-09-23). The platform choice is justified on the Arizona import (R² two seasons 0.715 / 0.300 / 0.626 against one 0.619 / 0.096 / 0.549); the robust line on its outliers (review R2-04); a decision, not a fit |
| The cost ladder's fallback prior (renewal band and median, and three arbitration classes, in minimums and shares of the price) | **provisional** | `COST_PRIOR`, stamped `COST_PRIOR_CALIBRATION`: the review's method on the Arizona import's imported real-world contracts (re-measured 2026-09-23). Used only below 30 contracts and only where the regime as read is MLB's and the minimum is above $0, widened by the range the save paid the class and labelled provisional |
| The class a season is priced in, beside its trip | **none: read** | Player Rights' `serviceClass` (the class his service puts him in, where one import's cross-section reads such a player; review R1-05) |
| A Super Two's fourth arbitration trip | **none: read** | Priced in the last arbitration class, where his service puts him (the export cannot separate it); Player Rights' `arbitrationRegimeOf` states the classes |
| Service projection edges (optioned against stays up) | **provisional** | This season's remaining days, from the season's service clock and capped by the schedule's days left, on the high edge; on the low edge only the days left on a major-league injured-list stint; each later season what the league's schedule banks (its calendar span, never more than the service year), a full service year where the export carries no schedule. Declared once as `SERVICE_PROJECTION_BASIS` in `playerRights.ts` (phase 1; schedule and injured list, hardening F2) |
| A season's bankable service | **none: read** | The export's `games` dates (regular season, `game_type` 0) and `leagues.current_date`, `seasonServiceCalendars` in `playerState.ts`; missing → the convention above, said |
| Super Two cutoff margin (10 days) | **policy** | Owner-approved, 2026-09-23: the cutoff's edges are readings, not bounds. Within 10 days of either edge the year is `indeterminate`. Chosen, not fitted: neighbours at the qualifying rank sit 0 to 5 days apart on the imported save, so it covers two or more single roster moves among the class. `SUPER_TWO_MARGIN_DAYS`, stamped `SUPER_TWO_MARGIN_CALIBRATION` in `playerRights.ts` |
| Opt-out timing (after contract year N) | **none: read** | `season_year + opt_out`; the reading, not established (R-6), and said on every season it touches |
| Super Two share (22%), prior-season days (86), MLB's regime (6 / 3 / 172) | **policy** | The game's rule as the owner attested it (2026-09-22; CBA Art. VI(E)(1)(b)). `SUPER_TWO_SHARE`, `SUPER_TWO_PRIOR_SEASON_DAYS`, `MLB_CONTRACT_REGIME` in `playerRights.ts`, stamped `SUPER_TWO_CALIBRATION`. Not fitted and not provisional: changed only by the owner's decision. The regime is compared against, never assumed |
| Super Two cutoff | **none: computed** | From the export's own class each winter, as a range across the projection readings |
| Which clause columns are "not populated" | **none: read** | A clause column that is 0 on every contract in the export is unknown, not "none" (R-6); measured per import |
| Discount rate | **policy** | **5% a season** (owner, 2026-09-24; `SURPLUS_POLICY.discountRate`, stamped `SURPLUS_POLICY_CALIBRATION`): a time preference, one stated rate in the neutral view; a season *s* seasons out weighs 1/1.05^*s*, this season's remaining part 1. `competitiveWindow` leans on it only in "our view" (Q-3; as built in 5b, from 0% to 15%, `LENS_POLICY.window`). No backtest can call it optimal |
| The price of a win in later seasons | **policy** | Held flat at the price in force (owner, 2026-09-24; `SURPLUS_POLICY.price`): no salary inflation is assumed unless the save's own measured price history later shows drift |
| How the rest of this season counts | **policy** | Its part still to be played: production's rest-of-season band, and the same share (the league's games not yet played) of his salary and of a replacement's minimum; banked wins and paid salary sunk, shown and never counted (`SURPLUS_POLICY.restOfSeason`). Salary paid in step with the schedule: owner-attested, 2026-09-24 |
| Money owed whatever the club does | **policy** | A major-league contract's salary for each season it covers, the current deal or a signed extension (`SURPLUS_POLICY.guaranteed`); it cancels in the retention margin. A minor-league deal's is not established |
| An option's buyout the export does not populate | **policy** | Read from nothing to the option's salary (`SURPLUS_POLICY.unknownBuyout`, owner-approved 2026-09-24); a buyout above the salary would make declining dearer than exercising. Declined options observed across imports can narrow it later |
| Production value: the minimum plus wins × price | **none: mechanism** | The price is salary above the minimum per win above the export's replacement level (4.1), so a replacement at 0 WAR costs the minimum; pinned by `playerValueSurplus.test.ts` |
| Projection horizon | **policy** | To the end of control, capped at 7 seasons (Q-3). Control is what the club owns. `CONTROL_HORIZON_SEASONS` in `playerValueCalibration.ts` (phase 1) |
| Production coverage targets (80% and 50%), era and hold-out rule, adoption gate and tolerance, minimum samples, prior strength and widening, usage tiers, two-way minimum, starter share, usage pivot age, proneness banding and evidence rule | **policy** | `PRODUCTION_POLICY`, stamped `PRODUCTION_POLICY_CALIBRATION` (phase 3a). Decisions about the method (D-053) |
| Band widening per horizon season (the tails, per kind and usage tier) | **fitted per save** (D-053) | The save's fit in `value_production_fits`, stamped by its run record; phase 3a |
| Widening for thin results | **fitted per save** | The rate's uncertainty, noise ÷ (sample + K): season noise and K fitted on the save; phase 3a |
| Regression (recency weights, K, the mean), season noise, drift, usage regression and its spread | **fitted per save** | The save's fit; phase 3a |
| Aging curve for production | **fitted per save** | Delta method on the save's consecutive seasons, hitters and pitchers apart. `roleReview.ts`'s `AGING_CURVE` answers another question and is not reused |
| Injury proneness's effect on usage and aging | **fitted per save**, used only at two standard errors | The save's fit; the prior carries none. Proneness itself is a known fact (`owner_attested`) |
| The fallback prior | **provisional** | `PRODUCTION_PRIOR`, `PRODUCTION_PRIOR_CALIBRATION`: the same method (`production-3b.1` since phase 3b) on the real history 2006–2025 the Arizona save imports; with `RATINGS_PRIOR`, the only fitted artefacts in code |
| Ratings → rate mapping (slopes, intercepts by position, forms without the glove, running or one pitching tool), its same-time uncertainty | **fitted per save** (D-053) | `value_production_fits` under `ratings-3h.3` (`ratings-3h.2` in hardening F5, `ratings-3h.1` in F4, `ratings-3b.1` before), stamped by its run record: a same-time fit on the save's major leaguers, gated on held-out players (phase 3b) |
| How often each batting hand faces left-handers; the stamina cut for a pitcher with no professional games; the largest scouted development by age | **fitted per save** | The ratings fit (phase 3b) |
| Arrival rates (chance of any major-league time and the time when he plays, by level, age band and horizon) | **fitted per save**; no prior | The ratings fit, from minor-league usage lines, held out by season; unmeasured is `unknown` (phase 3b). Since hardening F4: the origin season's call-ups kept apart in the later seasons, the league's own farm only (another market league's farm and independent leagues left out), any top-level league is arriving, and the model served refit through the last completed season. Since hardening F5: scored on rolling origins (the results fit's rule) and fitted with a 2-season recency half-life (`RATINGS_POLICY.backtest`, policy, the owner's option C). Since hardening F6: adopted horizon by horizon, a contiguous run of passing horizons through at least the next season; later seasons not established |
| A call-up's timing within a past season | **policy** (not measurable) | The export dates no past call-up: a call-up is taken as equally likely at any point of the season's games, so a player not yet called up at share f of his season is read with 1 − f of the season's call-ups still to come; the band reaches none and all (`RATINGS_POLICY.arrival`, hardening F4) |
| A prospect's chance and playing time by his projected quality | **fitted per save** (the results fit's own effect) and **measured per fit** (the cell's players now) | The results fit's quality coefficients at the same usage (the chance's logistic, playing time per scheduled game), located on 20 of each cell's players now (`RATINGS_POLICY.arrival.populationNodes`, policy) so the cell keeps its measured chance and playing time (hardening F4) |
| The ratings' reliability as a forecast | **fitted per save once measurable**; until then **policy** (the kind's K) | This season's snapshot against next season's rate, 50 per kind (phase 3b). None on this save yet |
| Development path (share of the gap to potential closed by age and years) | **provisional** until **fitted per save** | `RATINGS_PRIOR`'s cross-section path until the save holds 300 snapshot pairs a season apart; then the save's own, automatically (phase 3b) |
| Arrival chance by potential tier | **fitted per save once measurable** | 300 linked snapshot seasons, used at two standard errors (phase 3b). None on this save yet |
| Widening for partial ratings | **none: interval arithmetic** | A missing grade can be anywhere on the 20-80 scale (`RATINGS_POLICY.unknownGrade`, policy), an unknown potential any development up to the largest the save shows at his age. Never a midpoint (phase 3b). In the blend with results the band reaches the projection re-read with the grade at five stations across the scale (`RATINGS_POLICY.unknownGrade.stations`, policy; hardening F4) |
| Playing time conditional on quality (attrition logistic, playing time when he plays) and the tails by quality tier | **fitted per save** | The results fit, method `production-3b.1` (supervisor, 2026-09-23); the tiers' edges (tenths) are policy, `PRODUCTION_POLICY.qualityTiers` |
| The rate of the players who play at each horizon (selection), the playing time per scheduled game, each cell's distribution of wins when he plays, young players' drift | **fitted per save** | Method `production-3h.1` (hardening, 2026-09-23) |
| The physical ceiling of playing time per scheduled game, per kind | **fitted per save** (a measurement) | The most any player of the kind played in the fit's window; under the prior, the league's own last three seasons |
| Each season's schedule, and whether it was short | **none: read** | The standings' modal games per club (else the most games any player played), against its neighbours' |
| This season's in-season continuation | **measured per import** | This season's own game logs, per kind; unmeasured under 10 games per club each half (`PRODUCTION_POLICY.inSeason`, policy) |
| The fallback prior's mean and spreads under the league's own WAR scale | **derived** | The league's last three seasons (`PRODUCTION_POLICY.priorAdaptation`, policy) |
| The gate's tolerances (5 points pooled, 10 per subgroup; bias over 10% of the mean outcome, 0.05 wins and three standard errors clustered by player and origin), the age bands, the tail grid, the injury rules (a lost season under a quarter of his best; a days-out value held by 10 or more injured players over a year and contradicted by their state), the logistic's ridge | **policy** | `PRODUCTION_POLICY`, stamped `PRODUCTION_POLICY_CALIBRATION` (hardening) |
| The rolling origins (from the window's start + 5 to the season before the last, at most 8; a horizon scored with 200 cases from 3 or more origin cohorts) and the recency half-life (2 seasons) | **policy** | `PRODUCTION_POLICY.rolling`, `PRODUCTION_POLICY.window.recencyHalfLife` (owner's option C, 2026-09-23; method `production-3h.2`) |
| The ratings method's policy: sample rules, folds, position minimum, prior strength, age-band sizes, nodes, pair rule and minimums, the prior's development range | **policy** | `RATINGS_POLICY`, stamped `RATINGS_POLICY_CALIBRATION` (phase 3b) |
| The arrival gate: the absolute 10 points, and a bias beyond 10% of what happened and three standard errors clustered by player and by origin, on the chance and on the expected playing time; horizon 1 must be checkable | **policy** | `PRODUCTION_POLICY.gate.tolerance` and `RATINGS_POLICY.gate.arrivalBias` (hardening F4, B-15; two-way errors and the horizon-1 rule since F5): a tightening of the phase 3b gate, never a loosening (D-053 amendments) |
| The arrival model's adoption horizon by horizon: a contiguous run from the rest of this season, stopped by the first horizon that fails or cannot be checked, which must reach the next season | **policy** | `RATINGS_POLICY.adoption` (the owner's option (b), 2026-09-23, hardening F6); the tolerances unchanged |
| The ratings fallback prior | **provisional** | `RATINGS_PRIOR`, `RATINGS_PRIOR_CALIBRATION`: the ratings method with no prior on the Arizona import; no arrivals (phase 3b) |
| Widening outside the organization | **none** | Not applied: one rating row per player makes it unmeasurable (R-9, Q-2) |
| Personality bands (low / normal / high) | **policy** | The central mass at 80–120 on a 1–200 scale (R-8). No claim about OOTP's bands |
| Personality effects on price (greed, loyalty, play-for-winner) | **none until measured** | Shown as facts. They move no number until observed signings show their effect; phase 4b records the signings but does not yet read personality against them |
| Win curve (playoff odds per win) | **provisional** | The deadline read's odds model (`posture.ts` `oddsModelOf` / `oddsAt`, `playoffs.ts`): Pythagorean talent from this season's runs, the rival for the place a .520 club (`RIVAL_TALENT`), the difference over the games left read as normal. Not fitted on the save; in playoff odds only (Q-6). `WIN_CURVE_CALIBRATION` (phase 5b) |
| The win curve's extent | **policy** | Three wins fewer to five more over the rest of the season (`WIN_VALUE_POLICY`, phase 5b); a display choice |
| Lens weights | **policy** | `LENS_POLICY`, stamped `LENS_POLICY_CALIBRATION` (phase 5b, 6.1): no lean inside 40–60 (D-036's thresholds), linear to the limit at 0 or 100; the window's discount 0% to 15% against the neutral 5%; risk tolerance up to half way from the centre to the low edge; team control, cost efficiency and payroll flexibility ±20%; an aging season at 33 or older (words only). Each shown as a named lean with its amount |

The mechanisms (bands only widen with thinner evidence, the lens after the neutral value, sunk money cancels, unknown
is never a default) are architecture and carry no stamp: tests pin them.

---

## Part 12 — Owner answers (phase 0)

The owner answered these on 2026-09-22. Each answer is folded into the part it names.

- **Q-1 Control timeline.** Split. Arbitration and free-agency eligibility live in `playerRights.ts`, because
  D-023 gives rights one home. Player Value owns the cost band for each status and composes the timeline (1.3, 2.2,
  Part 10).
- **Q-2 Other organizations' players.** No widening until evidence exists. The export cannot measure the
  asymmetry, and an unmeasured widening would be an invented constant (2.3, Part 11).
- **Q-3 Discount and horizon.** The horizon runs to the end of control, capped at 7 seasons. The neutral view uses
  one stated policy rate, set in phase 5. `competitiveWindow` changes only "our view" (Part 11). *Set by the owner on
  2026-09-24 (below): 5% a season. Applied in phase 5b: the window changes our view's discount only (6.1), never the
  neutral one.*
- **Q-4 Measured price.** It replaces the opening price when its band is narrower than the opening band, not after
  a fixed count of signings (4.2). *Phase 4b review (2026-09-24):* the wording is unchanged; the comparison is made like
  for like, only once the measured bases hold the realized reading (the opening's unit) and cover the winter's
  free-agent class, both tightenings. Decided by the owner on 2026-09-24 (below): the price in force is per win
  produced, and the contract history is kept at the winters.
- **Q-5 Minor-league $0.** Read as `unknown`, never a cost of zero (2.1).
- **Q-6 Club value of a win.** In playoff-odds units until the save links odds to revenue (4.5). *Built in phase 5b:
  points of playoff odds per win and the curve, never dollars, never in the value (4.5).*
- **Q-7 Personality.** Shown as known fact. It moves no cost band until its effect is observed (Part 11).
- **Q-8 Trade Center difference.** Allowed as a band with its components, never a point, a single score or a
  verdict (Part 8).
- **Q-9 Minor-league WAR.** Not used in phase 3. Calibration against outcomes (D-037) decides later whether it adds
  anything for prospects (the league's `ml_equivalencies_*` columns are the candidate translation).
- **Q-10 Routing.** Player Value gets an `AGENTS.md` routing row and a Claude rule in phase 1 (Part 9).
- **Injuries (ruled 2026-09-23, the hardening).** Known days out are a fact: they come off expected playing time, so
  the central moves, and the band still widens for the uncertainty. A season lost to injury is never read as evidence
  of reduced future usage. Folded into 2.3; the phase 3a rule "a stated injury only widens" is superseded.
- **Super Two (ruled 2026-09-22, after phase 1).** OOTP implements Super Two under MLB rules, and Pennant follows
  the real rule: a player with at least two but fewer than three years of service is arbitration-eligible if he banked at least 86 days in the season just ending and ranks in the top 22% (rounded to the nearest whole number) by total service of the class of players with two to three years and those 86 days (CBA Art. VI(E)(1)(b)); the cutoff therefore moves every winter (in the real world about 2.115 to 2.140 years.days). This is the owner's statement of how OOTP behaves, a basis under D-018 and D-023
  (`owner_attested`), not a guess from MLB rules (2.2).
- **The production gate and its method (2026-09-23, hardening; D-053).** The owner chose option C: the gate's
  tolerances stay (pooled coverage within 5 points, every subgroup within 10; a bias fails at 10% of the mean outcome
  and 0.05 wins and three standard errors; 200 cases), and the backtest becomes rolling-origin, with a recency
  half-life where the evidence supports it (CALIBRATION.md section 6.3). The owner approved four rules the hardening
  had applied provisionally:
  - **The serving rule.** The model a GM is served is the method refit through the last completed season, and the
    held-out seasons are scored by refits of the same method (each origin's own), never by the served model.
  - **A career-ending injury.** The central goes to zero for the seasons it covers, and the band keeps its high edge
    (an earlier return stays possible).
  - **The rest of this season.** Measured from this season's own games so far (how much of their playing time the
    players who played early kept later), never next season's attrition.
  - **Same-time ratings pull less.** Until the save measures the ratings as a forecast, ratings read at the same time
    as the results pull the regression target only by their own weight, so they never undo the results regression.
- **The arrival model under option C (2026-09-23, hardening F5; D-053).** The owner approved: "the arrival model uses
  the same rolling-origin backtest and 2-season recency weighting approved for the results fit, judged by the same
  (tightened) gate; the gate is not loosened." Applied in method `ratings-3h.2` (2.3, CALIBRATION.md section 6.4). On
  the Arizona import the fit still fails at horizons 4 to 6, so prospects stay `unknown` there; the owner question that
  follows is in the hardening notes.
- **The arrival model adopted horizon by horizon (2026-09-23, hardening F6; D-053).** The owner chose option (b): "The
  arrival model is adopted horizon by horizon: a horizon whose held-out check passes the (unchanged, tightened) gate is
  served; later horizons are shown as not established. The gate is not loosened." Applied to the arrival model only, in
  method `ratings-3h.3` (2.3, CALIBRATION.md section 6.4): the horizons served are a contiguous run from the rest of this
  season through the last horizon whose check and every earlier one passed; horizon 1 must be in it; a season after it is
  not established, each with the gate's finding at its horizon. The results fit keeps its all-horizons rule. On the
  Arizona import the arrival model is served through 3 seasons out.
- **Super Two margin (2026-09-23, hardening).** The owner approved a policy margin of days around the computed
  cutoff range, within which the answer is `indeterminate`: the cutoff's edges are readings, not bounds. Set at 10
  days (Part 11), stamped policy under D-041 (2.2).
- **Contract and money readings (2026-09-23, hardening F2 and F3).** The owner approved these, applied
  provisionally during the hardening (the record is `docs/PLAYER_VALUE_HARDENING.md`):
  - **Arbitration trips as ranges.** Where the service projection cannot say which arbitration year a season is, the
    label is the range ("Arbitration 1–2"), never a single guessed count.
  - **Options outside committed payroll.** Club, vesting and mutual option years are not counted in committed totals;
    they are shown beside them as optional money ("+$23.0M in 2 club options, not counted").
  - **The opt-out reading inside extensions.** The exported opt-out count is read as after that contract year in an
    extension's seasons as in the current deal's, and stays a reading, not an established date (R-6).
  - **Price-of-win minimums.** A season (or this season's pace) covering under a quarter of the schedule, or a market of
    fewer than 20 contracts, is not used for the opening price (`OPENING_PRICE_MINIMUMS`, Part 11).
  - **Short seasons.** A season's salaries are taken to scale with its schedule, so a short season's WAR is priced in
    proportion to the schedule it covered, never as a full season (4.1).
- **Phase 4 owner decisions (2026-09-24; D-052 amendment).** The owner approved four rulings on the phase 4a and 4b
  reviews' open questions:
  - **The price in force, once measured, is per win produced** (the realized reading, the opening's own unit); the
    reading per win projected at signing is shown beside it as a check on the projection. The served price, its central
    and band, the adoption reason, Payroll's price line and the history follow it; the projected basis is never the price
    in force (4.2).
  - **Payroll combines players' uncertainty statistically** instead of summing every player's edges: the sum of centrals;
    each player's uncertainty around his central combined as independent across players (root sum of squares, low and
    high sides separately); what is not random noise (a status Player Rights leaves open, a range of arbitration classes,
    a player who may leave) stays at its edges, added. Stated as policy (`COST_COMBINATION_POLICY`, D-041), labelled
    "players combined as independent; not a calibrated interval", the edge-to-edge sum kept in the details, a single
    player's own band never narrowed (2.2, Part 3).
  - **An arbitration salary is never below the player's previous season's salary** (owner-attested: "I've never seen a
    drop"). A rule of the game as the owner attests it (basis `owner_attested`, like Super Two), stated once in Player
    Rights and consumed by the cost ladder; never an MLB assumption (not the CBA's 20% rule). Applied to every season
    priced as arbitration where the previous salary is known, chaining the low edges; "if held": a non-tender stays
    possible and is said. Phase 4b tests it: an observed arbitration salary below the previous salary is flagged,
    counted and named (4.4).
  - **Snapshot retention:** full contract snapshots only for the imports that bracket each winter and the most recent
    import; every stored pair and event kept as the durable record; pruned at capture time after the new pair is stored,
    never across save identities, never the latest, never one a pair still needs. A later method change cannot re-derive
    a pair from pruned snapshots (4.2, Part 7).
- **The neutral discount rate (2026-09-24, phase 5a; D-052 amendment).** The owner decided: **the neutral view's discount
  rate is 5% a season**, a time preference. The price of a win is held flat (no salary inflation is assumed) unless the
  save's own measured price history later shows drift. A season *s* seasons from now weighs 1/1.05^*s*; this season's
  remaining part weighs 1. Stated as policy under D-041 (`SURPLUS_POLICY`, stamped `SURPLUS_POLICY_CALIBRATION`; Part 11)
  and applied in 5.1.
- **Phase 5a's readings (2026-09-24).** The owner approved the four readings the supervisor had applied provisionally in
  5a (5.1, Part 11): (1) production value is the league minimum plus wins × price, so a replacement at 0 WAR paid the
  minimum is worth nothing, not less; (2) an option's buyout the export does not populate is read from nothing to the
  option's salary. The owner left room for a better method: once the save observes declined options across imports
  (4b), their buyouts can narrow it. (3) Salary is paid in step with the schedule when this season's remaining part is
  split off; the owner believes that is how OOTP pays (`owner_attested`). (4) In a league without financials, the wins
  total is discounted at the same 5%.
- **Recorded at the server's start (2026-09-24, 4b).** The owner approved the supervisor's call that the server's start
  records the imported export's market and contracts when this build has not yet (Part 7).
- **Deferred to phase 6 (2026-09-23, hardening).** A-20 (the `unverified` limitation and data freshness reaching the
  GM on consumer routes) and D-26 (pre-fork consumer routes failing on older export shapes) are consumer-migration
  questions and move with the consumers (Part 8). Phase 6a met A-20 for Contracts, the card and the one-player value
  routes (Part 8); phase 6c for Payroll, Free Agents and the Trade Center; the other consumers carry it with their own
  migration (6d Org Comparison, 6e the trading block). D-26 is still open for them (Free Agents now lists no available
  players, and says why, where the export lacks `free_agent` or `last_league_id`).
- **The consumer migration's questions (2026-09-24, phases 6a to 6d; D-052 amendment).** The owner approved every
  recommendation as made:
  - **6a, the card's header and Contracts.** The header's "Some terms not in the export" stays, muted, with the unpopulated
    clauses on hover. The dashboard counts "Heading to arbitration" (the old "Extension candidates" stays gone). The header
    shows contract value only; the value of keeping him stays in the Value section below.
  - **6b, the Trade Center.** A trade combines its players as independent (`TRADE_COMBINATION_POLICY`, the Payroll rule
    extended, confirmed; the edge-to-edge sum stays beside it). The AI desk gives no accept-or-reject line (D-001). Trade fits
    order by most likely wins, a shown comparison; a match need not clear the other club's best by its range.
  - **6c, Free Agents and the AI.** A free agent is shown with one season at the market; no multi-season reading for now
    (multi-year terms are the GM's to set). The players the control timeline leaves between staying and free agency after
    this season are listed as a third chip, "Might reach the market", each with the reason on hover, the same columns,
    unknowns last and no verdict, never mixed into the free agents after this season (built in phase 6e, Part 8). The
    briefing's "Recommendation of the Week" heading becomes "Worth a look this week", worded as something to look at, never
    an instruction (built in 6e).
  - **6d, Org Comparison, the Roster and the Lineup.** A bat with no split grades against a hand is read on his overall
    grades and labelled so (not left unknown). Org Comparison keeps the roster's contract value as a column, a range. The farm
    column keeps established players sent down: its top contributor is the nearest help, not the best prospect, and the hover
    says so.
