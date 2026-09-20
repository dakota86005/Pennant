# Player Rights research record

Durable record of what is and is not established about OOTP roster-transaction
rules, for the Player Rights milestone (`feature/player-rights`). Nothing here is
an architectural decision until it is promoted to `DECISIONS.md`.

**Evidence classes used below**

- **Observed** — read from the existing real save (`league.db` import + the live
  log through the safe reader) with no in-game action performed. Strong for
  "what the data looks like", weak for "what OOTP does", because the cause of a
  value is inferred.
- **Experiment** — one known action performed in a *copied* save, before/after
  captures diffed with `npm run rights:capture` / `rights:diff` (§4.5, §4.6).
- **Documented** — stated by OOTP's own wiki/manual (§6). Treated as the rule
  where it is consistent with everything observed; an observation that
  contradicts it wins, because the repository and observed behavior outrank
  prose.
- **Unresolved** — no evidence. Rights evaluation must return `indeterminate`.

Save baseline: MLB league, in-game date 2026-05-16, log covered through
2026-05-15 (the copy's log through 2026-05-16), human club Arizona (team 1).

---

## 1. Audit of the current code (Phase 1)

Nothing on `main` evaluates rights. What exists is scattered inference.

| Where | What it does | Verdict |
|---|---|---|
| `server/rosterops.ts` (roster crunch) | `outOfOptions = on40 && !on26 && !onRehab && options_used >= 3`; "last option year" at `== 2`; `rule5Exposed = !on40 && years_protected_from_rule_5 <= 0 && pro_service_years >= 4`. | Replace. Reads raw columns, is only meaningful for a *non-active 40-man* player (never for an active one, who is the person being optioned), and the Rule 5 rule is contradicted by the data (§3.6). |
| `server/minorLeagueRetention.ts` `transaction{}` | Reads `is_on_secondary`, `is_on_dl60`, `years_protected_from_rule_5`, service years, `must_be_active` into a guardrail block. Rule 5 is display-only ("do not yet affect scoring"). | Migrate to `playerState`/rights. No rights conclusion is drawn today. |
| `server/valuation.ts` `ON_ROSTER`, `isOnFortyMan` | Heuristic 40-man / on-roster (active OR IL). | Already disproven by D-020 for the state layer; remaining callers are pre-fork surfaces (payroll, contracts, trade). Out of scope unless a rights consumer touches them. |
| `server/health.ts`, `pitching.ts`, `lineup.ts`, `dashboard.ts` | Availability/standing from `is_on_dl*`, DFA flags. | Availability, not rights. Leave. `health.ts` reads waiver countdown from `days_on_dfa_left` — see §3.4. |
| `server/assignmentContext.ts` | `ordinaryOption` (true / false / null) = what the assignment *is*. | Keep as the input to rights. It is a state fact about the *current* assignment, not a rule. |
| `server/prospectAssignments.ts`, `prospectDecision.ts` | State that 40-man/options/service belong to a separate layer. | Consistent with this milestone; no change. |
| `src/pages/RosterCrunch.tsx` | Renders `optionsUsed/3`, issues list. | Re-point at rights output. |

### Prior art: `origin/feature/mlb-operations` (not merged)

`rosterTransactionState.ts` — what to keep, drop, replace:

- **Keep (already ported as `playerState.ts`):** the "state only" normalization
  with unknowns instead of guesses; the tri-state `eligible | ineligible |
  indeterminate` result; requirements as a list (`active_roster_move`,
  `forty_man_addition`, `forty_man_roster_move`, `waiver_clearance`) each with
  its own `required | not_required | indeterminate`.
- **Keep idea, fix implementation:** `optionYearState` refuses to call a count
  below three "eligible". That caution is right; the reasoning ("the export
  does not provide every condition") is now sharpened by §3.1.
- **Wrong / disproven:** 40-man from `isOnFortyMan` (D-020); the `option`
  action is *ineligible* unless `activeMlb === true` and treats IL as a block
  (an IL player's option status is a separate question); `recall` returns
  **`eligible`** for any non-MLB, non-IL, non-DFA player who is in the org —
  with no recall-waiting-period input at all. That is exactly the confident
  recommendation this milestone forbids: a player optioned yesterday would be
  "eligible".
- **Wrong:** roster capacity counted from the heuristic 40-man; capacity limits
  themselves (`rules_active_roster_limit`, `rules_secondary_roster_limit`) are
  good and explicit — keep them.
- **Replace:** `evaluateRosterAction` re-reads the database itself
  (`playerRosterState`, `organizationRosterTransactionState`). The rights layer
  must consume `PlayerState` + chronology, not the tables.
- The MLB transaction-plan code (`majorLeagueTransactionPlan.ts`) calls
  `evaluateRosterAction` and copies `recall_legality_indeterminate`. When MLB
  Operations is integrated it should be re-pointed at the new evaluator; do not
  merge that branch.

---

## 2. Rule inputs OOTP exports explicitly (Observed)

`leagues` carries league rules that a rights evaluator can read as explicit
evidence instead of hard-coding MLB:

| Column | Value in this save | Use |
|---|---|---|
| `rules_minor_league_options` | 1 (MLB league); **0 for every minor league** | Options exist in this league. If 0, option-year logic must not apply. |
| `rules_rule_5` | 1 (MLB); 0 for minors | Rule 5 exists. |
| `rules_dfa_period_length` | 7 | DFA window. |
| `rules_waiver_period_length` | 3 | Claim window. |
| `rules_active_roster_limit` / `rules_secondary_roster_limit` / `rules_expanded_roster_limit` | 26 / 40 / 28 | Capacity. |
| `rosters_expanded`, `roster_expand_date` | 0, 2026-9-1 | Whether the expanded limit is in force. |
| `rule_5_draft_date` | 2026-12-13 | Calendar. |
| `rules_min_service_days` | 172 | Service-year length. |

**No league rule column exists for a minimum minor-league stay before recall.**

`players_roster_status` also carries columns `playerState.ts` does not read yet:
`was_on_active`, `was_on_secondary`, `was_on_dl`, `must_be_active`,
`just_signed`, `playing_level`, `claimed_team_id`, `has_received_arbitration`,
`trade_status`, `days_on_waivers`, `secondary_service_*`. Semantics unverified.

---

## 3. Findings by question

### 3.1 Optionability (question A)

**Observed.**

- `options_used` takes only 0–3 league-wide. `options_used_this_year` (`oty`)
  takes 0–3 and is **not a boolean**.
- `oty` reproduces the number of option-like assignments this season almost
  exactly: of 12,575 players, 12,458 have `oty = 0` and no log option, and every
  `oty = 1|2|3` player except 8 has that many `Optioned` events in the log
  (88, 18, 3). The 8 exceptions are §3.1a.
- `oty` can exceed `options_used` (7 players `ou=1, oty=2`): several assignments
  in one season consume **one** option year. `oty ≥ 1` never appears with
  `ou = 0`: the option year is charged at the first assignment of the season.
- `options_used` is capped at 3 (no 4th option year appears).

**3.1a — the log under-reports options.** Seven players have `oty = 1` with **no
`Optioned` event**: four were `Demoted <pos> X to Triple A` (paired with a
`Received X from Major League <club>` row; Mastrobuoni, Waldron, Zastryzny,
Wynns), one was `Assigned` to Triple A after a DFA (Tommy Nance), one is a rehab
player (§3.3), and one (Jordan Leasure) has no log rows at all. The one opposite
case is an `Optioned` event with `oty = 0` (Welinton Herrera, optioned 05-05,
recalled 05-06; unexplained — the counter may not persist across a one-day stay).

Across the whole log there are 236 "Received X from Major League" rows (one per
major→minor move). Only 134 have an `Optioned` row on the same day for the same
player; the other 102 are worded `Assigned` (97) or `Demoted` (5). The parser
classifies both as a generic `minor_league_assignment` ("no rights meaning
attached"), so **`Optioned` is not a complete record of major→minor moves and
its absence proves nothing**.

**Conclusion (provisional).** `options_used` looks like *option years used* and
`options_used_this_year` like *optional assignments this season*, but that is an
inference from correlation. **Do not derive remaining options from event
counts**: the log both omits and re-words options.

**Sufficient for `canOption = eligible`? Not yet established.** Working
hypothesis to test: option is available when options are enabled for the league,
the player is on the 40-man (or would be), and either `options_used < 3` or
`options_used_this_year ≥ 1` (an already-charged year). Whether service time
(the "fourth option" rule, consent rules) matters is unknown.

### 3.2 Recall / re-option waiting (question B)

**Observed.** 44 optioned→recalled pairs in the log. Gaps in days: `1,1,1,1,2,3,4,
5,9,11×7,12,12,13,14,14,15,15,17,17,18,18,20×4,...,43`. There are 1-day
recalls (Schneemann, Nicolas, Feduccia, Herrera). No league rule column exists.

**Conclusion.** OOTP does *not* visibly enforce a uniform minimum stay for
AI clubs. Either there is a hidden minimum with an injury-replacement
exception, or none. The 11-day cluster (7 pitchers) is suggestive of a ~10-day
rule but the sub-10 recalls need explaining (injury-replacement exception? AI
exempt?). **Unresolved — needs Experiment B.** Until then a recall of an
optioned player is `indeterminate` whenever the last option date is within
15 days or unknown.

### 3.3 Rehab and options (D-020 corner)

**Observed.** Brooks Baldwin: rehab assigned 04-21, returned 05-11, now Triple-A,
not active, on the 40-man, **`oty = 1`**, and **no** `Optioned`/`Demoted` row.
Either the return from rehab was an untracked option or `oty` counts something
else for rehab players. **Unresolved.** Rehab players must stay out of ordinary
option/recall logic (D-020), and after a rehab *return* the current assignment
cause must be `unattributed`, not "optioned".

### 3.4 DFA, waivers, outright (question D)

**Observed — countdowns.** For all 7 players currently DFA'd:
`days_on_dfa_left + days_on_waivers = 7` (= `rules_dfa_period_length`) and
`days_on_waivers_left = max(0, 3 − days_on_waivers)` (= the waiver period).
`is_on_waivers` **stays 1 after the 3-day claim window ends** (`waiver_left = 0`)
until the DFA period ends. So there are two clocks: a 3-day claim window inside
a 7-day DFA period. `days_on_waivers` is **not reset** when the player leaves
waivers (players not on waivers show 2–19); it is meaningful only while
`is_on_waivers = 1`.

**Observed — the DFA→AAA puzzle is resolved by the export, not the log.**
Two "assigned to Triple A after DFA" cases:

| Player | Log | Now |
|---|---|---|
| Aramis Garcia (ARI, DFA 05-04 waivers, `Assigned` to Reno 05-11) | identical wording | **`is_on_secondary = 0`**, `oty = 0`, `ou = 3` → outrighted off the 40-man |
| Tommy Nance (TOR, DFA 04-21 *irrevocable* waivers, `Assigned` to Buffalo 04-27) | identical wording | **`is_on_secondary = 1`**, **`oty = 1`**, `ou = 3` → stayed on the 40-man, an option was charged |

Both were assigned exactly 7 days after the DFA (the period length). The log
sentence is the same; only `is_on_secondary`/`oty` distinguish outright from
option. This confirms D-020: **read the export, not the log wording**. The earlier
audit's reading (40-man player at AAA after DFA) is correct for Nance and
incorrect as a general rule — it is an outcome, not a state.
`irrevocable_waivers = 1` is sticky after the period (28 players, all
`options_used = 3`); it is a status of the last waiver placement, not a
standing property. Its exact rule (irrevocable ⇒ option-charged vs outright?) is
**unresolved — Experiment D**.

**Unresolved:** claims (`claimed_team_id` is 0 for everyone; no claim wording
in the log), refusal/free-agency election, whether a DFA'd player can be
optioned/assigned before the period ends.

### 3.5 60-day IL and the 40-man (question C)

**Observed.** All 68 MLB players with `is_on_dl60 = 1` have
`is_on_secondary = 0` and `is_on_dl = 1`. All 53 MLB players on the ordinary IL
(`is_on_dl60 = 0`) have `is_on_secondary = 1`. Arizona: 30 on the 40-man, 26
active, 23 on some IL, 5 on the 60-day. So in OOTP's exported state **moving to
the 60-day IL removes the player from `is_on_secondary`** (consistent with
D-020). Minor-league IL players are not on the 40-man in either state.

The log carries only 8 "60-day" placements since 2026-03-22, and none for
Arizona's five (placed before the log's window), so the log cannot answer
"what event does a move to the 60-day IL produce".

**Unresolved:** what activation from the 60-day IL requires when the 40-man is
full (forced DFA? blocked?); the log event; whether the player is treated as
still holding 40-man *rights*. **Experiment C.**

### 3.6 Rule 5 (question E)

**Observed.** `years_protected_from_rule_5` takes only three values league-wide:
`0` (1,861 players, all with `pro_service_years = 0`), `4` (everyone else with
pro experience, up to 22 years), and `5` (132 players, all `pro = 0`). It
does not count down. It reads as a **window length** (4 vs 5 years), not a
remaining-protection counter. Consequently the existing roster-crunch flag
(`protected <= 0 && pro >= 4`) can essentially never fire, and cannot be
promoted into a clock.

Six `rule5_return` events exist in the log; nothing about protection dates.

**Conclusion.** A Rule 5 exposure clock is not supportable from this data.
Rights output for Rule 5 is `indeterminate` (`rule_not_implemented`).
Verifying the window needs a sim through the 2026-12-13 Rule 5 draft
(Experiment E, optional).

### 3.7 Trades and claims (question F)

**Observed.** `was_traded`, `trade_status`, `claimed_team_id` exist; the log has
no trade or claim wording among its 752 unsupported rows (they are signings,
extensions, international complex moves, and staff hires). Low priority; do not
block the evaluator on it.

### 3.8 Chronology-layer gaps this research found

These bear on rights and are chronology fixes, not rights rules:

- MLB↔AAA moves are classified generically when worded `Demoted`/`Assigned`
  (102 of 236 major→minor moves). Every minor→major move is paired: the 167
  `Promoted ... to Major League` rows equal `Recalled` (64) + `Purchased the
  contract` (103) exactly, and the second wording is what distinguishes a
  recall from a contract purchase.
- `Placed X on the secondary (40-man) roster.` exists once as `unsupported`.
- `Assigned X to <affiliate>` after a DFA is ambiguous between option and outright
  (§3.4); it must not be classified beyond "assigned".

---

## 4. Experiment protocol

### 4.1 Creating a safe copy (user action — Claude will not touch OOTP)

1. Quit OOTP completely. This checkpoints the live log; the save will have no
   `-wal`/`-shm` beside `temp/text_data.sqlite3`.
2. In Finder, duplicate the save folder. In
   `~/Library/Containers/com.ootpdevelopments.ootp27macqlm/Data/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/`
   copy `D-backs real save.lg` to **`RIGHTS-MASTER.lg`** (never open this one)
   and again to **`RIGHTS-EXP.lg`**.
3. Start OOTP and load `RIGHTS-EXP.lg` (File ▸ Load Game). If OOTP does not list
   the copy, use the live game's own **Save Game As…** to create it instead.
   Confirm the title bar shows `RIGHTS-EXP`, not the original.
4. To repeat from the same baseline: quit OOTP, delete `RIGHTS-EXP.lg`, and copy
   `RIGHTS-MASTER.lg` to `RIGHTS-EXP.lg` again. Never copy over the original.

The tool reads `RIGHTS-EXP.lg/import_export/csv` (the folder OOTP writes to when
you use **Game ▸ Database ▸ Export to CSV** in the copy). It writes only into an
isolated temp database and `captures/` (git-ignored). Do **not** point Pennant's
own import/watch at the copy while experimenting.

### 4.2 Procedure per experiment

```
# 0. Ensure the copy has been exported to CSV at the baseline
npm run rights:capture -- --export "<...>/RIGHTS-EXP.lg/import_export/csv" \
    --label A1-before --players "Player One,Player Two"
# 1. In OOTP: perform EXACTLY ONE action; note any message OOTP shows verbatim
# 2. Export to CSV again (do not sim unless the experiment says so)
npm run rights:capture -- --export "..." --label A1-after --players "..."
npm run rights:diff -- captures/A1-before.json captures/A1-after.json
```

Record for each: pre-state, the action and OOTP's on-screen wording (including a
refusal), the diff, and the log events. Repeat with a second player before
concluding anything.

### 4.3 Experiments and candidate players (Arizona, 2026-05-16)

| # | Question | Action (one) | Players | Watch |
|---|---|---|---|---|
| A1 | Option year charged on first option | Option an active player with 0 options used | Corbin Carroll (`ou=0`, 3 yrs service) and, separately, Nolan Arenado (`ou=0`, 13 yrs) to see whether service time blocks or changes it | `options_used`, `options_used_this_year`, log wording (`Optioned` vs `Demoted`) |
| A2 | Multiple assignments in a season | Recall (after waiting) then option the same player again | Adrian Del Castillo (`ou=2, oty=1`, optioned 04-17) | `oty` 1→2 with `ou` unchanged? |
| A3 | Third option year | Option a player with `ou = 2` | Taylor Clarke / Drey Jameson | `ou` 2→3 |
| A4 | Out of options | Try to option a player with `ou = 3` | Joe Ross / Pavin Smith / Ildemaro Vargas | refusal text? waiver prompt? counters? |
| A5 | Options disabled | (read-only) confirm `rules_minor_league_options` | — | league columns |
| B1 | Recall wait | Option a player, then try to recall him the same day and again on day 1, 5, 9, 10, 14, 15 | one active player | OOTP's refusal message and day it clears |
| B2 | Injury-replacement exception | Place an active player on the IL, then recall a player optioned earlier the same day | Tyler Locklear (optioned 05-04) as recall target | does the wait disappear? |
| B3 | Re-option after recall | Recall then option again within 1 day | Locklear / Del Castillo | refusal? |
| C1 | IL-60 removes 40-man | Place an injured active player on the 60-day IL | an injured active player (or use Cristian Mena, currently 10/15-day IL, `inj=8`) | `is_on_secondary`, `is_on_dl60`, org 40-man count, log |
| C2 | Activation with 40-man full | Fill the 40-man to 40 (setup), then activate a 60-day IL player | Blake Walston (24 days left) — wait until healed, or Justin Martinez | forced DFA? blocked? |
| C3 | Option/recall while on the IL | Try to option/recall a 10-day-IL player | Cristian Mena | refusals |
| D1 | DFA with options left | DFA a player with `ou < 3`, then capture daily for 8 days | a low-value active player | `designated`, `is_on_waivers`, `days_*`, `irrevocable_waivers`, `is_on_secondary`, `oty`, team/level on day 3 and day 7 |
| D2 | DFA out of options, ≥3 yrs service | Same, with `ou = 3`, `mlb ≥ 3` | Joe Ross (`ou=3`, `mlb=8`) | irrevocable? outright vs option on day 7? |
| D3 | Can a DFA'd player be moved early | Try option / assign on day 1 | the D1 player | refusal text |
| D4 | Claim | Let an AI club claim / claim an AI player | (optional) | `claimed_team_id`, log wording |
| E | Rule 5 window | Sim the copy to just past 2026-12-13 | capture 20 org players before/after | `years_protected_from_rule_5`, `pro_service_years`, log (optional, long) |

Setup actions that are not the measured action (e.g. filling the 40-man for C2)
are done first and captured as the "before".

### 4.4 Stop conditions

Do not build an action's rule until it has ≥2 concordant experiments. Every
result that is not reproduced keeps the action `indeterminate` with reason
`no_observed_example` / `rule_not_implemented`.

---

## 4.5 Experiment results (copied save `RIGHTS-EXP.lg`, 2026-05-16)

Captures: `captures/s1-before.json` / `s1-after.json` (git-ignored). OOTP's
on-screen wording was reported by the GM. One action per player, same in-game
day, no sim.

**Session 1**

| # | Player (service / options used) | Action | OOTP response | Export diff |
|---|---|---|---|---|
| 1 | Carroll (3 yr / 0) | option to AAA | moved, no message | team/level/`is_active` changed; **`options_used` and `options_used_this_year` unchanged (0/0)**; `just_signed` 0→1 |
| 2 | Clarke (6 yr / 2) | option | **"player refuses to be demoted"** | none |
| 3 | Hoffmann (0 yr / 1) | option | moved, no message | same as Carroll (counters 1/0 unchanged) |
| 4 | Arenado (13 yr / 0) | option | **"player refuses to be demoted"** | none |
| 5 | Ross (8 yr / 3) | option | **"out of option years and must clear waivers before being demoted"** | none |
| 6 | Mena (on 10-day IL) | option | **"this player isn't eligible to be demoted yet"** | none |
| 7 | Locklear (optioned 12 days earlier) | recall | promoted, no message (40-man had room) | team/level/`is_active`; counters stay 3/1 |
| 8 | Del Castillo (optioned 29 days earlier) | recall | promoted, no message | team/level/`is_active`; counters stay 2/1 |
| 9 | Kelly (rehab at AAA) | recall | **"the active roster is full"** | none — *not a rehab result*; the roster was full because #2 was refused |

Established (each concordant across ≥2 players unless noted):

- **Option counters are not charged at the moment of the option.** Two
  optioned players show `options_used`/`options_used_this_year` unchanged in
  an export taken after the move. Combined with observation §3.1
  (Herrera, optioned then recalled after 1 day, ended with `oty = 0`; long-optioned players
  have `oty = 1`) the charge is probably applied after some time on the
  assignment. **Unresolved: when.** Session 2 watches it daily.
- A same-day option leaves **no log event** (see below) and sets
  `just_signed = 1` (meaning unknown).
- OOTP has **three distinct refusal reasons** for an option attempt, in
  different wording: consent ("refuses to be demoted": 6 and 13 years' service),
  no option years ("must clear waivers", 3 used), and a status block ("isn't
  eligible to be demoted yet": injured list). The consent threshold lies between
  3 and 6 years' service (Carroll 3 allowed; Clarke 6 refused) — **unresolved**.
- A 12-day-optioned hitter (Locklear) was recallable with no message: a hitter's
  waiting period, if any, is ≤ 12 days. Same-day and short-stay recall not yet
  tested.
- **Recall message ordering:** a full active roster is reported before any
  eligibility reason, so an eligibility test must be done with a free spot.

**Chronology finding (affects D-022).** After the nine actions the CSV export
reflected every change, but the copy's `temp/text_data.sqlite3` (and its WAL,
0 bytes) had not been touched since load: its newest row was still an AI move
from before the actions, and none of the four human level moves appears. **The
live log lags in-session moves; an export can be current while the log is
silently behind it on the same date.** The date-based freshness test cannot see
this. What flushes the log (save, sim) is being established in Session 2.

## 4.6 Session 2, day 0 (still 2026-05-16)

GM actions and OOTP responses: Perdomo (4 yr) optioned, no message; Ginkel and
Thompson (5 yr each) refused; a DFA of a 40-man player is offered only as
"put on waivers", not performed; Carroll (optioned earlier that day) **recalled
the same day, no message**; Hoffmann and Kelly not recallable ("not enough
room": active roster full).

- **Consent threshold: 5 years of MLB service.** Refused: Ginkel 5, Thompson 5,
  Clarke 6, Arenado 13. Accepted: Perdomo 4, Carroll 3, Hoffmann 0. Matches the
  wiki (§6). An out-of-options player is told to clear waivers *before* consent
  is considered (Ross: 8 yr).
- **Same-day recall is allowed.** Carroll was optioned and promoted again on
  the same date with no refusal. Together with 1-day AI recalls in the log
  (§3.2) OOTP does not appear to enforce MLB's 10/15-day minimum.
  *Pending:* Hoffmann (pitcher) same-day.
- **A same-day reversal is not charged an option** (Carroll `ou` 0/0 after the
  round trip), and the wiki says a charge needs a day on the 40-man not on the
  active roster (§6). *Pending:* Hoffmann/Perdomo should charge at the next
  day tick.
- **The log flushes on Save Game.** The export before the save lacked every
  in-session move; the one after it held all of them (`Optioned`, then
  `Purchased the contract` for Carroll's return). Sim was not needed.
- **`Purchased the contract` is logged for a recall of a player already on the
  40-man** (Locklear, Del Castillo, Carroll all had `is_on_secondary = 1`
  before). The wording does not mean a 40-man addition. `Recalled` (67 in this
  log) is the other wording; what selects between them is unknown.

## 4.7 Session 2, days 05-17 to 05-24

Captures `s2-01`..`s2-03b`. The GM simmed one day after `s2-01`, so the DFA
"day 0" is **2026-05-17** (log dates confirm), not 05-16.

Log for the sequence (verbatim): `2026-05-17 Optioned RP Brandyn Garcia to Triple
A Reno`; `Promoted/Purchased the contract of RP Andrew Hoffmann`; `RP Joe Ross
was designated for assignment and placed on waivers.`; `LF Tim Tawa was
designated for assignment and placed on waivers.`; `2026-05-24 Assigned LF Tim
Tawa to Triple A Reno.`

| Player | State after | Reading |
|---|---|---|
| Hoffmann (pitcher, 0 yr) | optioned 05-16, recalled 05-17: `ou` 1→2, `oty` 0→1 | **Charged**, after one night away. Contrast Carroll (round trip within 05-16): `ou` 0/0. |
| Perdomo, B. Garcia | still at Reno: `ou` 1→2, `oty` 0→1 | Charged by 05-23. |
| Ross (8 yr, `ou=3`) | DFA 05-17: `is_on_secondary=0`, `is_active=0`, `designated_for_assignment=1`, `is_on_waivers=1`, **`irrevocable_waivers=1`**; 05-23 `dfaL=1, wd=6, wL=0`; 05-24 `dfaL=0, wd=7`; still DFA'd. GM: refused assignment. | Out of options ⇒ irrevocable; consent applies at 8 yrs; both documented. |
| Tawa (0 yr, `ou=1`) | 05-24 "Assigned to Triple A Reno": **`is_on_secondary=0`**, `ou 1`, `oty 0`, `dfa=0`, `irr=0`, `days_on_waivers=7` (stale) | **Outrighted, not optioned.** No option charged. The GM saw the UI word "option". Same as Garcia (§3.4). |

- **DFA removes the player from the 40-man and from the active roster the same
  day** (org 40-man 30→28, active 26→25 after two DFAs and moves). Documented:
  a DFA player counts against no roster limit.
- **Clocks confirmed:** `days_on_dfa_left = 7 − elapsed`, resolution day is
  DFA date + 7 (`dfaL = 0`); waiver window 3 days; `days_on_waivers` is stale
  once resolved (Tawa: 7).
- **Recall waiting period:** a pitcher (Hoffmann) was recalled after one night
  and a hitter (Carroll) the same day. With the AI's 1-day recalls, **OOTP does
  not enforce MLB's 10/15-day minimum**. (Not tested: an injury exception is
  moot when there is no minimum.)
- **Option charge:** charged by the first day rollover after leaving the active
  roster for the 40-man's minor-league side; not charged for a same-day round
  trip; not charged for an outright. Outlier still unexplained: Welinton
  Herrera (AI), optioned 05-05 and recalled 05-06, `oty = 0`.
- **Tick timing** could not be pinned below "by the next export" (exports were 7
  days apart).

## 6. OOTP documentation (Documented)

Fetched 2026-09-19; a summariser read each page, so quote the pages before
relying on exact wording. Pages describe the wiki as of 2024 and manuals for
OOTP 16-22; none is written for OOTP 27.

- Options — [OOTP wiki: Minor League Options](https://wiki.ootpdevelopments.com/index.php?title=OOTP_Baseball%3AImportant_Game_Concepts%2FRoster_Rules_and_Management%2FMinor_League_Options):
  three option years; one is used when a player spends a day on the secondary
  roster without being on the active roster (one day suffices — this differs
  from MLB's 20 days); a player who is on the parent club all season uses none;
  out of options ⇒ must pass through waivers to be demoted. No fourth option
  year is mentioned.
- Waivers — [wiki](https://wiki.ootpdevelopments.com/index.php?title=OOTP_Baseball%3AImportant_Game_Concepts%2FRoster_Rules_and_Management%2FWaivers):
  required when removing a player from the 40-man, and when demoting an
  out-of-options player. Demoting an out-of-options player uses **irrevocable**
  waivers (cannot be withdrawn; if claimed, the team loses him); everything else
  is revocable. Three calendar days by default, unclaimed ⇒ "cleared waivers".
- DFA — [wiki](https://wiki.ootpdevelopments.com/index.php?title=OOTP_Baseball%3AImportant_Game_Concepts%2FRoster_Rules_and_Management%2FDesignated_for_Assignment_%28DFA%29):
  7 calendar days by default; **after expiry the game will not advance until
  the player is assigned or released**; a DFA player counts against no roster
  limit; options at expiry are: assign to the active roster (needs a 40-man
  spot), assign to the minors, trade, release; **five or more years of MLB
  service may refuse assignment to the minors**; a major-league contract must be
  placed on the 40-man before assignment to the minors; out of options ⇒ must
  clear irrevocable waivers first.
- Injured list — [wiki](https://wiki.ootpdevelopments.com/index.php?title=OOTP_Baseball%3AImportant_Game_Concepts%2FRoster_Rules_and_Management%2FInjured_Lists):
  10-day IL players stay on the secondary roster; **60-day IL removes the
  player from it**, opening a slot. Activation with a full 40-man is not
  specified (an inference that a slot is required is MLB's rule, not the
  wiki's).
- Rule 5 — the 40-man manual pages name Rule 5 protection as a reason to add a
  player; the fetched pages give no protection-year table.
- Recall waiting period — **not documented** in any page found.

**How documented and observed rules line up**

| Rule | Documented | Observed | Status |
|---|---|---|---|
| 3 option years | yes | `options_used` max 3 | agree |
| 5-yr service may refuse demotion | yes | 5, 5, 6, 13 refused; 4, 3, 0 accepted | agree |
| Out of options ⇒ waivers first | yes | Ross message | agree |
| DFA 7 days, waivers 3 days | yes | `days_on_dfa_left + days_on_waivers = 7`, waiver clock 3; league rules 7 / 3 | agree |
| Irrevocable = demoting out-of-options | yes | Nance (irrevocable, stayed on 40-man, option charged) vs Garcia (plain waivers, off the 40-man) | agree (2 examples) |
| 60-day IL leaves 40-man | yes | 68/68 `is_on_secondary = 0` | agree |
| Option charged after a day away from the active roster | yes | Carroll round trip uncharged; tick pending | pending |
| Recall waiting period | silent | same-day recall allowed; 1-day AI recalls | **no enforced minimum seen**; pending Hoffmann |
| Activation from 60-day IL needs a slot | silent | untested | pending |

## 4.8 Session 3 (05-24 to 05-25)

- Ross was restored: the log holds `Placed RP Joe Ross on the secondary (40-man)
  roster.` then `Placed RP Joe Ross on the active roster.` (both parsed as
  `unsupported` events today). His `options_used` stayed 3; `designated`,
  waivers and `irrevocable_waivers` cleared.
- The league's 40-man limit was lowered to 28 in the copy (a commissioner
  setting) and the export carries it (`rules_secondary_roster_limit = 28`). The
  organization then sat at 29, over the limit; OOTP did not force a cut, and
  **adding to a full 40-man is refused** ("cannot").
- Three players went to the **10-day** IL: the organization's IL count rose
  21→24 while its 60-day count (5) and 40-man (29) did not move. Consistent with
  the wiki and with 68/68 exported 60-day players being off the 40-man.
- **A player cannot be put on the 60-day IL without a qualifying injury**
  (Lawlar, 7 days left, was refused). The threshold was not measured. Activation
  from the 60-day IL onto a full 40-man was **not tested**: nobody on the list
  healed within the session. The experiments were stopped here by decision; the
  action stays `indeterminate`.
- The original save's `temp/` folder was empty by 19:51 although it held a log
  on 09-18, so the app reports the log unavailable for it while the copy loaded
  in OOTP has one. The cause is not established; the log is a live artifact of a
  loaded save.

## 4.9 Injured-list activation (study for MLB Operations, 2026-09-19)

Question: what does OOTP require to activate a player from the injured list? Needed by the
MLB Operations "injured player returns to a full active roster" workflow.

**Documented.** The wiki's Injured Lists page covers placing a player on the 10-day and
60-day lists and where they are in the interface. It says nothing on activation: not
whether the player must be healed, whether an active or 40-man spot is required, any
minimum stay, or what happens when a roster is full.

**Observed (export state, no in-game action).** Two exports of the same league ten days
apart (the original save at 05-15 and the `RIGHTS-EXP` copy at 05-25):

- Every one of the 30 clubs has exactly 26 active players (25 in the copy after the
  experiments); the limit is never exceeded.
- No active MLB player carries an injured-list flag (0 in either export), and every active
  player is on the 40-man (0 exceptions in the original; 1 in the copy, an experiment
  artifact from restoring a DFA player).
- Of 115 AI-club major-league players on the IL at 05-15, none was active at 05-25 while
  still injured: those no longer injured had 9 or fewer injury days left ten days earlier.
- Healed players are not activated automatically: 5 major-league players sit on the IL with
  `injury_left = 0` in the original save (3 in the copy).

This describes AI clubs. It suggests activation follows healing and that the active limit
holds, but it is not evidence of what a human manager may do, and it says nothing about a
full roster (the AI may clear a spot first).

**Result.** `activateFromInjuredList` stays `indeterminate`. `playerRights.ts` now states
what is known instead of a bare "not observed": the list, days left, whether he has healed,
whether the active roster (and, from the 60-day list, the 40-man) has a spot, and, in
`missing`, exactly which unknowns apply (early activation of an injured player; the behavior
when a roster is full). The AI-only observation is carried as a `limitation`, not a reason.

**Experiment required (not run).** In a copied save, one action each, capturing the export
and the log before and after (`npm run rights:capture`):

1. Activate an injured player who still has days left, with a spot open. Record the on-screen
   message. (Early activation permitted or refused.)
2. Activate a healed 10-day-IL player onto a full 26-man. Record whether OOTP refuses, or
   forces a move, and which.
3. Repeat 2 for a 60-day-IL player with the 40-man full (the league's limit may be lowered
   in the copy as in section 4.8).
4. Note the log wording (`Activated ... from the injured list`?) and the option counters.

Two concordant players per case before encoding a rule (section 4.4).

## 4.10 Composed component: place on the active roster after a 40-man addition

`playerRights.ts` now returns `composed.promoteToActive` for a minor leaguer who is not on
the 40-man: the active-roster component only. It is evaluated from the export invariants
above (an active player is always on the 40-man; the active limit holds) and owns the
active-roster spot; the 40-man spot stays with `addToFortyMan`. It needs no chronology (a
player off the 40-man cannot be on rehab or optioned). A caller composes the two; there is
no combined "add and promote" right. An IL or DFA player is `indeterminate` / `ineligible`
as for `recall`.

## 4.11 Injured-list activation and the 60-day list: what the log holds, and the experiment sheet (2026-09-19)

**Status: the experiment has NOT been run.** Pennant cannot operate OOTP; the `RIGHTS-EXP.lg`
and `RIGHTS-MASTER.lg` copies exist and the game in the copy has advanced, but no controlled
before/after capture of an activation exists. Nothing below is encoded as a rule.

**What the copy's live log already holds (not a controlled experiment).** The game in
`RIGHTS-EXP.lg` is at 2026-06-05; its last CSV export is dated 2026-05-25 (a 12-day gap, so the
export cannot be paired with these events). Arizona's log since the export:

| Date | Event (log wording) | Note |
|---|---|---|
| 05-23 | `Placed SP Cristian Mena on the active roster.` / `Activated SP Cristian Mena from the injured list.` | 10-day list, healed the same day; spot open (25 active) |
| 05-31 | `Placed 2B Ildemaro Vargas on the 10-day injured list.` | injury: day-to-day, 3 days |
| 05-31 | `RP Jonathan Loáisiga was designated for assignment and placed on waivers.` | |
| 06-03 | `Purchased the contract of SP Merrill Kelly from Triple A Reno` | |
| 06-05 | `Placed CF Jordan Lawlar on the active roster.` / `Activated CF Jordan Lawlar from the injured list.` | injured 05-25 for about a week; healed about 06-01; activated four days later |

Reading, with its limits: an activation of a healed 10-day player onto a roster with a spot is
logged as two events (the placement, then the activation) with no option, designation or 40-man
event beside it. **Provenance is unknown**: OOTP may place a human club's injured players on the
list and activate healed ones automatically under a game setting Pennant has not established, so
a game-performed activation is not evidence of what a manager may do. Two examples of unknown
provenance are not a rule (section 4.4).

**Sheet for the GM (one action at a time; two concordant players per case before any rule).**

Setup, once:

1. In OOTP (copy loaded, title bar `RIGHTS-EXP`): note whether any game setting places injured
   players on the list, or activates healed players, for your club. Record its value.
2. **Save Game**, then **Game ▸ Database ▸ Export to CSV**, so the export matches the log.
3. `npm run rights:candidates -- --export "<...>/RIGHTS-EXP.lg/import_export/csv"` names the
   players that fit each case and the roster counts.

For each case: `npm run rights:capture -- --export "<...>" --label <case>-before --players "..."`,
perform the one action, write down OOTP's message verbatim (including a refusal), **Save Game**,
export again, `... --label <case>-after`, then `npm run rights:diff -- captures/<case>-before.json
captures/<case>-after.json`.

| Case | Setup | Action | Record |
|---|---|---|---|
| **1** early, spot open | a 10-day-list player with injury days left; active roster below the limit | activate him | allowed or refused; message; `is_on_dl`, `is_active`, `injury_left`; log events |
| **2a** healed, spot open | a healed 10-day player; active roster below the limit | activate | as above; confirm no option/40-man counter moves |
| **2b** healed, active full | fill the active roster to the limit first (recall a 40-man player); a healed 10-day player | activate | refused, or a forced move (which and who chooses); counts before and after |
| **3a** 60-day, 40-man room | a healed 60-day player; 40-man below its limit | activate | does he return to the 40-man (`is_on_secondary` 0 to 1)? org 40-man and active counts; log events |
| **3b** 60-day, 40-man full | as 3a with the 40-man at its limit (the copy's limit is lowered to 28) | activate | refused, forced move, or allowed over the limit; message |
| **4** 60-day threshold | 10-day-list players with 8, 15, 30 and 60+ injury days left | try to place each on the 60-day list, one per player | accepted or refused at each length; message. Only a 7-day injury has been tried (refused) |

Do not sim between the capture, the action and the second export unless a case says so. Do not
generalize from an ambiguous failure. If a case cannot be constructed safely, leave that rule
`indeterminate` and write down why.

**What each result would change in `playerRights.ts`.** Cases 1 to 3b decide
`activateFromInjuredList` (eligible / ineligible / a stated prerequisite, and whether a 40-man
spot is restored or required); case 4 decides `placeOnSixtyDayIl`, which today is
`indeterminate` for any injured 40-man player with the single refusal carried as a fact. MLB
Operations needs no change: it already shows each prerequisite as a separate clearing link and
consumes whatever status Rights returns.

## 5. What the evaluator implements (Phase 3)

`server/playerRights.ts`, fed by `server/leagueRules.ts`, `PlayerState`, the
assignment context, roster counts and freshness. Each conclusion carries its
basis.

| Action | Eligible when | Ineligible when | Indeterminate when |
|---|---|---|---|
| `option` | MLB club, active, not on an IL, league options on, under 5 yrs service, `options_used < 3` | not on the MLB club / active roster; on an IL; ≥5 yrs (refuses); `options_used ≥ 3` with none charged this season | a needed counter is blank; league options off or unexported; `options_used ≥ 3` with a year already charged this season |
| `recall` | below MLB, on the 40-man, not DFA/IL, **log current and shows an explicit option** | at MLB; DFA; off the 40-man | cause not established (log missing/behind, rehab, unattributed); minor-league IL; roster size unknown. An unmet active-roster spot is a requirement, not a refusal. No waiting period is applied. |
| `addToFortyMan` | off the 40-man, not on the 60-day IL (also a DFA player, as Ross) | already on it | on the 60-day IL; 40-man size or limit unknown. A full 40-man is an unmet requirement. |
| `designateForAssignment` | on the 40-man, not designated, not injured/rehab | not on the 40-man; already designated | injured list or rehab |
| `outrightAssignment` | designated, <5 yrs service, waiver window ended | not designated; ≥5 yrs (refuses); waivers not cleared | a needed field is blank |
| `activateFromInjuredList` | never | not on an IL | always when on an IL (rule not observed); states the list, days left, healed, and `needsActiveSpot` / `needsFortyManSpot` / `activeClearingNeeded` / `fortyManClearingNeeded`; an unmet spot is a requirement, not a refusal |
| `placeOnSixtyDayIl` | never (threshold unmeasured) | already on it; off the 40-man; no injury days left | any injured 40-man player not yet on the 60-day list (7-day refusal carried as a fact) |
| Rule 5 | — | — | off the 40-man and league has Rule 5; "protected" on the 40-man |

Stale evidence: a current-state gate (export behind the save, or no export)
makes **every** action indeterminate; the log is judged per action, and only
`recall` depends on it (rehab is indistinguishable from an option in the
export). An undatable export (`unverified`) is used with a stated limitation.

Not modeled, by evidence: a fourth option year, re-optioning within the season
that used the last option year, Rule 5 exposure, IL activation, claims,
refusal-and-election paths, trade semantics, and whether a rehab return is a
recall.

## 6a. Chronology findings that affect the parser

- `Purchased the contract of X` is logged for a recall of a 40-man player.
- `Assigned X to <club>` after a DFA is an outright or an option depending on
  the export, not the wording; the log's `DFA` sentence says `placed on
  waivers` even when the export flags the waivers irrevocable (Ross).
- The log flushes on **Save Game**; an export can be current while the log lacks
  same-day moves made since the last save.
- `Placed X on the secondary (40-man) roster` / `on the active roster` are
  unparsed (`unsupported`); so are `was claimed off waivers by`, signings, and
  extensions.

## 7. Status

- Phase 1 audit, observational study, 12 documented rules cross-checked, and
  three sessions of controlled experiments on `RIGHTS-EXP.lg`: complete.
- Evaluator, roster-crunch migration, player card and 40-man page: implemented
  and tested. Remaining open questions are listed in §5 and §3.
