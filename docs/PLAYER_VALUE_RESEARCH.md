# Player Value research record

Research evidence for the Player Value subsystem ([PLAYER_VALUE.md](PLAYER_VALUE.md),
[D-052](DECISIONS.md)). It records what the imported save does and does not establish about contracts, service
time, money and production, so that the design rests on measured facts and names what it cannot know. Nothing here
is an architectural decision until it is promoted to `DECISIONS.md`, and nothing here is implemented.

**Evidence classes** (as in [RIGHTS_RESEARCH.md](RIGHTS_RESEARCH.md)):

- **Observed** — read from the real import, read only (`data/league.db` and `data/history.db` opened with
  `mode=ro`; no OOTP file opened, nothing written). Strong for what the data looks like, weak for what OOTP does,
  because a cause is inferred.
- **Unresolved** — nothing in the export, the code or the existing evidence settles it. The subsystem must treat
  it as `indeterminate`. No OOTP experiment is proposed for any of them (AGENTS.md).

The queries' conclusions are recorded, not their output. Every figure is from the Arizona import of 2026-05-16.

---

## R-1 The save and how much history it holds

| Fact | Observed |
|---|---|
| Human organization | Arizona (`teams.team_id = 1`, `human_team = 1`) |
| Game date | `2026-5-16` (`leagues.current_date`, unpadded — compare only through `parseGameDate`) |
| Season | 2026; MLB opened `2026-3-25`; 1,342 of 4,860 team-games played (**27.6%**, about 45 per club) |
| Kind of save | A historical start: `historical_league = 1`, `historical_year = 2026`, `world_start_year = 2026` |
| Won-lost history | `team_history_record`: 155 seasons, 1871–2025 (the real MLB record, imported). The Athletics have no 2025 row, so 2025 has 29 clubs |
| Player statistics | `players_career_batting_stats` / `_pitching_stats`: 1871–2026 |
| Club financial history | `team_history_financials` has a row for every club-season 1871–2025, but **every money field is zero before 2025**. 2025 has figures for 29 clubs (one with zero revenue); the Athletics' row is missing |
| Salary history | `players_salary_history`: **only 2026** (1,173 rows, 1,168 players, $5.37B), plus one `year = 0`, `salary = 0` row for each of the 131,258 people in `players`. Those rows are placeholders, not salaries |
| Pennant's own history | `history.db`: one rating-snapshot date (8,009 rows); zero roster-state snapshots |

**Consequence.** The save holds deep *production* history (WAR included, R-4) and almost no *money* history:
one generated pre-start financial season (2025), the current season to date and one season of salaries. Every
market figure must start from a cross-section of the current contracts and gain its time dimension from Pennant's
own per-import snapshots (D-009).

**The opening contracts are imported, not simulated.** In a historical start the 2026 contracts, salaries and
service times are the real-world ones the game shipped with. The first market Pennant can price is therefore the
real 2026 market as imported. OOTP's own contract AI sets prices only from the first simulated signing onward, so
the opening price of a win describes the imported market. It says nothing about how OOTP prices players, and the
design must let observed simulated signings replace it (PLAYER_VALUE.md Part 4).

## R-2 The fifteen leagues and their financial rules

One major league and fourteen affiliated minor leagues, all with `parent_league_id = 203`. There is no independent,
foreign or amateur *league* row. Amateur statistics exist at `level_id` 10 and 11 with `league_id = 0` (1,030
unsigned players with college or high-school lines).

| League | Level | Leagues |
|---|---|---|
| MLB (203) | 1 | 30 clubs + 4 all-star teams |
| Triple-A | 2 | IL (204), PCL (205) |
| Double-A | 3 | EL (206), SL (207), TL (208) |
| Single-A levels | 4 | NWL (209), SAL (210), MWL (211), CAL (212), CAR (213), FSL (252) |
| Complex / rookie | 6 | ACL (217), FCL (218), DSL (234) |

**MLB (203) rules as exported** (stored as REAL, e.g. `1.0`):

| Column | Value | Reading |
|---|---|---|
| `rules_financials` | 1 | Financials are on |
| `rules_salary_cap` | 0 | No cap |
| `rules_luxury_tax` | 30 | Luxury tax on; 30 is a rate or threshold. **Which one is not established** |
| `rules_luxury_sharing` / `rules_luxury_sharing_cap` | 1 / 140 | Luxury money is shared. **The meaning of 140 is not established** |
| `rules_revenue_sharing` / `rules_revenue_sharing_tax` | 1 / 48 | Revenue sharing on; 48 looks like the share of local revenue pooled. **Not established** |
| `rules_minimum_salary` | 780,000 | League minimum |
| `rules_fa_minimum_years` / `rules_salary_arbitration_minimum_years` | 6 / 3 | Free agency after six years, arbitration after three |
| `rules_minor_league_fa_minimum_years` | 6 | Minor-league free agency |
| `rules_min_service_days` | 172 | Days in a service year (and see R-3) |
| `financial_coefficient` | 1.0 | Modern money scale |
| `arbitration_offering` | 0 | **Meaning not established** (a flag, a phase, or an off-season state) |
| `rules_owner_decides_budget` | 1 | The owner sets the budget |
| `rules_cash_maximum` | 18,000,000 | Cash cap in trades |
| `rules_average_national_media_contract` / `_fixed` | 55,000,000 / 1 | |
| `rules_player_salary0..7` | 1.5M, 2.5M, 4.5M, 8M, 14M, 18M, 24M, 32.5M | A salary scale of eight steps. **What each step is tied to is not established** |
| `rules_fa_compensation` | 3 | Not established |

**Every minor league exports `rules_financials = 0`, `rules_minimum_salary = 0`, `rules_fa_minimum_years = 0` and
`rules_salary_arbitration_minimum_years = 0`.** These are not the rules a minor leaguer lives under. His contract
rights come from the parent league. `valuation.ts` `leagueRules(leagueId)` reads a league's own row and treats a
`0` free-agency threshold as "reserve clause", so read for a minor league it would report no free agency and no
arbitration. Today it is called with the organization's major-league id, so the error is latent. Phase 1 must
resolve the financial regime through `parent_league_id`.

## R-3 Service time

- `mlb_service_years` is exactly `floor(mlb_service_days / 172)` in every band from 0 to 8 years. 172 is also
  `rules_min_service_days`. The hard-coded `SERVICE_DAYS_PER_YEAR = 172` in `contracts.ts` is the league's own rule
  in this save. It should be read from the rule, not assumed, so another league's length is honoured.
- `mlb_service_days` **includes this season's days** (`mlb_service_days_this_year`, at most 52 on 2026-5-16, the
  days since opening day). Service at the last off-season is `mlb_service_days − mlb_service_days_this_year`.
- No `mlb_service_days` value is null. 11,315 of 12,575 active players have under one year and 1,728 have any
  service.
- **Trap found while measuring:** the imported columns are REAL, so `mlb_service_days / 172` in SQL returns a
  fraction, not whole years. Integer years need `CAST(... AS INTEGER) / 172` or the division done in TypeScript.
- **`has_received_arbitration` is 0 for all 12,575 active players**, including 751 with three or more years of
  service and 377 with six or more. On this save the flag carries no information. **Unresolved:** what it means when OOTP
  sets it, and whether it is ever set in a historical start. It stays `indeterminate` and is never read as "has not
  been through arbitration".

## R-4 Production in wins: WAR in the export

- `players_career_batting_stats.war` and `players_career_pitching_stats.war` (plus `ra9war`) carry WAR per
  player × season × level × club × split. **Only `split_id = 1` (overall) carries WAR**: at the major-league level
  the batting splits 2 and 3 (versus left- and right-handers) and 21 are zero in every season checked. The game-level tables (`players_game_batting`,
  `players_game_pitching_stats`) have no WAR column.
- Coverage: MLB (`level_id = 1`) every season in the history. The minor levels (2, 3, 4, 6) also carry WAR in 2025
  and 2026. So do the amateur levels 10 and 11, whose totals (1,440 and 627 batting WAR in 2026) are on no major-league
  scale and must never be read as major-league wins.
- A player who changed clubs has one row per club (2025: 752 batting rows for 673 players). Season WAR is a sum
  over rows.
- MLB WAR totals (batting + pitching, split 1): **2024: 1,031.6. 2025: 1,022.3. 2026 to date: 277.4.**
- **The replacement level the export's WAR assumes is measurable.** League wins minus league WAR, over league
  games, is the winning percentage of a replacement team:
  - 2024: (2,429 − 1,031.6) / 4,858 = **.288** (46.6 wins per 162)
  - 2026 to date: (671 − 277.4) / 1,342 = **.293** (47.5 wins per 162)

  This is the convention inside OOTP's WAR. It is not a measurement of the talent actually available for the
  minimum, which needs the later production of waiver claims, minor-league free agents and call-ups (Part 4 of
  the design). It is the right *opening* replacement level all the same, because it keeps Pennant's wins in the
  same units as the export's WAR. A replacement level 0.01 higher removes about 48.6 WAR from the league (about 4.8%)
  and raises every $/win by about 5%.
- Existing code already reads `SUM(war)` without a column guard in `api.ts`, `form.ts`, `league.ts`, `lineup.ts`,
  `player.ts` and `org.ts`.

## R-5 Payroll, service class and the opening price of a win

**Payroll.** OOTP's `team_financials.player_payroll` sums to **$5,255M** across the 30 clubs. The range runs from
LAD $389.5M to STL $54.5M (7.1×). The 877 major-league contracts held by men on a major-league active list or
injured list carry **$5,110M** in this season's salary (`salary{current_year}`, the convention verified in
`valuation.ts`). The gap is 40-man players at affiliates (180 paid major-league contracts off the active and
injured lists) and whatever OOTP includes that the contracts do not show.

**Salary by service class** (service = `mlb_service_days`, including this season; FA-eligible = 6 × 172 = 1,032
days or more; arbitration = 516–1,031; the major-league active and injured lists only):

| Class | Players | Salary | Average | At ≤ $800K | Share of payroll |
|---|---|---|---|---|---|
| Pre-arbitration (< 3 years) | 352 | $414M | $1.18M | 314 | 8% |
| Arbitration (3–6) | 255 | $1,056M | $4.14M | 28 | 21% |
| FA-eligible (6+) | 270 | $3,640M | $13.48M | 20 | 71% |

Across every paid major-league contract in the league (1,057), 285 belong to FA-eligible players, 294 to
arbitration-class players and 478 to pre-arbitration players.

**Worked opening $/win for this save.** Price = salary above the minimum ÷ WAR. The implicit assumption is that a
replacement player costs the league minimum and produces zero WAR.

| Basis | Salary above minimum | WAR | $ per win |
|---|---|---|---|
| A. Every major leaguer on an active or injured list (877) | $4,426M | 1,049 (their 2025 WAR) | **$4.2M** |
| A′. The same salary, league 2025 WAR | $4,426M | 1,022 | $4.3M |
| B. FA-eligible service (270), 2025 WAR | $3,429M | 470.8 | **$7.3M** |
| B′. FA-eligible, mean of 2024 and 2025 WAR | $3,429M | 478.6 | $7.2M |
| B″. FA-eligible, 2026 pace (to date ÷ 0.276) | $3,429M | 362.3 | $9.5M |
| C. FA-eligible, contracts starting 2026 (140; average 1.75 years, age 32.9), this year's salary | $1,076M | 175.5 | **$6.1M** |
| C′. The same, average annual value | $1,142M | 175.5 | $6.5M |
| C″. The same, 2026 pace | $1,076M | 158.4 | $6.8M |
| D. FA-eligible, contracts from 2023 or earlier (68), 2025 → 2026 pace | $1,329M | 172.2 → 105.2 | $7.7M → $12.6M |

**Reading.** Basis A is a floor. Pre-arbitration and arbitration salaries are held below the market by rule, so
dividing all pay by all wins understates what a win costs on the open market. Basis D is a ceiling artefact: it is
the decline years of long contracts, the money a club pays for wins it bought years ago. B and C are the market.
**Opening estimate: about $7M per win, band $6M–$10M, floor $4.3M, replacement .29.** Every assumption:

1. WAR is the export's WAR (OOTP's formula), batting plus pitching, `level_id = 1`, `split_id = 1`, summed over
   clubs.
2. Salary is this season's contract salary. Signing bonuses, incentives, buyouts and deferrals are not in it (R-6).
3. "FA-eligible" is six years of service in 172-day units, including this season's days. Super Two (R-6) is ignored.
4. A replacement player is paid the minimum ($780,000) and is worth 0 WAR, at the export's own replacement level
   (.288–.293, R-4).
5. Prior-season WAR stands in for the production a salary was paid for. A market pays for *expected* wins, and
   the best players regress, so a first-year basis understates the price of a multi-year deal.
6. The contracts are the imported real-world 2026 contracts (R-1). The figure describes that market and has to
   give way to OOTP's simulated signings as they are observed.
7. The 2026 pace rests on 27.6% of a season and is the widest basis.

## R-6 Contracts: what the export carries

- `players_contract`: one row per active player (12,575). Seasons are `salary0..salary14`. `current_year` counts
  completed contract years. `season_year` is the contract's first season (2019–2026 for major-league deals). 884
  major-league contracts are in year 0.
- Paid major-league contracts: 1,057. The 4,054 `is_major = 1` rows with no club and no salary belong to unsigned
  players.
- Minor-league contracts show a salary of 0 almost everywhere (a handful at up to $2.36M). **Whether 0 means
  "unpaid", "not exported" or "not on the major-league payroll" is unresolved.** A minor-league contract's cost is
  therefore `unknown`, never $0. 24 men on major-league active lists hold `is_major = 0` contracts at $0. Their cost
  is unknown too.
- Options: `last_year_team_option` 143, `last_year_player_option` 18, vesting 0. `opt_out` is a count, not a flag
  (values 1–9 on 58 deals). **`no_trade` is 0 on every contract, and `last_year_option_buyout` and `retained` are
  0 everywhere.** Real 2026 contracts do carry no-trade clauses and buyouts, so on this historical start these
  columns are **not populated**, which is not the same as "none". A no-trade clause or buyout is `unknown` here.
- `contract_team_id` differs from `team_id` on 174 major-league contracts (by the look of it, affiliate versus
  parent club). Which club carries the money is read from `contract_team_id`. **Not verified against payroll.**
- `players_contract_extension`: 35 rows with `years > 0` (signed extensions not yet started).

**Arbitration, cross-sectionally.** Salary history has one season, so no raise can be observed year over year. One
season's one-year deals by service at the last off-season:

| Service at the winter | One-year deals | At the minimum | Average salary | $ per positive 2025 WAR | Of the FA-eligible price (B) |
|---|---|---|---|---|---|
| 3 years | 84 | 11 | $2.27M | $1.57M | ~22% |
| 4 years | 57 | 6 | $4.25M | $3.08M | ~42% |
| 5 years | 51 | 4 | $5.62M | $3.83M | ~53% |

That is a ladder with a band, from imported real contracts. Whether OOTP's simulated arbitration follows it is
unresolved until arbitration outcomes are observed across an off-season (phase 4).

**Super Two.** Among one-year deals at two to three years of winter service, above-minimum pay switches on sharply
at about 470–480 days (2 years + about 130 days). Measured in 20-day bands from 344 days, the share above the
minimum runs 0/19, 0/13, 0/12, 1/8, 1/11, 1/12, **6/12, 10/11, 11/12**. That matches the real-world Super Two line,
which is priced into the imported contracts. **Whether OOTP's simulation grants arbitration below three years is
unresolved**, and a player in that window has an arbitration eligibility of `indeterminate`.

**Free-agent signings and raises year over year.** With one salary season these cannot be identified yet. From
the second import across an off-season, a player whose contract `season_year` or `years` changed, or who changed
club, has signed. Combined with his service class and prior salary, that identifies FA signings and arbitration
awards directly. This is the evidence that tightens the price of a win (PLAYER_VALUE.md Part 4, phase 4).

## R-7 Club finances

`team_financials` (current season), `team_last_financials` (a previous-season view) and `team_history_financials`
(2025 only, R-1).

- **Budget** runs from $122M (MIA) to $478M (LAD). Payroll against budget runs from about 0.39 (STL) to 0.82 (NYM).
- **Revenue** (`total_revenue`, current row) runs from $85M to $405M. Media revenue looks booked for the season
  while expenses accrue to date (LAD: $285M media against $136M expenses after 27.6% of the season). **Which
  current-row columns are season-to-date and which are for the season is not established column by column.**
- 2025 (history) against `team_last_financials` disagree for the same clubs (LAD revenue $511M against $477M).
  **Which is authoritative is unresolved.**
- `market`: 2–13 in the current row, 0–15 in the 2025 row, and changed for most clubs. The scale is not
  documented in the export.
- `owner_expectation`: coded 0–5 (0 ×6, 1 ×6, 2 ×2, 3 ×3, 4 ×12, 5 ×1) and 0 for every club in 2025. **The code
  meanings are not in the export.** `payroll.ts` passes the number through unlabelled.
- `mode`: 0–3, meaning not established.
- `cash` is 0 for every club (as `valuation.ts` notes). `cash_trades_available` runs from −$1.9M (TEX) to $47.3M
  (LAD). `player_payroll_offered` is 0 everywhere.
- `revenue_sharing` and `luxury_sharing` are 0 in the current and last rows, although both rules are on. They may
  settle at season end. **Not established.**
- **Revenue trend** cannot be read from the save beyond one prior season. It accrues from per-import snapshots.
- `playoff_revenue` exists (per club, per season). It is the one observed money link from winning to revenue, and
  with one season it cannot yet shape a curve.

## R-8 Personality

Six columns on `players`: `personality_greed`, `personality_loyalty`, `personality_play_for_winner`,
`personality_work_ethic`, `personality_intelligence` and `personality_leader`.

- An integer scale of 1–200 (three values above 200: loyalty 244 ×2, work ethic 232 ×1).
- **No null and no zero among the 12,575 active players**, and there is no visibility or "unknown" column. Nothing
  in the export marks a trait as not yet known, so under the owner's decision every trait is a known fact. Their
  provenance is `exported, no visibility flag`, the same honesty the scouted-evidence adapter shows for ratings.
- A central mass: 45% of greed values sit in 80–120, 19% below and 36% above. That fits a three-way
  low / normal / high reading. **How the game bands them is not established**, so any band is a stated policy
  constant, never a claim about OOTP.
- Related columns that are not personality and are not adopted here: `morale` (4–88), `expectation` (1–9),
  `local_pop` and `national_pop` (0–6), and `prone_*` (injury proneness). Whether `prone_*` is organization-visible
  is a D-002 question and is left alone.

## R-9 The size of a full-league compute (phase 1 timing)

| Population | Rows |
|---|---|
| Active players (`retired = 0`) | 12,575: 1,055 on major-league clubs, 1,064 Triple-A, 1,046 Double-A, 2,023 Single-A levels, 2,821 complex and rookie, 4,566 unsigned (1,030 with amateur lines) |
| Rating rows (`players_batting`, `_pitching`, `_fielding`) | 12,575 each for active players. **One row per player: no per-viewer or per-organization scouting** |
| Batting statistic rows, active players | 64,151 (30,978 overall-split since 2023) |
| Pitching statistic rows, active players | 46,008 (24,065 overall-split since 2023) |
| Contracts / extensions | 12,575 / 35 with terms |
| Salary history | 1,173 real rows |

These are small. A league-wide pass is a few hundred thousand rows read once. Phase 1 times it on this import
before choosing between lazy compute on first request and warming it after the import.

**Information asymmetry is not in the export.** One rating row per player means the export cannot show that the
organization sees another club's players less well. Any widening for "not ours" is a stated constant (PLAYER_VALUE.md
Part 3), never a measurement.

## R-10 Schema tolerance: what the code guards today

| Column or table | Guarded? | Risk |
|---|---|---|
| `leagues.rules_fa_minimum_years`, `rules_salary_arbitration_minimum_years`, `rules_minimum_salary`, `financial_coefficient` (`valuation.ts` `leagueRules`) | No column guard; **missing or null → 6 / 3 / 0 / 1** | Invents MLB rules for a league that has none (D-018). A minor league's own row reads as reserve clause (R-2) |
| The same league row in `leagueRules.ts` (rights) | Every column guarded; a missing value is `unknown` with its reason | The right pattern. Phase 1 unifies on it |
| `players_roster_status.mlb_service_*` (`playerState.ts`) | `pick` → NULL when absent | Good. But `contracts.ts` counts a missing service time as **0** (pre-arbitration) |
| `players_roster_status.mlb_service_days_this_year` (`contracts.ts`) | Table guarded, column not | The comment claims tolerance. A missing column would throw |
| `team_financials.*` (`valuation.ts`, `payroll.ts`) | Table only; each missing value → 0 | A missing budget or revenue reads as $0 |
| `players_value.oa` / `oa_rating` | Guarded | Prohibited evidence all the same (D-017) |
| `war` / `ra9war` | Not guarded (six modules) | An export without WAR breaks those pages. The value engine must guard it |
| `has_received_arbitration`, `arbitration_offering`, `rules_financials`, `rules_salary_cap`, `rules_luxury_*`, `rules_revenue_sharing*`, `rules_min_service_days`, `owner_expectation` (read by `payroll.ts` only) | Not read by production code | New reads must be guarded from the start |
| All imported numbers | Stored as REAL | Integer-division trap in SQL (R-3). JS `=== 1` on `1.0` is safe |

## R-11 What stays unresolved

Each item is `indeterminate` in the design until the data proves it. None is to be settled by an owner experiment.

1. The meaning of `rules_luxury_tax` (30), `rules_luxury_sharing_cap` (140), `rules_revenue_sharing_tax` (48),
   `rules_player_salary0..7`, `arbitration_offering`, `rules_fa_compensation`, `owner_expectation`, `mode` and the
   `market` scale.
2. Whether OOTP's simulation applies Super Two, and what `has_received_arbitration` records.
3. Whether a minor-league contract's 0 salary is a cost of 0 or not exported.
4. No-trade clauses, buyouts and retained salary: unpopulated on this historical start, so unknown rather than
   absent.
5. Which of the current, last and history financial rows is authoritative, and which current-row columns are
   season-to-date.
6. How OOTP prices free agents and arbitration awards once it is simulating. Answered by observing the first
   simulated off-season across two imports.
7. The organization's scouting accuracy on other clubs' players. Not in the export at all.
