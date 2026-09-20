# Major League Operations

Design record and audit for the MLB Operations subsystem (`feature/mlb-operations-v2`).
It records what `origin/feature/mlb-operations` contained, what was kept, replaced or
dropped, and the architecture built on the current foundations. `PROJECT_STATE.md`
says what is implemented; this file says why.

Status is stated per section. Nothing here is implemented merely because it is
described: see [§12](#12-what-is-implemented-in-this-slice) for the built slice and
[§14](#14-checkpoint-log) for the working log.

## 1. The GM problem

> What problems require my attention on the major-league roster, what realistic choices
> do I have, what would each choice require, and what consequences follow through the
> organization?

MLB Operations is a **consumer**. It coordinates answers owned elsewhere and owns none of
them:

```text
Scouted Evidence ──► Player Development (defensible?) ─┐
Player State ──► Player Rights (possible?) ────────────┤
Player State + chronology ─────────────────────────────┤
Organizational Philosophy (prefers, after validity) ───┼──► MLB Operations ──► GM
Minor League Operations (farm consequence) ────────────┤
Objective data: stats, contracts, service, injuries ───┘
```

It does not decide scouting ability, developmental readiness, option/recall/40-man
rights, philosophy, or minor-league assignment suitability, and it never executes or
silently recommends a transaction. The GM decides.

## 2. Forensic audit of `origin/feature/mlb-operations`

Ten commits, +7,059 lines against `a57fc63` (before the Player State, Rights and evidence
work). The branch was **not merged**; it was read with `git show origin/feature/mlb-operations:<path>`.

Branch inventory (lines): `rosterTransactionState` 398, `rosterStateHistory` 506,
`transactionHistory` 56, `majorLeagueOperations` 387 (context + need detection),
`majorLeagueResponders` 211, `majorLeagueRoleSuitability` 263, `majorLeagueTransactionPlan`
226, `majorLeagueOrganizationalConsequences` 126, `minorLeagueConsequences` 234,
`minorLeagueCascadePlanner` 467, `majorLeagueSolutionSynthesis` 456,
`majorLeagueOperationsRoutes` 79, `pitchingRole` 23, `MajorLeagueOperations.tsx` 339, edits
to `minorLeagueRoster`/`org`/`rosterops`/`valuation`/`api`, and ~2,100 lines of tests.

### 2.1 Component decisions

Legend: RETAIN / MODIFY / REPLACE / REMOVE / DEFER.

| # | Component | GM problem it targeted | Mechanism | Evidence it depends on | Valid after State/Rights/Evidence? | Owner | Decision |
|---|---|---|---|---|---|---|---|
| 1 | `rosterTransactionState.ts` (roster state + `evaluateRosterAction`) | "Can I recall/option X?" | Re-reads tables; tri-state action results; 40-man from `isOnFortyMan` | Raw `players_roster_status` | **No.** 40-man inferred (35 vs the export's 30, D-020); `recall` returns `eligible` with no chronology input; re-reads tables inside the rights layer | State + Rights | **REMOVE** (superseded by `playerState.ts` / `playerRights.ts`; already established in RIGHTS_RESEARCH §1) |
| 2 | `isOnFortyMan` in `valuation.ts`, `optionYearState` use in `rosterops.ts` | Shared 40-man definition | Active OR secondary OR MLB-IL | Heuristic | **No** — the disproven inference | Rights | **REMOVE** |
| 3 | `rosterStateHistory.ts`, `transactionHistory.ts` | Persistent roster observations | Snapshot per import, field diffs, log correlation | Pennant snapshots + log | Already **ported to main in adapted form** (observed fallback, never names a transaction) | State | **RETAIN as ported**; MLB Ops must not create needs or causes from it |
| 4 | `majorLeagueRosterContext` | Roster facts for MLB workflows (Phase 1A adapter) | Wraps #1 | #1 | No (#1 is gone); a second copy of state | State | **REMOVE** |
| 5 | Reactive **need detection** (`majorLeagueReactiveNeeds`) | "What roster problems exist?" | A need exists only if a **snapshot diff between two Pennant imports** shows an MLB role-holder lost availability and current role coverage fell below the earlier snapshot's | Snapshot history + causal correlation | **Structurally invalid.** (a) On the real save (one import) it yields *zero* needs regardless of the roster's condition. (b) A problem is invisible until a second import happens to straddle it. (c) It attributes cause ("injury", "trade") from snapshot differences, which D-020 forbids. (d) "Coverage fell since the last snapshot" is a proxy for "the role is uncovered": a starter replaced by a starter is still flagged if counts dipped. | MLB Ops | **REPLACE** (state-derived detection, §3-A). Keep: reactive framing, revalidation against current state, no persisted queue, need identity, temporary/structural horizon |
| 6 | `active_roster_capacity` need (count < limit) | Empty roster spot | Count vs `rules_active_roster_limit` | Export + league rules | Valid idea | MLB Ops | **RETAIN idea**, rebuilt on `playerState` counts and league rules; no role attached |
| 7 | Responder assembly (`majorLeagueResponders`) | "Who could fill it?" | Active same-role players + AAA callups; PD gate for AAA | `rosterTransactionState`, `mlbDiscussionDevelopmentGates`, `gloves()` | Partly. Good: separates discovery, availability, development, keeps an exclusion list with reasons, deliberately unranked. Bad: treats `!gate.eligible` as `developmentally_prohibited` (collapses **indeterminate** into rejection, violates D-018); an unassessed player becomes `not_applicable` and passes (a prospect just promoted with a tiny sample sails through); calls `gloves()` directly (boundary guard forbids it now); only AAA, no 40-man/rights stage | MLB Ops (discovery) / Development (gate) | **MODIFY**: keep the staged, unranked, explained-exclusion shape; re-point every stage at the shared modules; add a rights stage; represent `unassessed` honestly |
| 8 | PD gate helper `mlbDiscussionDevelopmentGates` (in `org.ts`) | Expose the AAA→MLB assessment to other domains | Runs `computeProspects`, extracts `mlb_discussion` evaluation | Player Development | Right home and right idea, but returned only `eligible: boolean`, losing the defensible/indefensible/indeterminate judgment and missing-evidence list | Development | **MODIFY** (port with `judgment` + `missingEvidence`) |
| 9 | Role suitability (`majorLeagueRoleSuitability`) | "Would his profile fit this MLB role?" | Reads `batting_ratings_*`, `pitching_ratings_*`, career stats directly; a mean of visible ratings | Raw rating columns | **No.** Reads rating columns directly (D-017 guard); a home-made rating mean is a second composite; MLB-level suitability is already a Player Development output (`evaluateDestinationFit(playerId, mlbTeamId)`) | Development / Scouted Evidence | **REPLACE**: consume `evaluateDestinationFit` for the MLB destination + adapter evidence; keep the objective performance line |
| 10 | Transaction plan (`majorLeagueTransactionPlan`) | "What has to happen?" | `feasibility` + steps + "corresponding decisions" (GM picks outgoing player, never enumerated) | `evaluateRosterAction` | Structure is right (path of steps, requirements distinct from eligibility, `indeterminate` propagates). Wrong source of legality (#1). Never helps the GM choose who leaves. | MLB Ops composing Rights | **MODIFY**: same shape over `ActionRights`; add the clearing-options list |
| 11 | Organizational consequences + `minorLeagueConsequences` | "What happens below?" | Hypothetically removes a minor leaguer, recomputes affiliate health, asks a cascade planner for downstream moves | `minorLeagueRoster` scenario extension, `computeProspects` | Idea is the most valuable in the branch. Mechanism is sound: read-only scenario over the existing health evaluator | Minor League Ops | **RETAIN idea, MODIFY**: reimplement the scenario hook against current `minorLeagueRoster.ts` (removal/assignment overrides only), report deltas |
| 12 | `minorLeagueCascadePlanner` (467 lines) | Chain of farm moves after a recall | Bounded search over PD-authorized promotions; own role-fit rule (`gloves()>=35`), own philosophy ranking | PD assignment evaluations, `gloves()`, philosophy | It is a **second Minor League Operations solver** inside MLB work; duplicates `minorLeagueMoves`/pitching ops, calls `gloves()`, and only sees `eligible` (indeterminate silently dropped) | Minor League Ops | **DEFER** — MLB Ops reports the farm *deficit* a move creates (health delta). Solving the cascade belongs in a later Minor League Ops feature, not here |
| 13 | Solution synthesis (`majorLeagueSolutionSynthesis`) | Compare alternatives | Per-candidate variants; six preference "axes" ±1; non-dominance → tiers (`preferred`, `strong_alternative`…) | All of the above | Good instincts: no master score, structured reasons, `cannot_responsibly_compare`. Problems: preference tiers read as a ranking; axes mix facts with philosophy; one row per (responder × farm variant) inflates near-identical alternatives; axes such as "role style" compare raw rating means | MLB Ops + Philosophy | **MODIFY**: keep no-score/structured-reasons/cannot-compare; replace tiers with per-dimension philosophy annotations among *valid* alternatives; group equivalent paths |
| 14 | Philosophy in synthesis | "What does the org prefer?" | Reads dimensions to set axes; `preferred_conditional` etc. | Philosophy | Boundary respected (only after validity) but tier names imply a verdict | Philosophy | **MODIFY** (preferred / acceptable / disfavored / no preference, only inside the valid set, dimension named; mirrors `assignmentPreference`) |
| 15 | Routes (`/mlb-operations/:orgId/needs`, `…/solutions`) | API | Queue + per-need packet | — | Shape fine; queue triggers full responder assembly per need | MLB Ops | **MODIFY** |
| 16 | Workspace UI (`MajorLeagueOperations.tsx`) | GM workflow | Need list → decision packet with variants, tier badges, expandable evidence | — | Right instinct (problem-centred). Weaknesses: opens on an empty inbox on a healthy roster (no way to ask "what if"), tier badges, no roster spot summary, no per-stage verdicts | UI | **MODIFY** |
| 17 | `pitchingRole.ts` | Normalize pitcher role codes (11/12/13) | Pure helper | Exported `position`+`role` | Valid, tiny, objective | State | **RETAIN** |
| 18 | Tests (~2,100 lines) | — | Mostly assert the old shapes | — | Encode the old need/tier semantics | — | **REPLACE** (new tests target the new contracts; ideas such as "no responder when role unknown" and "indeterminate propagates" carry over) |
| 19 | `active_mlb` responders (use an existing player in another role) | Role change instead of a callup | Same-role active players | — | Real alternative ("bullpen arm to the rotation"); old version matched only same-role players (which are not a change) | MLB Ops | **MODIFY**: cross-role candidates (a reliever whose Player Development role assessment supports starting; a hitter with a visible position grade) with the vacated role's consequence |

### 2.2 Conflicts with the new foundations

1. **State/rights:** #1, #2, #4 recompute 40-man/option facts and recall legality the layer
   that now owns them disproved (D-020, D-023).
2. **Chronology:** need cause/horizon were inferred from snapshot deltas (D-020 forbids
   naming a cause from a difference).
3. **Evidence:** #9 and #12 read rating columns / call `gloves()` — both fail
   `tests/evidenceBoundary.test.ts` today.
4. **Indeterminate (D-018):** #7 and #12 read `eligible: false` as rejection; the
   `not_applicable` development state made an unassessed prospect look cleared.
5. **Ownership:** #12 is a second farm solver; #9 a second scouting composite.

### 2.3 Strongest ideas that survive

- Needs are **current problems re-validated against present state**, never a persisted or
  historical queue.
- Discovery → availability → development → transaction path → consequences, with each
  stage explained and a candidate never silently dropped.
- **Unranked** presentation; no master score; `cannot_responsibly_compare`.
- Transaction paths carry *requirements* (spot, 40-man addition), distinct from eligibility.
- **Read-only farm scenario**: "what does Reno look like without this pitcher?"
- Philosophy strictly after validity, dimension named.

### 2.4 Weakest assumptions

- A need only exists after two imports straddle it.
- Coverage count vs. the earlier snapshot is the meaning of "uncovered".
- Absence of a Player Development assessment means "no objection".
- Roster-clearing is always "GM decides" with no candidates shown.
- Preference tiers on structured axes read as a leaderboard.
- MLB role suitability can be a mean of visible ratings.

### 2.5 Real-save evidence for the audit

On the imported Arizona save (through 2026-05-15, 26/26 active, 30/40-man): the old detector
returns **no needs** (single import, no transitions) even though the club has Cristian
Mena due back from the 10-day IL in 8 days with a full active roster, five pitchers on
the 60-day IL and a reliever/rotation depth that a GM would want to check. The transaction
log is absent in this save's `temp/`, so every recall of a 40-man Reno player is
`indeterminate` in the rights layer, honestly. Only two of 23 assessed AAA players are
`defensible` for MLB under Player Development's gate.

## 3. Product model

### A. Operational Need

A concrete, currently true (or GM-posed) problem with the active MLB roster.

| Kind | Meaning | Derived from | Slice 1 |
|---|---|---|---|
| `role_below_standard` | Healthy active players in a role fall below Pennant's stated standard (5 SP, 7 RP, 2 C) | Player State + counts | ✔ |
| `open_active_spot` | Active count is below the league's limit and no role need consumes the spot | State + league rules | ✔ |
| `il_return_crunch` | An org player on the IL is due back within the window and the active roster is full | State (injury days left) | ✔ |
| `what_if` (origin `hypothetical`) | The GM asks "if X is unavailable…" | State + a stated assumption | ✔ |
| performance review | Sustained, sample-qualified weakness at a role | Stats + context | DEFER (flag only when built; never a transaction trigger) |
| bench/positional coverage, DH/platoon, defensive coverage | Composition beyond C | Depth + fielding grades | DEFER |

Each need carries: kind, origin (`observed` | `hypothetical`), affected role, severity,
urgency, horizon (`temporary` | `extended` | `long_term` | `unknown` with the days and where
they came from), causes (players and *stated* facts, never inferred), evidence, unknowns.

**Detection principles** (the answers to Phase 3):

- A need must be derivable from **the current export** so it appears on the first import.
- Standards are named constants, shown to the GM, and marked as Pennant's assumption.
- Injury needs need duration: `injury_left` is exported. A 3-day bench problem is
  `temporary`; days on the 60-day IL are `long_term`.
- Roster imbalance ≠ performance weakness. Only the first is built.
- No need from tiny samples; no performance need in this slice.
- Reactive by default; the GM can pose a `what_if`. Nothing is proactive-alerting.
- Depth does not raise severity yet (DEFER); it is shown as a fact in the response.
- Standings/competitive context is DEFER; the philosophy `competitiveWindow` may
  eventually act as a preference only.
- When the evidence is thin the need says so (`unknowns`), and is a *flag for review*,
  not an instruction.

### B. Candidate Response

A player or action that might address a need, carrying **structured specialist verdicts**
rather than a score:

```text
discovery      how he was found (source, role match, objective facts)
availability   objective state: injured, DFA, waivers
development    defensible | indefensible | indeterminate | unassessed | not_applicable
rights         per required action: eligible | ineligible | indeterminate, with basis
roleFit        Player Development destination fit at the MLB level + evidence completeness
consequence    MLB counts, minor-league scenario delta, facts (options, service)
philosophy     preferred | acceptable | disfavored | no_preference (valid alternatives only)
```

Stages never collapse. A candidate that fails a stage stays in the response, in an
explained group (see §6).

### C. Transaction Path

An ordered composition of `ActionRights` from `playerRights.ts`: for a 40-man Reno player
`recall`; for a non-40-man player `addToFortyMan → recall`; for an internal change, none.
Requirements (an unmet 40-man/active spot) and unknowns are carried up. **A path is only
as certain as its least certain step** — any `indeterminate` step makes the path
`indeterminate`; MLB Operations never decides legality.

### D. Organizational Consequences

- MLB: active and 40-man counts before/after against the league limits (rights supplies
  the requirement; counts come from state).
- Farm: the source affiliate's health before/after via a read-only scenario on
  `minorLeagueRoster`; MLB Ops reports the deficit, it does not solve the cascade.
- Contract/control facts: MLB service, options used/remaining, Rule 5 standing, major-league
  contract flag — as facts, never as valuation.

### E. Alternatives / comparison

Candidates group by **path kind** (internal role change; recall a 40-man player; add to the
40-man) so equivalent players are not presented as distinct strategies. No winner is
declared. Philosophy annotates valid alternatives with the dimension that drove it.

## 4. Candidate generation (Phase 4)

Discovery is objective and generous; each subsequent stage is its own gate, and a failing
candidate is listed with the stage and reason:

1. **Discovery** — same-role (or Development-supported cross-role) players at AAA and every
   40-man minor leaguer. Lower non-40-man minor leaguers are counted, not listed
   (`not considered: Development evaluates AAA→MLB only`).
2. **Availability** — injured, DFA/waivers, rehab.
3. **Development** — the MLB-discussion assessment from `org.ts`. `unassessed` (no
   current-level sample) is *not* a pass, and not a rejection: it is shown as "Development has
   no assessment (sample X)".
4. **Rights** — every required action from `rightsFor`.
5. **Role fit** — `evaluateDestinationFit(player, mlbTeam)` (classification `poor|borderline|
   viable|strong|indeterminate`) and the adapter's evidence completeness.
6. **Philosophy** — only among candidates that pass stages 2–4 as `defensible`/`eligible`.

Group labels a GM sees: *Developmentally defensible & transactionally open*, *Open, but
Development cannot establish*, *Blocked by Development*, *Blocked by rights*, *Rights
indeterminate*, *Role mismatch*, *Unavailable*.

## 5. Workflow / UX (Phase 5)

Problem-centred, no leaderboard. Page **MLB Operations** (Operations nav group):

1. **Roster issues** (top-left): roster spot summary (active x/26, 40-man y/40, IL, evidence
   freshness) and the list of issues with severity, kind, origin and horizon. "Ask a
   what-if" picker for an active player.
2. **Issue workspace**: what/why (evidence, standards, causes), urgency and horizon, unknowns.
3. **Responses**: grouped candidates; each row shows its staged verdict chips, and expands to
   the transaction path, roster effects, farm consequence and every reason with its basis.
4. **Decision** stays the GM's: no accept button, no execution.

## 6. Decisions

Recorded in `DECISIONS.md` as D-024 (MLB Operations is a consumer; state-derived needs;
staged, non-collapsing gates; no ranking).

## 7. Retained, modified, replaced — summary

| Old branch | Outcome in this slice |
|---|---|
| `pitchingRole.ts` | **Retained** (ported unchanged in behavior) |
| Reactive need framing, current-state revalidation, identity, temporary/structural horizon | **Retained as ideas**, rebuilt in `mlbNeeds.ts` on Player State |
| Responder staging (discovery, availability, development, transaction, unranked) | **Modified** into `mlbResponses.ts`: adds rights and role-fit stages, three-state development, explained groups |
| `mlbDiscussionDevelopmentGates` | **Modified**: `mlbDiscussionAssessments` in `org.ts` returns the judgment and missing evidence |
| Read-only affiliate scenario | **Modified**: `RosterHealthScenario` on `minorLeagueRoster.ts` + `farmConsequence` in `mlbEvidence.ts` |
| Transaction path with requirements | **Modified**: composes `ActionRights` from Player Rights |
| Solution synthesis (axes, tiers) | **Replaced** by per-stage verdicts and a philosophy annotation |
| Role suitability | **Replaced** by Player Development's destination fit at the MLB level |
| Need detection from snapshot differences | **Replaced** |
| `rosterTransactionState`, `isOnFortyMan`, `majorLeagueRosterContext` | **Removed** |
| `minorLeagueCascadePlanner`, `minorLeagueConsequences` | **Deferred** (report the farm deficit; do not solve the cascade) |
| UI | **Modified**: problem-centred, adds what-if and clearing views, drops tiers |
| Tests | **Replaced** |

Not brought over: the old `docs/` decisions (D-024 onwards on that branch), the
`captureRosterStateSnapshot` call in `runImport` (already on main in adapted form), the
`rosterops.ts`/`valuation.ts` edits.

## 8. Owner decisions needed

See §13.

## 9. Real-save validation

Run against the imported Arizona save (through 2026-05-15) and, for a copy with a live log,
`RIGHTS-EXP.lg` imported into an isolated data directory (nothing written to either save).

Observed and acted on:

- **Old detector: zero needs. New: one.** The only observed need on the healthy 26/26 club is
  Cristian Mena's return from the 10-day IL in 8 days to a full active roster. The response
  lists all 26 active players with Player Rights on optioning each: 11 optionable,
  14 who may refuse (5+ years of service), Pavin Smith out of options, IL activation `indeterminate` (D-023).
- **Hitters were offered for a pitching role** and unknown fielding grades were listed as
  "cannot be established". Fixed: a role change stays inside the pitcher/hitter family, and
  "nothing visible suggests he can play there" is counted, not listed.
- **The five starters were offered for a relief spot** with no comment. Fixed: they are
  listed, but in "only moves the hole" because his own role falls below the standard.
- **A minor leaguer on a minor-league IL was treated as a cause** of an MLB shortfall. Fixed:
  causes are MLB-club injured-list players or an assumed absence.
- **Sending down a starter while a starter returns** counted as a shortfall. Fixed: the
  returning player of the same role is credited.
- **Every recall of a Reno 40-man player is `indeterminate`** on this save because the live
  log is missing from `temp/`; Player Rights cannot tell an option from a rehab assignment.
  Correct behavior, not a bug. On `RIGHTS-EXP` the export is 11 days behind its log, so every
  path is indeterminate for a different, stated reason.
- **Non-40-man Triple-A players are always `indeterminate`** because Rights does not model
  "add to the 40-man and promote" as one move. Recorded as a Rights follow-up (§13).
- **Player Development's gate is strict for depth players**: only 2 of 23 assessed Triple-A
  players are `defensible` for MLB. See §13.
- **Minor League Operations counts a rehabbing starter (Kelly) in Reno's rotation**, so his
  recall reads "rotation healthy to thin". That is Minor League Operations' rehab gap
  (roadmap item 5), surfaced rather than patched here.
- No hidden/unapproved rating is read (static guard); no transaction is written.

## 10. Boundaries enforced statically

`tests/mlbOperationsBoundary.test.ts`: MLB Operations modules may not read rating columns,
`players_value`, `gloves(`, roster-status/option/40-man/DFA columns, the transaction log or
snapshot history; the pure core (`mlbRoster`, `mlbNeeds`, `mlbResponses`) may not open a
table; no re-deriving option/consent constants; no module upstream of it may import it;
philosophy never orders results.

## 11. AI

Deterministic structured output first; AI may later explain and interrogate the packets
through the same API. No LLM is in the decision path.

## 12. What is implemented in this slice

**Slice: availability-driven active-roster problems with internal responses.**

```text
Player State (+ position/role) ─► mlbRoster (club view) ─► mlbNeeds (need)
                                                             │
        Player Rights (rightsFor)  ─────────────────────────►│
        Player Development (mlbDiscussionAssessments,         ▼
             evaluateDestinationFit, pitcher role)   mlbResponses (candidates,
        Minor League Ops (RosterHealthScenario)        stages, path, consequences,
        Philosophy values (after validity)             philosophy annotation)
                                                             │
                                          mlbOperations (API) ─► MlbOperations.tsx ─► GM
```

Files: `server/mlbRoster.ts`, `mlbNeeds.ts`, `mlbResponses.ts`, `mlbEvidence.ts`,
`mlbOperations.ts`, `pitchingRole.ts`; changes to `playerState.ts` (position, role),
`playerRights.ts` (export `activeLimit`), `org.ts` (`mlbDiscussionAssessments`),
`minorLeagueRoster.ts` (`RosterHealthScenario`, schema-tolerant player columns, exported
`PLAYABLE_RATING`); `src/pages/MlbOperations.tsx`.

API (read-only): `GET /api/mlb-operations/:orgId`,
`GET /api/mlb-operations/:orgId/responses?need=<id>[&role=<kind>]`.

Need kinds: `role_below_standard` (5 SP, 7 RP, 2 C), `open_active_spot`,
`il_return_crunch`, and the GM-posed `what_if`.

Response directions: **fill** (grouped candidates: internal role change, recall of a 40-man
player, add to the 40-man), **clear** (who could be moved when an injured player returns to a
full roster, each with Rights on optioning him), **role_needed** (an open spot names no role).

Tests: 75 new (`mlbNeeds`, `mlbResponses`, `mlbEvidence`, `mlbOperationsRoutes`,
`mlbOperationsBoundary`), on real `evaluatePlayerRights` output.

## 13. Owner decisions needed

1. **Player Development and depth players.** The AAA→MLB gate answers "is this promotion
   developmentally defensible?" for every assessed Triple-A player, including 30-year-old
   depth arms. Result on the real save: 2 of 23 defensible, most "not defensible" for a
   readiness score no injury fill-in was ever meant to meet. Should a non-prospect (no
   development stake) fill-in be judged by a separate, lighter pathway, or does MLB Operations
   keep deferring wholly to the prospect gate? MLB Operations currently shows the gate's
   reasons and does not override it.
2. **Unassessed is not a pass.** A player with too little current-level production has no
   Player Development assessment; MLB Operations lists him as "Open, but Player Development
   has no assessment". Confirm that is the right treatment (the alternative is to treat a
   veteran depth player as needing no assessment).
3. **Pennant's roster standards** (5 SP, 7 RP, 2 C) are assumptions in `mlbNeeds.ts`. Confirm
   or change; they decide what counts as a problem. Bench/positional coverage is not yet a
   need.
4. **Performance-driven needs.** Deferred. A sustained-weakness flag needs a sample and
   context rule you may want to own (for example, plate appearances and a peer baseline before
   Pennant says a hitter is a problem, and a rule that it never triggers a transaction path).
5. **Should Pennant list who could be moved (clearing options)?** It does, unranked, with
   Rights and role effect. Confirm you are comfortable with a list that includes DFA-eligible
   veterans.
6. **Rights follow-ups** the slice depends on: evaluate "add to the 40-man and promote" as one
   action (today every non-40-man path is `indeterminate`), and the IL-activation rules
   (returning players are `indeterminate`).
7. **Minor League Operations and rehab**: a rehabbing player counts in the affiliate's
   roster health, which distorts the consequence of recalling him.

## 14. Checkpoint log

- **Checkpoint 1 — audit complete.** Read all project docs, the old branch's ten commits and
  every file, current State/Rights/Development/Minor League code and the real save.
- **Checkpoint 2 — slice built and validated.** Foundations extended, needs and responses built
  on them, API and workspace added, 70 tests, static boundary guard, real-save walkthrough
  (findings in §9). Next: the owner decisions above; then performance review flags, bench and
  positional coverage needs, Rights promotion-as-a-unit, and a Minor League Operations
  cascade consumer.
