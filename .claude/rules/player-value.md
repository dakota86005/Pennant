---
paths:
  - "server/playerValue*.ts"
  - "server/posture.ts"
  - "server/playoffs.ts"
  - "src/ValueSection.tsx"
  - "server/clubFinanceRoutes.ts"
  - "server/ourViewRoutes.ts"
  - "server/leagueRules.ts"
  - "server/contracts.ts"
  - "server/payroll.ts"
  - "server/freeagents.ts"
  - "scripts/player-value-report.ts"
  - "src/pages/Contracts.tsx"
  - "src/pages/Payroll.tsx"
  - "tests/playerValue*.ts"
  - "tests/payrollControl.test.ts"
---

# Player Value: working reminder

This is a router, not the doctrine. The canonical detail is in `docs/DECISIONS.md` D-052 (with D-018, D-023
and D-041 where it applies them), `docs/PLAYER_VALUE.md` (Part 1 boundaries, Part 2 the five concerns, Part 7
compute, Part 8 the consumer migration, Part 9 phases, Part 10 the boundary test, Part 11 the constants) and
`docs/ARCHITECTURE.md` "Subsystem responsibilities" and "Player Rights". `docs/PLAYER_VALUE_RESEARCH.md` (R-1
to R-11) is research evidence, not current doctrine. Where they differ from this file, they win.

Player Value describes and never authorizes: what a player costs, under what control, what he will produce,
what a win is worth and what is left, as bands with their basis. `server/playerValue.ts` is the one entry
point; `playerValueContract.ts` (contract facts), `playerValueControl.ts` (control and cost path),
`playerValueProduction.ts` (expected production, pure), `playerValueProductionFit.ts` (the per-save fit),
`playerValueRatings.ts` and `playerValueRatingsFit.ts` (phase 3b: production from scouted ratings, and its per-save fit),
`playerValueHistory.ts` (the history reader), `playerValueFinances.ts` (Club Finances, the opening price of a win,
replacement level), `playerValueCost.ts` (phase 4a, pure: the cost ladder measured per import and the controlled seasons
priced from it), `playerValueSignings.ts` (phase 4b, pure: observed changes between imports, the measured price, awards,
reserve-clause renewals, replacement, adoption), `playerValueCone.ts` (the player card's production cone: production
joined with control, pure), `playerValueSurplus.ts` (phase 5a, pure: the neutral contract surplus and the retention
margin), `playerValueLens.ts` (phase 5b, pure: "our view", the one value module that names philosophy),
`playerValueWinValue.ts` (phase 5b, pure: the club's value of a win) and `playerValueCalibration.ts` (policy and the
provisional prior, stamped) sit behind it.
Three writers, `history.db` only: `playerValueSnapshot.ts` (the per-import market snapshot), `playerValueContractStore.ts`
(phase 4b: the per-import contract snapshot) and `playerValueFitStore.ts` (the per-save production fits, D-053). Which phases are built is in `docs/PROJECT_STATE.md`; check it against the
worktree.

- No verdict, rank or single score: never trade, release, extend, sign or promote (D-052, D-004).
- Eligibility (pre-arbitration, arbitration, free agency) is Player Rights' (`evaluateContractControl`,
  owner Q-1). Value attaches a cost to each status and never compares service with a threshold.
- One `LeagueRules` (`leagueRules.ts`). A minor leaguer's contract regime is his parent league's. A missing
  rule, service time or service-year length is `indeterminate`, never 6 / 3 / 172 or zero (D-018).
- A threshold inside the service projection makes that season `indeterminate` and names both sides.
  Super Two follows the owner's ruling (2026-09-22; basis `owner_attested`): the cutoff is computed from the
  export's class as a range, only where the regime as read is MLB's; an overlap is `indeterminate`.
  `has_received_arbitration` is not read.
- Minor-league $0 salaries, and clauses the export does not populate (no-trade, buyout, retained), are
  unknown, never none or $0. An option is shown on both branches.
- Fog of war: ability only through `scoutedEvidence.ts`, never `players_value` (D-017). No philosophy in
  the neutral value, no protection tier, no defensibility.
- Consumers read value through the entry point and migrate one at a time, deleting their `players_value`
  reads in the same change (Part 8). Nothing writes to `league.db`.
- Club Finances: a financial value whose meaning is not established is shown raw (`meaning: 'unknown'`), a
  row of all-zero money is unknown, and a market contract is Player Rights' free-agency answer, never service.
- Calibration belongs to the save (D-053): production's fitted numbers (results and ratings models) come from the
  save's stored fits, adopted through the gate; code holds the methods, `PRODUCTION_POLICY`, `RATINGS_POLICY` and the
  provisional `PRODUCTION_PRIOR` and `RATINGS_PRIOR` only (the ratings prior has no arrivals). Ratings reach Player
  Value only through `scoutedEvidence.ts`: the reader loads them, the pure ratings modules take its types; no minor-league
  WAR (Q-9). The ratings mapping is a same-time fit (it describes, it does not forecast); the ratings count for the kind's
  K until the save's own snapshots measure their reliability; the development path and the arrival chance by potential
  wait on those snapshots too. Injury proneness is an owner-attested known fact, read only through
  `server/injuryProneness.ts`; 0 or blank is unknown.
- The central is the expected wins (hardening, 2026-09-23): the rate of those who play is fitted apart from the
  chance he plays; playing time is per scheduled game, under the save's measured ceiling. Known days out move the
  central (owner, 2026-09-23); a season lost to injury is never evidence of less playing time. The gate reads subgroups
  and bias on a rolling-origin backtest, its tolerances never loosened to pass a fit (owner's option C, 2026-09-23);
  fits are keyed by the save's identity and refitted in a worker thread (D-053 amendments).
- The rate band is never narrower further out; the wins band is rate × expected playing time and may narrow as
  playing time fades (owner, 2026-09-23). Thinner evidence never narrows either on the same expected playing time;
  missing ratings widen by interval arithmetic, never a midpoint (in the blend too: a missing grade is re-read across
  the scale). Playing time is conditional on quality (a better player keeps more of it); for a prospect too, by the
  results fit's own effect, located so his cell's players keep its measured chance (hardening F4). A prospect's low
  edge includes producing nothing.
- Arrival (hardening F4): read for a player not yet called up at this point of his season (the origin season's
  call-ups stay in the later cases, kept apart); a league's arrival cases are its own farm's, and any top-level league
  is arriving (never assume MLB); the arrival gate also fails a material, significant relative bias (a tightening, never
  loosen it to pass); the model served is refit through the last completed season. Since F5 (owner, 2026-09-23) the
  arrival model is scored on the results fit's rolling origins, fitted with its 2-season recency half-life
  (`RATINGS_POLICY.backtest`), its gate errors clustered by player and origin, and adopted only where the next season
  could be checked; a rating snapshot is read at its own point of the season. Since F6 (owner's option (b),
  2026-09-23) the arrival model is adopted horizon by horizon (`RATINGS_POLICY.adoption`): a contiguous run of passing
  horizons from the rest of this season that must reach the next season; a horizon after one that failed or could not
  be checked is never served. A prospect's later seasons are `notEstablished`, each with the gate's finding, never
  extrapolated or carried forward; a multi-season total including one is not a number (`productionTotal`); labels say
  "calibrated through N seasons out". The results fit keeps its all-horizons rule.
- The cost of controlled seasons (phase 4a, D-052 amendment): measured on each import from the save's one-year
  contracts, snapshotted with the market (never a D-053 fit: no held-out outcome until 4b's observed awards). A renewal
  runs from the league's minimum to the save's renewal spread; an arbitration season is the minimum plus its class's
  robust (Theil–Sen) line, a base and a pay per win of the two-season platform in the import's dollars, its error from a
  bootstrap of the same fit, at the platform seasons' production; only the prior's shares carry (and the basis names) the
  price band; every corner taken, never a point, never assumed to be the minimum (a contract at the minimum stays out of the
  line and lets a season whose platform reaches as low reach it, said). Every priced band has a central inside it; between
  statuses each status's is named and none chosen. Status, class, trip and service class are Player Rights'
  (`arbitrationRegimeOf`, `trip`, `tripIfEligible`, `serviceClass`); a range covers each class and his service's class, an
  open season each status, a season that may be free agency or a branch the player decides is "if held". Below 30
  contracts: no line of its own, the provisional `COST_PRIOR` hulled with the range the save paid the class, only where the
  regime as read is MLB's; else unknown. No arbitration or an unread rule: no ladder (and no season lists arbitration). A
  reading without production prices nothing. Reserve-clause renewals are unknown until observed across imports (4b). A projected cost is never committed
  money: Payroll shows it beside the committed total as a range of reasonable readings with the sum of centrals, never in
  it. Owner decisions (2026-09-24, D-052 amendment): an arbitration salary is never below the previous season's salary
  (owner-attested; Player Rights' `arbitrationSalaryFloor`, never MLB's 20% rule): every arbitration-priced season's low
  edge and central are at least the previous salary where known, chained year to year, "if held" with the non-tender
  said, unknown where it is not; Payroll's club range combines players as independent (`combineProjectedCosts`,
  `COST_COMBINATION_POLICY`): around the sum of centrals, each player's distance beyond his non-noise edges (which status,
  which class of a range, whether held) in root sum of squares, labelled "players combined as independent; not a
  calibrated interval", the edge-to-edge sum in the details, no player's own band narrowed.
- The measured price (phase 4b and its review, D-052 amendments): each import records its contracts (keyed by the save's
  identity, idempotent) and stores the pair it forms with the import recorded before it (only that one is read; a pair is
  read again from its snapshots only when `SIGNINGS_POLICY.method` changes, where both were kept). Retention (owner,
  2026-09-24): full snapshots only for the imports that bracket a winter and the latest, pruned at capture after the pair
  is stored (`pruneContractSnapshots`, one transaction, a `pruned` event; the store's one DELETE, history.db only, never
  across save identities, never the latest, never one a pair still needs); every pair and event kept; a pruned import
  reads as not recorded. Imports are paired in the
  order recorded; a save that went back, or a date imported again with different play, starts a new timeline, never
  compared across. A winter is read by the calendar (an import before its season began is inside it; one winter however
  many imports; a pair a winter or more apart is not measured). Each change is read through Player Rights' standing AT
  THE EARLIER import for the new contract's first season and named for what changed, never a transaction type the export
  does not give (D-020: no "optioned", "recalled", "DFA"); a club change on the same terms moved with him; an extension
  the earlier import held is never a signing, traded or not; an ambiguous change (a free agent re-signed by a club that
  held him, at the earlier import or during the season before by his lines; a controlled player's deal elsewhere; a term
  changed within its seasons; rows with no term; an indeterminate standing) is counted and left out. The price is a set
  of bases like the opening's (per win projected at signing over the deal and in the first season, if he plays, and per
  win produced in the first season once completed), each a ratio of sums with its resampled band (by winter once two),
  each on at least 20 signings; it is compared with the opening band with its sampling (Q-4) only once it holds the
  realized reading and covers each third of the free-agent class. The price in force is per win produced (owner,
  2026-09-24): its central and band are the realized basis's; the per-projected-win readings are its check (with their
  ratio), never the price; before the realized reading it is not measured. An observed arbitration salary below the
  previous salary is flagged against the owner-attested rule, counted and named. An unbounded opening sampling band is
  wider than any bounded one. One import, or imports inside one season: "No off-season observed yet". Awards are scored
  against the earlier import's band beside its width, read in the ladder's class, and joined as a class line at 30;
  reserve-clause renewals price a reserve-clause season at 30; replacement from freely acquired players at 30 is shown,
  never applied (price, ladder and production stay in the export's WAR until phase 5). Never the live log.
- Surplus (phase 5a, D-052 amendment; PLAYER_VALUE.md 5.1): per controlled season within the horizon, production value
  (the minimum plus wins × the price in force, one level of replacement on both sides, the measured replacement shown and
  never applied) less cost, edge against edge, discounted at the owner's 5% a season (`SURPLUS_POLICY`; this season's
  remaining part weighs 1; the price held flat) and summed; the rest of this season counts only its part still to be
  played, banked wins and paid salary sunk. The retention margin: (his wins − the replacement's 0) × price + the minimum
  a replacement costs − the costs only if kept; a major-league contract's covered salary cancels, so sunk salary never
  favours keeping a player; an unexported buyout is read from nothing to the option's salary; a 40-man spot is stated,
  never priced. An option season is the hull of its ways with no central chosen; "if held" where the player decides or
  he may leave. An unknown season is named and never summed as zero; without dollars, wins only. No verdict words. One
  valuation for every read (`surplusOf` only through the entry point; the card's route, Payroll and the league-wide read
  agree). Consumers other than the card migrate in phase 6.
- The lens (phase 5b, D-052 amendment; PLAYER_VALUE.md 6.1): `ourViewOf` runs at read time on the neutral valuation as served,
  handed the viewing organization's philosophy by `ourViewRoutes.ts` (settings are read there, never in a value module); it
  never changes a neutral figure or unknown, names every lean with its amount, leans on nothing inside 40–60 with the default
  policies, keeps guaranteed money out of the retention margin under every philosophy, words the policies only, and reads no
  production, cost, fit, table, tier, defensibility or club value of a win. Its weights are `LENS_POLICY` (policy).
- The club's value of a win (phase 5b; 4.5): `clubWinValue` reads the deadline read's odds model (`posture.ts`
  `oddsModelOf`/`oddsAt`, the only value-module import of posture, in the entry point); points of playoff odds per win and the
  curve, never dollars (Q-6), never in any value, unknown with its reason where the odds cannot be read (never the deadline
  read's defaults). The card's Value section speaks plainly: "Contract value", "Value of keeping him", "Most likely",
  "could be", "if kept", explanations on hover; the API keeps its names.
- Never ask the owner for an OOTP experiment; an unresolved rule stays `indeterminate` and is documented.

Checks: `tests/playerValueBoundary.test.ts`, `tests/playerValueControl.test.ts`, `tests/playerValueCost.test.ts`,
`tests/playerValueFinances.test.ts`, `tests/playerValueProduction.test.ts`, `tests/playerValueProductionFit.test.ts`,
`tests/playerValueRatings.test.ts`, `tests/playerValueSignings.test.ts`, `tests/playerValueCrossSave.test.ts`,
`tests/playerValueSurplus.test.ts`, `tests/playerValueInvariants.test.ts`, `tests/valueSection.test.ts`,
`tests/playerValueLens.test.ts`, `tests/playerValueWinValue.test.ts`, `tests/playoffs.test.ts`;
`npm run value:report` and `npx tsx scripts/calibrate.ts production` against a real import (read-only with `OOTP_FO_DB_READONLY=1`).
