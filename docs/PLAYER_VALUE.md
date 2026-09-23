# Player Value

Design record for the Player Value subsystem: contracts, control, cost, expected production, the save's financial
reality and surplus value. Decision: [D-052](DECISIONS.md) (accepted; owner answers in Part 12). Research evidence:
[PLAYER_VALUE_RESEARCH.md](PLAYER_VALUE_RESEARCH.md) (R-1 to R-11).

**Status: phase 0, design only. Nothing described here is implemented.** `PROJECT_STATE.md` says what exists; this
file says what is to be built and why. Every surface that reports value today reads the prohibited `players_value`
fields (Part 8), and they stay as they are until the phase that replaces each one.

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
`indeterminate`. It never becomes 6 / 3 / 172 (R-10). **Super Two** is an `indeterminate` window, not a rule: the
imported contracts show the real-world step at about 470–480 days (R-6), and whether OOTP's simulation grants it
is unresolved. **`has_received_arbitration`** is 0 for every player on this save and carries no information
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

- with the horizon: every season further out is wider than the one before;
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
(D-037): predict season *t+1* from seasons up to *t*, band coverage included.

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

### 2.5 Surplus

Per controlled season: production value (wins × price of a win) less cost, discounted to today, and summed. It is
reported as a band **with every component visible**: the wins band, the price band, the cost band, the discount, and
the seasons included. Part 5 sets out the arithmetic and the sunk-cost rule.

---

## Part 3 — Units, bands and uncertainty

- **Wins** are the production unit. **Dollars** are derived from the save's own economy (Part 4). When the league
  has no financials (`rules_financials = 0` with no salaries), value is reported in wins and dollars are `unknown`,
  stating why.
- **A band is three numbers and a basis.** It is not a confidence interval Pennant cannot justify. Until phase 3
  calibrates coverage it is labelled a *range of reasonable readings* and each edge says what produced it.
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

### 4.2 How it tightens

At every import the market figures are snapshotted (Part 7). From the second import across an off-season,
contracts whose `season_year` or `years` changed, or whose club changed, are observed signings (R-6). Their salary,
set against the signed player's expected wins at the time, is a direct price observation. The measured price
replaces the opening one **when its band is narrower than the opening band** (owner, Q-4): the evidence decides,
not a fixed count of signings. The band narrows only as those observations accumulate. The history of the price stays visible, so drift can be seen.
Arbitration awards are identified the same way and measure the arbitration ladder (4.4).

### 4.3 Replacement level

The opening replacement level is **the one the export's WAR already uses**, measured from the save as (league wins −
league WAR) ÷ league games: .288 in 2024 and .293 in 2026 to date, about 47 wins per 162 (R-4). Adopting it keeps
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

---

## Part 9 — Phases and exit criteria

| Phase | Builds | Exit criteria |
|---|---|---|
| **0** (this document) | Design, research, D-052, behavior cases | Done: the owner accepted D-052 and answered Q-1 to Q-10 (Part 12) |
| **1** Contract facts and control | Concerns 1 and 2. Arbitration and free-agency eligibility added to `playerRights.ts` (Q-1). **One `LeagueRules`** (merge `valuation.ts`'s into `leagueRules.ts`'s `Sourced` form: every column guarded, no 6/3 fallback, service-year length from `rules_min_service_days`, the regime through `parent_league_id`). Missing service time is `unknown`, never 0. `controlAfterThisSeason` replaced in place. The boundary test (Part 10). A timed league-wide compute | Every active player has a control timeline, with every `indeterminate` counted and its reason named. Payroll's control column reads it. The boundary test passes. The full-league time is recorded here. Player Value has an `AGENTS.md` routing row and a Claude rule (Q-10). `tsc`, `npm test` and the build are clean |
| **2** Club Finances and the opening price | Concern 4. The per-import market snapshot in `history.db`. The opening price of a win and the replacement level with their bases | This save's opening price reproduces R-5's band from code. A snapshot is written once per import key. A league without financials yields wins and dollars `unknown`. No timer |
| **3** Expected production | Concern 3, in wins, bands per Part 2.3, calibrated against the export's WAR history through the calibration harness | A calibration run is recorded and its constants stamped. The band invariants (Behavior cases) pass. Band coverage is reported |
| **4** Measured price and arbitration | Observed signings and arbitration awards across imports. The measured price replaces the opening one once its band is narrower (Q-4). The arbitration ladder is measured. Replacement is measured from freely available talent | On an off-season import, signings are identified and counted. While the measured band is still wider, the opening price stays and says why. The price history is visible |
| **5** Surplus, the lens and the win curve | Concern 5, Part 5's two views, Part 6's lens, Part 4.5's club value of a win | The Player Value behavior cases pass. Neutral value is identical under every philosophy. Every lean is named |
| **6** Consumer migration | Part 8, in order, one consumer per change | Each change deletes that consumer's `players_value` reads. Finally, the `players_value` allow-list is empty |

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

---

## Part 11 — Constants register

Stamps per D-041. Nothing here is calibrated yet.

| Constant | Stamp | Basis |
|---|---|---|
| Service-year length | **none: read** | `rules_min_service_days`. Missing → unknown, never 172 (R-3) |
| FA, arbitration and minimum-salary thresholds | **none: read** | The league's rules via the parent league. Missing → `indeterminate` |
| Which contracts are "market prices" (FA-eligible service) | **policy** | What the market is taken to mean (4.1) |
| Opening replacement level | **provisional** | The export's WAR convention, measured .288–.293 (R-4). Measured from free talent in phase 4 |
| Opening price-of-win band (spread of bases) | **provisional** | R-5's bases. Replaced by observed signings |
| When the measured price replaces the opening one | **policy** | When the measured band is narrower than the opening band (Q-4). No fixed count |
| Arbitration ladder shares (about 22 / 42 / 53%) and their spread | **provisional** | Cross-section of imported contracts (R-6) |
| Pre-arbitration renewal spread | **provisional** | Observed pre-arbitration pay above the minimum (R-5) |
| Service projection edges (optioned against stays up) | **provisional** | The season clock and the roster state |
| Discount rate | **policy** | One stated rate in the neutral view, its value set when phase 5 builds surplus. `competitiveWindow` leans on it only in "our view" (Q-3). No backtest can call it optimal |
| Projection horizon | **policy** | To the end of control, capped at 7 seasons (Q-3). Control is what the club owns |
| Band widening per horizon season | **provisional → calibrated in phase 3** | WAR history makes it fittable |
| Widening for thin results and partial ratings | **provisional → calibrated in phase 3** | Sample size against projection error |
| Widening outside the organization | **none** | Not applied: one rating row per player makes it unmeasurable (R-9, Q-2) |
| Aging curve for production | **calibrated in phase 3** | Fitted on WAR history. `roleReview.ts`'s `AGING_CURVE` answers another question and is not reused unrefitted |
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
