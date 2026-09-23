# Player Value

Design record for the Player Value subsystem: contracts, control, cost, expected production, the save's financial
reality and surplus value. Decision: [D-052](DECISIONS.md) (accepted; owner answers in Part 12). Research evidence:
[PLAYER_VALUE_RESEARCH.md](PLAYER_VALUE_RESEARCH.md) (R-1 to R-11).

**Status: phases 1, 2 and 3a built (contract facts and control; Club Finances, the opening price of a win and the
per-import market snapshot; expected production in wins from major-league results, fitted per save under D-053,
Part 9); phases 3b to 6 are design.** `PROJECT_STATE.md` says
what exists; this file says what is to be built and why. Every surface that reports value still reads the prohibited
`players_value` fields for its value figures (Part 8), and they stay as they are until the phase that replaces each
one; since phase 1 their control and contract facts come from Player Value.

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
| Option | Both branches shown: exercised (the salary) and declined (the buyout, which is `unknown` here) |
| Pre-arbitration renewal | From the league minimum up to the observed renewal spread (a band, never simply the minimum) |
| Arbitration year *n* | A band from the arbitration ladder (Part 4.4), never the league minimum |
| Free agent | Control ends. What he is worth to others is market data, not cost to this club |
| Reserve clause | Renewal cost from the league's observed pay (a band) |

**Service projection** is itself a band. The low edge assumes he is optioned or hurt; the high edge assumes he stays
on the active list for the rest of the season. When the free-agency or arbitration line falls inside that band, the
season's status is `indeterminate`, and the dates on either side are stated.

**Unknowns:** a missing rule (FA years, arbitration years, service-year length) makes the dependent status
`indeterminate`. It never becomes 6 / 3 / 172 (R-10). **Super Two** is OOTP's rule under MLB rules (owner, 2026-09-22;
Part 12): a player with at least two but fewer than three years of service is arbitration-eligible if he banked at least 86 days in the season just ending and ranks in the top 22% (rounded to the nearest whole number) by total service of the class of players with two to three years and those 86 days (CBA Art. VI(E)(1)(b)); the cutoff therefore moves every winter (in the real world about 2.115 to 2.140 years.days). Player Rights computes the cutoff from the export's own class at the end of this season, once
per contract regime (`superTwoCutoffs`). Every member's service and his days this season are projections, so the
cutoff is a range of reasonable readings, from the men on a major-league roster now banking the rest of the season
to every member banking it. A reading in which nobody banks another day is excluded because the season is played
and its roster spots are filled; in May it would also leave nobody with 86 days and no class at all. A player above
the cutoff's high edge with his 86 days is arbitration-eligible (basis `owner_attested`). A player below its low
edge, or short of 86 days, is pre-arbitration. A player whose own range overlaps it is `indeterminate`, naming both
edges. It applies only where the league's regime as read is MLB's: no export column names a rule set or Super Two,
so it is detected by free agency 6, arbitration 3 and a 172-day service year. Any other regime keeps the window
`indeterminate`, as does last winter's class (last season's days are not exported) and any later winter's (that
class does not exist yet). **`has_received_arbitration`** is 0 for every player on this save and carries no information
(R-3). It is not read until an import shows it set.

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
  quality: see below), never from a philosophy, with its own band. A stated injury (`injury_is_injured`, `injury_left`, `injury_dl_left`, `injury_career_ending`) only lowers
  a low edge, sized by the days out against the season's calendar measured from the save; a career-ending one puts
  producing nothing inside every season's band.
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

### 2.5 Surplus

Per controlled season: production value (wins × price of a win) less cost, discounted to today, and summed. It is
reported as a band **with every component visible**: the wins band, the price band, the cost band, the discount, and
the seasons included. Part 5 sets out the arithmetic and the sunk-cost rule.

---

## Part 3 — Units, bands and uncertainty

- **Wins** are the production unit. **Dollars** are derived from the save's own economy (Part 4). When the league
  has no financials (`rules_financials = 0` with no salaries), value is reported in wins and dollars are `unknown`,
  stating why.
- **A band is three numbers and a basis.** It is not a confidence interval Pennant cannot justify. Until a band's
  coverage is calibrated it is labelled a *range of reasonable readings* and each edge says what produced it. Expected
  production (phase 3a) is calibrated: an 80% and a 50% central interval, whose held-out coverage per horizon is
  measured on the save's own history and recorded with the fit (D-053, Part 7). Every season carries its targets
  beside the coverage the fit in force observed at that horizon (`coverage.target`, `coverage.observed`; observed is
  `null`, "not measured on this save", under the fallback prior), so the interface can say "80% target · 82% observed".
  A projection from ratings alone (phase 3b) cannot be backtested until the save holds rating snapshots across
  seasons: its seasons carry `observed: null`, "not measured", and its development range is the provisional prior's
  range of readings. Its arrival part is checked on held-out seasons (the ratings fit's record).
- **Combining bands** uses interval arithmetic: low with low, high with high, cost subtracted edge against opposite
  edge. That widens honestly and assumes no independence the evidence cannot support. Phase 5 may replace it with a
  calibrated method once coverage is measured.
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

### 4.2 How it tightens

At every import the market figures are snapshotted (Part 7). From the second import across an off-season,
contracts whose `season_year` or `years` changed, or whose club changed, are observed signings (R-6). Their salary,
set against the signed player's expected wins at the time, is a direct price observation. The measured price
replaces the opening one **when its band is narrower than the opening band** (owner, Q-4): the evidence decides,
not a fixed count of signings. The band narrows only as those observations accumulate. The history of the price stays visible, so drift can be seen.
Arbitration awards are identified the same way and measure the arbitration ladder (4.4).

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

### 4.4 Arbitration

Until arbitration outcomes are observed across an off-season, an arbitration-year cost is a band from the
cross-sectional ladder on the imported contracts (R-6): about 22%, 42% and 53% of the FA-eligible price per win in
the first three arbitration years, with a wide spread. **Provisional**, from imported real-world contracts. It is
never the league minimum, and never a point.

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

---

## Part 7 — Compute and caching

- **League-wide, once per import.** Every active player (12,575 on this save; R-9) is valued, including unsigned
  players and other organizations'.
- **Lazily, on the first request**, computed once and shared by every concurrent request (single-flight).
  Optionally it is warmed after an import finishes, fire-and-forget, never able to fail the import (the pattern of
  `takeSnapshot` in `api.ts` `runImport`).
- **A disposable derived store keyed by the import** (save name, game date, import finish time). It is dropped
  where `clearValuationCaches()` is called today and can be deleted at any time without loss. It is not `history.db`.
- **The philosophy lens at read time**, so a philosophy edit never recomputes anything.
- **Market figures snapshotted per import into `history.db`** (D-009): the price of a win (band and basis),
  replacement level, league regime, league payroll, the observed signings counted. Keyed by save, league and game
  date, idempotent per key, so drift is visible across imports.
- **No periodic timer.** Data changes only on import (D-009).
- **One domain API** (D-008). Browser, desktop, static export and AI read the same routes. The AI receives the
  decomposition with its basis and never a bare number (the lesson `VALUE_PERCENTILE_NOTE` records).

Phase 1 times the full-league compute on this import before choosing lazy-only or warm-after-import (R-9 sizes it
at a few hundred thousand rows).

**The production fit store (phase 3a, D-053).** Table `value_production_fits` in `history.db`
(`playerValueFitStore.ts`, Player Value's second writer): one row per save, league, last completed season and
method version (the primary key), additive (`CREATE TABLE IF NOT EXISTS`) and idempotent (`INSERT OR IGNORE`; only a
developer's forced refit replaces a row). Each row holds the fitted model as JSON, the run record (window, training and
held-out seasons, sample, prior weight, held-out coverage per horizon for both bands, pooled, by kind and by usage
tier, the aging summary, the proneness findings, the gate's verdict and reason), whether it was adopted, the import's
game date and the time the fit took; the wall-clock time is a diagnostic only. The model in force is the adopted row
with the latest completed season; with none, the provisional fallback prior, labelled "not yet calibrated on this save
(N seasons)" with why. **Refit:** `runImport` calls `refitProductionIfNeeded` after the import has finished, in the
background (`setImmediate`, inside a try/catch that logs), so it can never block or fail the import. A league's last
completed season is this season once every club has played its schedule (`team_record`), else the one before; a key
already fitted is skipped, so a re-import without a newer completed season fits nothing. The same background refit also runs once at server start for a save that is already imported (`bootstrapData`), so a save with no fit for its latest completed season (a new install, or a method version that ignores the stored fit) is fitted without waiting for an import; it does not need the export folder. No timer, no wall-clock
date. **Served** by `GET /api/player-value/production-fit/:orgId` (the fit in force, the latest attempt, the targets)
and in every production answer's basis. **Forced** by `npx tsx scripts/calibrate.ts production --refit`.

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
| 1 | Contracts (`contracts.ts`) | `valuesByPlayer`, `mlbPercentiler`; percentile cut-offs at 70/75 (`recommendOnValue`); `SERVICE_DAYS_PER_YEAR = 172`; `controlAfterThisSeason` with service missing → 0 | Contract facts, control and cost path, production, surplus. `controlAfterThisSeason` and the percentile advice deleted |
| 2 | Payroll (`payroll.ts`) | Facts only; its control column comes from `controlAfterThisSeason` | The control timeline from concern 2, and club finances from concern 4 |
| 3 | Trade Center (`trade.ts`, `tradingblock.ts`, AI trade context) | `analyze` sums raw `overall_value` | Both sides' value decompositions side by side: surplus bands and control. The difference between the sides is shown as a band with its components (owner, Q-8), never as a point, a single score or a verdict |
| 4 | Free Agents (`freeagents.ts`) | `players_value` | Expected production and the market price; cost as the market's band |
| 5 | Org Comparison (`franchise.ts`) | `players_value` | Club finances and aggregated production, each with its basis |
| 6 | Player card and others (`player.ts:272`, `lineup.ts:288`, `api.ts:462`, `valuation.ts` `rosterHoles`) | `players_value` | Classified in phase 6. A read that is not a value question (a lineup's quality of cover) moves to `scoutedEvidence.ts` under its owner, not to Player Value |

The end state: no production module reads `players_value`, `mlbPercentiler` and `VALUE_PERCENTILE_NOTE` are gone,
and the evidence boundary test's allow-list for `players_value` is empty.

**The player card shows expected production (2026-09-23), ahead of its phase-6 migration.** An "Expected production"
section draws the production cone (`src/ProductionCone.tsx`, visx, D-054): wins per season with the 80% and 50% bands
as nested washes, the expected path as a dotted line with a marker per season, replacement level (0) as a labelled
dashed baseline, and each season's control beneath it (signed, an option, pre-arbitration, arbitration *n*, reserve,
not established, and "free agent after" on the last controlled season). Seasons run from this one to the last
controlled season, capped by the production horizon; where the end of control is not established (unsigned, unknown,
or past the horizon) the whole horizon is drawn and each season says so. The legend says what the bands mean ("80%
of outcomes fall inside"); hover or keyboard focus on a season shows its central and both bands, each band's
"target · observed" coverage ("not measured on this save" when the fit did not measure it, never the target), the
seasons and plate appearances or batters faced it rests on, playing time and control. One line under the chart states
calibration: "Calibrated on this save: 2006–2025, refit after the 2025 season", or "Not yet calibrated on this save
(N seasons)". Unknown production draws no cone and states the reason. A cone may narrow (a fading player's playing
time), and negative wins stay on the axis. The join is Player Value's (`playerValueCone.ts`, `productionCone`, served
at `/api/player-value/:playerId/cone`); the card computes nothing. The card's existing `players_value` reads (Value,
Talent) are untouched until phase 6. A static site export does not carry the route, so its cards omit the section.

---

## Part 9 — Phases and exit criteria

| Phase | Builds | Exit criteria |
|---|---|---|
| **0** (this document) | Design, research, D-052, behavior cases | Done: the owner accepted D-052 and answered Q-1 to Q-10 (Part 12) |
| **1** Contract facts and control — **done** (2026-09-22; evidence in Part 7 and below) | Concerns 1 and 2. Arbitration and free-agency eligibility added to `playerRights.ts` (Q-1). **One `LeagueRules`** (merge `valuation.ts`'s into `leagueRules.ts`'s `Sourced` form: every column guarded, no 6/3 fallback, service-year length from `rules_min_service_days`, the regime through `parent_league_id`). Missing service time is `unknown`, never 0. `controlAfterThisSeason` replaced in place. The boundary test (Part 10). A timed league-wide compute | Every active player has a control timeline, with every `indeterminate` counted and its reason named. Payroll's control column reads it. The boundary test passes. The full-league time is recorded here. Player Value has an `AGENTS.md` routing row and a Claude rule (Q-10). `tsc`, `npm test` and the build are clean |
| **2** Club Finances and the opening price — **done** (2026-09-22; evidence in 2.4, 4.1, 4.3, Part 7 and below) | Concern 4. The per-import market snapshot in `history.db`. The opening price of a win and the replacement level with their bases | This save's opening price reproduces R-5's band from code. A snapshot is written once per import key. A league without financials yields wins and dollars `unknown`. No timer |
| **3a** Expected production from results — **done** (2026-09-22; evidence below, Part 7, CALIBRATION.md section 6) | Concern 3 for players with a major-league record, in wins, an 80% and a 50% band per season (Part 2.3). Calibrated per save (D-053): the fit and its backtest, the fit store, the refit after an import, the gate, the provisional prior. Injury proneness read as a known fact and its effect measured | A fit is recorded with its run record and adopted through the gate. The band invariants (Behavior cases) pass. Held-out coverage is reported per horizon for both bands. The timing is recorded |
| **3b** Expected production from ratings — **done** (2026-09-23; evidence below, Part 7, CALIBRATION.md section 6) | Ratings through `scoutedEvidence.ts` for prospects and players with thin or no major-league results, partial-rating widening, a prospect's low edge including producing nothing. Also (supervisor, 2026-09-23): playing time conditional on quality | The 3b behavior cases pass. Removing a rating never narrows a band; no ability evidence leaves that component `unknown` |
| **4** Measured price and arbitration | Observed signings and arbitration awards across imports. The measured price replaces the opening one once its band is narrower (Q-4). The arbitration ladder is measured. Replacement is measured from freely available talent | On an off-season import, signings are identified and counted. While the measured band is still wider, the opening price stays and says why. The price history is visible |
| **5** Surplus, the lens and the win curve | Concern 5, Part 5's two views, Part 6's lens, Part 4.5's club value of a win | The Player Value behavior cases pass. Neutral value is identical under every philosophy. Every lean is named |
| **6** Consumer migration | Part 8, in order, one consumer per change | Each change deletes that consumer's `players_value` reads. Finally, the `players_value` allow-list is empty |

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
out; a proneness of 0 is unknown (the export's unfilled value); the prior carries no proneness effect.

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
price costs, not the market, and are left for the phase that builds cost bands (4.4), not pulled forward.

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
   phase by phase, and the `players_value` allow-list shrinks as it does.
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

---

## Part 11 — Constants register

Stamps per D-041, amended by D-053: a **fitted per save** value is computed from the save's own history and stamped by
its run record in `history.db`; code holds only policy, provisional values and the fallback prior. Phase 2's stamps are
declared in `playerValueCalibration.ts`, with the label `OPENING_PRICE_LABEL` and `PRICE_NARROWS_WHEN`; it adds no
numeric constant. Phase 3a adds `PRODUCTION_POLICY` (policy) and `PRODUCTION_PRIOR` (provisional). Phase 3b adds
`RATINGS_POLICY` (policy), `RATINGS_PRIOR` (provisional) and `PRODUCTION_POLICY.qualityTiers` (policy).

| Constant | Stamp | Basis |
|---|---|---|
| Service-year length | **none: read** | `rules_min_service_days`. Missing → unknown, never 172 (R-3) |
| FA, arbitration and minimum-salary thresholds | **none: read** | The league's rules via the parent league. Missing → `indeterminate` |
| Which contracts are "market prices" (FA-eligible service) | **policy** | What the market is taken to mean (4.1): Player Rights' free-agency answer for this season. `MARKET_CONTRACT_CALIBRATION` (phase 2) |
| Opening replacement level | **provisional** | The export's WAR convention, measured per season from the export (.2877 in 2024, .2933 in 2026 to date; 2025 not measured). `REPLACEMENT_LEVEL_CALIBRATION` (phase 2). Measured from free talent in phase 4 |
| Opening price-of-win band (spread of bases) | **provisional** | R-5's bases, computed from each import. `OPENING_PRICE_CALIBRATION` (phase 2). Replaced by observed signings |
| Central value of the opening price | **policy** | The median of the market bases that could be computed: none is preferred. `OPENING_PRICE_CENTRAL_CALIBRATION` (phase 2) |
| Which financial row is authoritative | **policy** | The row that names its season; `team_last_financials` named and never used (R-7). `FINANCE_ROW_CALIBRATION` (phase 2) |
| A financial row with every money field zero | **policy** | A placeholder: unknown, never $0 (R-1). `PLACEHOLDER_ROW_CALIBRATION` (phase 2) |
| When the measured price replaces the opening one | **policy** | When the measured band is narrower than the opening band (Q-4). No fixed count |
| Arbitration ladder shares (about 22 / 42 / 53%) and their spread | **provisional** | Cross-section of imported contracts (R-6) |
| Pre-arbitration renewal spread | **provisional** | Observed pre-arbitration pay above the minimum (R-5) |
| Service projection edges (optioned against stays up) | **provisional** | This season's remaining days, from the season's service clock, on the high edge only; each later season a full service year on both edges. Declared once as `SERVICE_PROJECTION_BASIS` in `playerRights.ts` (phase 1) |
| Super Two share (22%), prior-season days (86), MLB's regime (6 / 3 / 172) | **policy** | The game's rule as the owner attested it (2026-09-22; CBA Art. VI(E)(1)(b)). `SUPER_TWO_SHARE`, `SUPER_TWO_PRIOR_SEASON_DAYS`, `MLB_CONTRACT_REGIME` in `playerRights.ts`, stamped `SUPER_TWO_CALIBRATION`. Not fitted and not provisional: changed only by the owner's decision. The regime is compared against, never assumed |
| Super Two cutoff | **none: computed** | From the export's own class each winter, as a range across the projection readings |
| Which clause columns are "not populated" | **none: read** | A clause column that is 0 on every contract in the export is unknown, not "none" (R-6); measured per import |
| Discount rate | **policy** | One stated rate in the neutral view, its value set when phase 5 builds surplus. `competitiveWindow` leans on it only in "our view" (Q-3). No backtest can call it optimal |
| Projection horizon | **policy** | To the end of control, capped at 7 seasons (Q-3). Control is what the club owns. `CONTROL_HORIZON_SEASONS` in `playerValueCalibration.ts` (phase 1) |
| Production coverage targets (80% and 50%), era and hold-out rule, adoption gate and tolerance, minimum samples, prior strength and widening, usage tiers, two-way minimum, starter share, usage pivot age, proneness banding and evidence rule | **policy** | `PRODUCTION_POLICY`, stamped `PRODUCTION_POLICY_CALIBRATION` (phase 3a). Decisions about the method (D-053) |
| Band widening per horizon season (the tails, per kind and usage tier) | **fitted per save** (D-053) | The save's fit in `value_production_fits`, stamped by its run record; phase 3a |
| Widening for thin results | **fitted per save** | The rate's uncertainty, noise ÷ (sample + K): season noise and K fitted on the save; phase 3a |
| Regression (recency weights, K, the mean), season noise, drift, usage regression and its spread | **fitted per save** | The save's fit; phase 3a |
| Aging curve for production | **fitted per save** | Delta method on the save's consecutive seasons, hitters and pitchers apart. `roleReview.ts`'s `AGING_CURVE` answers another question and is not reused |
| Injury proneness's effect on usage and aging | **fitted per save**, used only at two standard errors | The save's fit; the prior carries none. Proneness itself is a known fact (`owner_attested`) |
| The fallback prior | **provisional** | `PRODUCTION_PRIOR`, `PRODUCTION_PRIOR_CALIBRATION`: the same method (`production-3b.1` since phase 3b) on the real history 2006–2025 the Arizona save imports; with `RATINGS_PRIOR`, the only fitted artefacts in code |
| Ratings → rate mapping (slopes, intercepts by position, forms without the glove, running or one pitching tool), its same-time uncertainty | **fitted per save** (D-053) | `value_production_fits` under `ratings-3b.1`, stamped by its run record: a same-time fit on the save's major leaguers, gated on held-out players (phase 3b) |
| How often each batting hand faces left-handers; the stamina cut for a pitcher with no professional games; the largest scouted development by age | **fitted per save** | The ratings fit (phase 3b) |
| Arrival rates (chance of any major-league time and the time when he plays, by level, age band and horizon) | **fitted per save**; no prior | The ratings fit, from minor-league usage lines, held out by season; unmeasured is `unknown` (phase 3b) |
| The ratings' reliability as a forecast | **fitted per save once measurable**; until then **policy** (the kind's K) | This season's snapshot against next season's rate, 50 per kind (phase 3b). None on this save yet |
| Development path (share of the gap to potential closed by age and years) | **provisional** until **fitted per save** | `RATINGS_PRIOR`'s cross-section path until the save holds 300 snapshot pairs a season apart; then the save's own, automatically (phase 3b) |
| Arrival chance by potential tier | **fitted per save once measurable** | 300 linked snapshot seasons, used at two standard errors (phase 3b). None on this save yet |
| Widening for partial ratings | **none: interval arithmetic** | A missing grade can be anywhere on the 20-80 scale (`RATINGS_POLICY.unknownGrade`, policy), an unknown potential any development up to the largest the save shows at his age. Never a midpoint (phase 3b) |
| Playing time conditional on quality (attrition logistic, playing time when he plays) and the tails by quality tier | **fitted per save** | The results fit, method `production-3b.1` (supervisor, 2026-09-23); the tiers' edges (tenths) are policy, `PRODUCTION_POLICY.qualityTiers` |
| The ratings method's policy: sample rules, folds, position minimum, prior strength, age-band sizes, nodes, pair rule and minimums, the prior's development range | **policy** | `RATINGS_POLICY`, stamped `RATINGS_POLICY_CALIBRATION` (phase 3b) |
| The ratings fallback prior | **provisional** | `RATINGS_PRIOR`, `RATINGS_PRIOR_CALIBRATION`: the ratings method with no prior on the Arizona import; no arrivals (phase 3b) |
| Widening outside the organization | **none** | Not applied: one rating row per player makes it unmeasurable (R-9, Q-2) |
| Personality bands (low / normal / high) | **policy** | The central mass at 80–120 on a 1–200 scale (R-8). No claim about OOTP's bands |
| Personality effects on price (greed, loyalty, play-for-winner) | **none until measured (phase 4)** | Shown as facts. They move no number until observed signings show their effect |
| Win curve (playoff odds per win) | **provisional** | `posture.ts` / `playoffs.ts` odds |
| Lens weights | **policy** | Each shown as a named lean |

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
  one stated policy rate, set in phase 5. `competitiveWindow` changes only "our view" (Part 11).
- **Q-4 Measured price.** It replaces the opening price when its band is narrower than the opening band, not after
  a fixed count of signings (4.2).
- **Q-5 Minor-league $0.** Read as `unknown`, never a cost of zero (2.1).
- **Q-6 Club value of a win.** In playoff-odds units until the save links odds to revenue (4.5).
- **Q-7 Personality.** Shown as known fact. It moves no cost band until its effect is observed (Part 11).
- **Q-8 Trade Center difference.** Allowed as a band with its components, never a point, a single score or a
  verdict (Part 8).
- **Q-9 Minor-league WAR.** Not used in phase 3. Calibration against outcomes (D-037) decides later whether it adds
  anything for prospects (the league's `ml_equivalencies_*` columns are the candidate translation).
- **Q-10 Routing.** Player Value gets an `AGENTS.md` routing row and a Claude rule in phase 1 (Part 9).
- **Super Two (ruled 2026-09-22, after phase 1).** OOTP implements Super Two under MLB rules, and Pennant follows
  the real rule: a player with at least two but fewer than three years of service is arbitration-eligible if he banked at least 86 days in the season just ending and ranks in the top 22% (rounded to the nearest whole number) by total service of the class of players with two to three years and those 86 days (CBA Art. VI(E)(1)(b)); the cutoff therefore moves every winter (in the real world about 2.115 to 2.140 years.days). This is the owner's statement of how OOTP behaves, a basis under D-018 and D-023
  (`owner_attested`), not a guess from MLB rules (2.2).
