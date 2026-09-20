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
| `role_below_standard` | Healthy active players in a role fall below a minimum coverage floor (5 SP, 7 RP, 2 C; floors, not targets: §16) | Player State + counts | ✔ |
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
- Floors are data, shown to the GM with each need, and marked as Pennant's first-pass assumption (§16).
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
3. **Development** — Player Development's assessment of the *contemplated kind of MLB
   assignment* (§15). `unassessed` and `indeterminate` are *not* passes and not rejections:
   they are "Evaluation incomplete", visible but never actionable.
4. **Rights** — every required action from `rightsFor`.
5. **Role fit** — `evaluateDestinationFit(player, mlbTeam)` (classification `poor|borderline|
   viable|strong|indeterminate`) and the adapter's evidence completeness.
6. **Philosophy** — only among candidates that pass stages 2–4 as `defensible`/`eligible`.

Group labels a GM sees: *Open*, *Viable but requires a roster-clearing move*, *Poor MLB fit*,
*Only moves the hole*, *Evaluation incomplete*, *Transaction cannot be established*, *Blocked by
Development*, *Blocked by rights*, *Unavailable*.

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

Need kinds: `role_below_standard` (below the coverage floors, §16), `open_active_spot`,
`il_return_crunch`, and the GM-posed `what_if`.

Response directions: **fill** (grouped candidates: internal role change, recall of a 40-man
player, add to the 40-man), **clear** (who could be moved when an injured player returns to a
full roster, each with Rights on optioning him), **role_needed** (an open spot names no role).

Tests: 75 new (`mlbNeeds`, `mlbResponses`, `mlbEvidence`, `mlbOperationsRoutes`,
`mlbOperationsBoundary`), on real `evaluatePlayerRights` output.

## 13. Owner decisions (round 1 resolved) and what remains

Resolved and implemented (`feature/mlb-operations-v2`, second pass):

1. **Development is contextual, owned by Player Development.** See §15.
2. **Unassessed is not actionable.** Group "Evaluation incomplete: Player Development cannot
   establish defensibility"; visible, never open, never given a philosophy stance.
3. **Coverage numbers are floors** (§16).
4. **Performance-driven needs remain deferred.**
5. **Clearing options are grouped by transaction class** (§17).
6. **No monolithic add-and-promote right**: two component actions from Player Rights (§18).
7. **IL activation**: studied; stays `indeterminate`, sharpened; the experiment is written up
   in RIGHTS_RESEARCH §4.9.
8. **Rehab distortion fixed in Minor League Operations** (§19).

Resolved in the third pass (§22-§26):

- **Unknown duration stays unknown** (§22): the durable-role default is gone.
- **The relief and experience constants are provisional calibration parameters** (§15, §23).
- **40-man clearing** exists, separate from active-roster clearing (§24).
- **Injured-list returns are a complete, visible path** (§25).

Still open for you:

- **The IL-activation experiment** (RIGHTS_RESEARCH §4.11) has to be run by you in the copied
  save; Pennant cannot operate OOTP. Until then activation is `indeterminate`.
- **Whether the 60-day list may be used** to clear a 40-man spot: how long an injury must be
  is unmeasured (RIGHTS_RESEARCH §4.11).

## 14. Checkpoint log

- **Checkpoint 1 — audit complete.** Read all project docs, the old branch's ten commits and
  every file, current State/Rights/Development/Minor League code and the real save.
- **Checkpoint 2 — slice built and validated.** Needs, responses, API, workspace, boundary guard,
  real-save walkthrough (§9).
- **Checkpoint 3 — owner decisions implemented.** Contextual Player Development assessment,
  evaluation-incomplete group, coverage floors, clearing classes, composed promotion path, IL
  activation study, rehab fix, real-save re-validation (§20).
- **Checkpoint 4 — unknown duration, 40-man clearing, IL returns.** Context-dependent
  developmental defensibility (§22), provisional calibration made explicit (§23), the two
  clearing constraints and the visible chain (§24), IL returns as a complete path and the
  activation experiment sheet (§25), real-save and copied-save validation (§26).

## 15. Contextual Player Development assessment

The old AAA-to-MLB gate asks "is he ready for a durable major-league role?" and called a
30-year-old depth arm "not defensible" for a spot start for the reason it rejects a prospect
for the rotation. Player Development now also answers "is THIS kind of assignment
defensible?" (`server/mlbAssignmentContext.ts`, `org.ts` `mlbAssignmentAssessments`).

- **Contexts:** `durable_role` (the existing gate, unchanged), `temporary_depth`,
  `bench_role` (hitters), `short_bullpen` and `spot_start` (pitchers). MLB Operations only
  *describes* the contemplated context (short rotation absence: spot start; short bullpen:
  short bullpen; extended: temporary depth; long: durable; **unknown duration: not assumed at
  all** — see §22). The GM can choose another.
- **Not a bypass, not prospect-versus-veteran.** For a temporary context the durable
  readiness bar is *relieved* by an amount set by the context's exposure and shrunk by the
  developmental **stakes**: the player's protection tier from visible current/potential
  ratings and age (`developmentFit.ts`). A core prospect gets no relief in any context; an
  organizational-depth player gets all of it; tiers in between get a continuous share.
- **Two evidence routes.** *Production*: current-level readiness clears the relieved bar with
  enough sample. *Established*: Triple-A and MLB career volume (a full Triple-A season for a
  role-carrying context, about half for a short assignment) **and** low stakes. A high-stakes
  player is never established by experience alone.
- **Three states, unknown stays unknown (D-018).** Unknown ratings, no career statistics, or
  no production evidence with limited experience: `indeterminate`, with the missing evidence
  named. A known negative on both routes: `indefensible`. Philosophy is not an input (the
  module is in the static philosophy guard).
- **Only Triple-A** players are assessed, as for the durable gate.
- **Architecture rule versus calibration parameter.** The rules above are architecture. The
  numbers (relief 12-16 readiness points; established 60-400 PA/IP by context; stakes weights
  0 to 1; the low-stakes cut-off; the production sample minimum) are **provisional calibration
  parameters**, not baseball facts. They live once, at the top of `mlbAssignmentContext.ts`,
  each marked `PROVISIONAL CALIBRATION`; every contextual assessment carries
  `calibration: { status: 'provisional' }`; a test fails if any of them is declared or repeated
  in another server module. See §23 for the real-save review.

## 16. Role-coverage floors

5 starters, 7 relievers and 2 catchers are **minimum coverage floors**, not ideal roster
targets and not a statement of how to build a roster. Pennant raises a need only when healthy
active players in a role fall *below* the floor. They are data (`CoverageFloors` in
`mlbNeeds.ts`, `DEFAULT_COVERAGE_FLOORS`), handed to the detector and to the response
builder, so a six-man rotation, a different pitching staff or a usage-specific requirement is a
different value, not a change to the logic. The API reports them as
`coverage: { basis: 'minimum_floor', source, floors }`. No doctrine is built on them: a club
above the floors has no coverage need however lean it is by other measures.

## 17. Clearing an active spot, by transaction class

Each active player appears once, under the one transaction that applies to him, in a class
that says what it costs and risks (never a global ranking; ordering is role then name):

- **Routine and reversible**: an ordinary option; stays on the 40-man; recallable.
- **Costs something lasting**: an option that uses his final option year.
- **Disruptive**: he cannot be optioned (may refuse at five-plus years, or out of options), so
  the only move is designation: leaves the 40-man and the active roster, waiver claim risk,
  irrevocable waivers when out of options, right to refuse a minor-league assignment.
- **Not established**: Rights cannot say (stale export, injured, rehab).

A designation is not offered to a player who can be optioned. Each row carries Player
Rights' status with its reasons, the role effect against the floor (crediting a returning
player of the same role), and, for an option, Minor League Operations' view of the affiliate.

## 18. Non-40-man promotion path

`Add to the 40-man → place on the active roster`: two component actions, each evaluated by
Player Rights (`actions.addToFortyMan` and `composed.promoteToActive`, RIGHTS_RESEARCH §4.10)
with its own status and requirement. MLB Operations composes them and never merges them. A
candidate who is otherwise viable but needs a 40-man or active spot sits in the group
"Viable, but requires a roster-clearing move first" with the missing spot named.

## 19. Rehab assignees and farm health

Investigation: a rehab assignee (Merrill Kelly at Reno) is exported identically to an optioned
40-man player and sits in the affiliate's active list (`team_roster` list 2). Every Minor
League Operations reader (`minorLeagueRoster`, `minorLeagueMoves` hitters,
`pitcherRosterSimulation`, retention) counted him as an ordinary member: he propped up the
rotation on paper, was offered as depth, and was judged for retention.

Fix, in the owning subsystem via shared state handling (`server/rehabAssignments.ts`, reading
the assignment context): a player an explicit, current log shows on rehab is excluded from
ordinary affiliate roster health, pitching staff, hitter coverage and retention; one nothing
explains (no log) is **counted and named** (`rosterTreatment.ambiguous`) because unknown stays
unknown, and MLB Operations' consequence says "if he is on rehab this overstates the cost".
Regression: `tests/rehabAffiliateHealth.test.ts`.

## 20. Real-save re-validation (second pass)

- Spot-start what-if for Zac Gallen (six days): assessed as a spot start; Yu-min Lin cleared
  a first draft of the established route on 60 innings, which was too easy (about 150 across
  three seasons at age 22); minimums were raised and he is now "not defensible". Kelly
  (1,218 career upper-level innings, low stakes) is defensible and shown as "transaction not
  established" because the log is absent. Cabrera lands in "Evaluation incomplete".
- Mena's return: 7 routine options, 4 that use a final option year (Moreno, a catcher, would
  also leave catcher below its floor), 15 disruptive designations for players who cannot be
  optioned; IL activation `indeterminate` with the exact unknowns and "active roster is full".
- Reno on the real save: three 40-man players (Kelly, Del Castillo, Locklear) are ambiguous,
  counted and named. On the `RIGHTS-EXP` copy the export is behind its log, so Kelly (already
  promoted in the log) is correctly unattributed rather than rehab; the positive rehab path is
  covered by the synthetic regression tests.
- No hidden ratings, no bogus 40-man math (30/40, 26/26 as exported), no duplicate
  alternatives; unassessed and incomplete candidates never appear as open.

## 21. Remaining limitations of the slice

Only injury/availability-driven active-roster problems; no performance-driven, bench or
positional coverage needs beyond the three floors; internal candidates only; no cascade
planner (clearing one spot never proposes the consequences of the moves it names); IL
activation unresolved until the experiment is run (§25); the 60-day list is offered as a way to
clear a 40-man spot only when Rights establishes it, which it cannot yet; Minor League
Operations' positive rehab exclusion needs a current log; contextual constants are provisional
(§23); the durable AAA-to-MLB gate treats a thin production sample as "not defensible", which
the duration result inherits (§22).

## 22. Unknown duration stays unknown

The second pass assessed an unknown duration as a durable role. That turned missing information
into a pessimistic assumption and could change the candidate set. It no longer does.

- **Known duration.** Exactly one context is asked of Player Development (spot start / short
  bullpen / temporary depth / durable role), as before; a GM override still wins.
- **Unknown duration.** Player Development is asked about **temporary depth and a durable
  assignment**, and `resolveAcrossDurations` (Player Development's module) combines the two:

  | temporary depth | durable assignment | result |
  |---|---|---|
  | defensible | defensible | **defensible**: duration does not matter, so none is asked for |
  | indefensible | indefensible | **indefensible**: duration does not matter |
  | defensible | indefensible or not established | **`context_dependent`**: the duration decides |
  | not established | indefensible / not established | `indeterminate`: missing evidence, not a duration question |

  A defensible shorter assignment never makes the longer one defensible. `context_dependent` is
  a first-class result beside the D-018 three states, not a fourth judgment about a player; each
  context keeps its own three-state verdict.
- **In the product.** A context-dependent candidate sits in "Depends on how long he would be
  needed" (never "Open"), the explanation is stated ("Defensible as temporary depth, but not
  defensible as a durable MLB assignment. Expected absence duration is not known."), each
  context's verdict and blockers are shown, and what would settle it is stated (choose the
  assignment or wait for a return date). The GM is never made to answer a duration question
  whose answer would not change the judgment. The assignment banner offers "Duration unknown:
  judge both" alongside each specific context.
- **Only bounded contexts are compared.** The narrower contexts (spot start, short bullpen,
  bench) are reached by a known short duration or a GM choice; unknown duration compares
  temporary depth against a durable assignment, the two the owner named.
- **Inherited limitation.** The durable gate (`prospectAssignments.ts`) classifies "current-level
  evidence confidence below the minimum" as not satisfied, so a thin sample can read as "not
  defensible as a durable assignment". The blocker text is shown beside the verdict; the group
  is the same as it would be for an unestablished durable assignment.

## 23. Calibration review (real Arizona save, 34 Triple-A players)

Read-only: `mlbAssignmentAssessments` for every context over every Triple-A player of the
organization, on a copy of the imported database. **No constant was changed**: no output was
clearly unreasonable. The debatable ones are recorded as future calibration work.

| Kind | Example | Outcome | Reading |
|---|---|---|---|
| AAAA / veteran depth | Aramis Garcia (33 C, depth tier, 1,679 PA) | bench and temporary depth defensible (established); durable not assessed | expected |
| Older Triple-A starter | Merrill Kelly (37, 1,218 IP), Tommy Henry (28, 478 IP) | spot start and temporary depth defensible; durable not assessed | expected |
| Strong prospect | Druw Jones (22, development-priority, 12 PA), Ryan Waldschmidt (23, readiness 30 vs bar 73) | indefensible or indeterminate in every context | expected; no core-tier player is at Triple-A |
| Producing priority prospect | LuJames Groover (24, development-priority, readiness 73 vs temporary bar 72) | temporary and bench defensible on production; durable indefensible (73 vs 79) | consistent with half relief; marginal by one point |
| Younger fringe | A.J. Vukovich (24 H, readiness 96) | defensible in every context including durable | expected |
| Relief depth | Derek Law (35, 512 IP); Dylan Ray (25, 108 IP, thin sample) | Law defensible in every temporary context; Ray short bullpen only, temporary depth indeterminate | expected |
| Bench depth | Luis Urias (28, 3,673 PA), Adrian Del Castillo (26, 1,000 PA) | bench and temporary depth defensible; durable indefensible (thin-sample blocker for Del Castillo) | expected; see §22 |

Debatable, recorded, not tuned:

- The `normal` protection tier sits at the low-stakes cut-off, so a 22-year-old `normal`
  pitcher with a full Triple-A season of innings (Yu-min Lin, 150 IP) is "established" for a
  short bullpen assignment. Defensible for a short assignment; a stricter cut-off is a
  calibration question.
- The experience minimums are hard cliffs: Lin has 149.7 IP against 150 for a spot start
  (indefensible) but 150 against 60 for short bullpen (defensible); Kristian Robinson clears
  the bench minimum by a single plate appearance (251 against 250).
- The core-prospect rule (no relief) could not be exercised on real data: no core-tier player is
  at Triple-A.

## 24. Two roster constraints: clearing the active spot and the 40-man spot

They are different problems with different solutions and are never one list.

- **Active-roster spot.** An option (routine; or higher-cost when it uses his final option year)
  or, for a player who cannot be optioned, a designation. An option keeps the player on the
  40-man: **it never opens a 40-man spot**, even when it uses a final option year.
- **40-man spot.** Only two transactions take a player off the 40-man: the **60-day injured
  list** (`placeOnSixtyDayIl`, a Player Rights action) and a **designation**. Designating a
  player on the active roster also opens an active spot; a minor-league 40-man player opens
  only the 40-man spot and carries his farm consequence. Classes: routine (60-day list, only if
  Rights establishes it), disruptive (designation), not established. The 60-day list is
  **indeterminate** today: one observed refusal at 7 days is not a rule (RIGHTS_RESEARCH §4.11),
  so injured 40-man players are listed as "not established", never hidden and never valid.
- **Each option** carries its transaction, Rights status and basis, which spots it opens, the
  role effect against the floor, the farm consequence, contract facts, and its costs. Each
  player appears once per constraint. Nothing is ranked.
- **Feasibility.** A constraint is `available` (Rights establishes at least one way),
  `unresolved_only` (every way is not established: the candidate is moved to "cannot be
  established"), or `none` (no player can be moved: blocked, with why).
- **The chain.** A candidate's path is shown as ordered links: clear a 40-man spot → add to the
  40-man (Rights) → clear an active spot → place on the active roster (Rights). A recall needs
  only the active link. The whole path is only as certain as its least certain link. No
  combined right exists; MLB Operations composes Rights' components.

## 25. Injured-list returns as a complete path

A return decision now exists when a spot he needs is missing: the active roster is full, or he
is on the 60-day list (off the 40-man) and the 40-man is full, even with active room. The
workspace shows the activation (Rights: `indeterminate`, with the list, days left, whether he
has healed, and whether each roster has a spot), the chain, and each constraint's clearing
options separately. A prerequisite clearing move is a requirement on the activation, never a
rejection of it.

**What is established and what is not.** The active limit is never exceeded and every active
player is on the 40-man (30 of 30 clubs), so a spot on each roster is a prerequisite in effect;
how OOTP enforces it (refusal or a forced move), whether an injured player can be activated
early, and whether a 60-day return restores the 40-man slot on activation are **not
observed**. `activateFromInjuredList` therefore stays `indeterminate`, now with structured
facts (`needsActiveSpot`, `needsFortyManSpot`, `activeClearingNeeded`, `fortyManClearingNeeded`).
The controlled experiment is RIGHTS_RESEARCH §4.11; Pennant cannot operate OOTP, so it has to
be run by the GM in the copied save. The `rights:candidates` command names the players who fit
each case.

## 26. Real-save and copied-save validation (third pass)

Real save (read-only, through the running app): Mena's return (10-day list, active roster full)
shows the activation as not established, the chain [clear an active spot → activate], and the
active constraint with 7 routine, 4 final-option-year and 15 disruptive options; the 40-man
(30 of 40) is correctly not a constraint. Unknown-duration what-ifs (catcher, reliever) produce
context-dependent candidates (Adrian Del Castillo, Aramis Garcia, Kohl Drake, Derek Law) with
the explanation and per-context verdicts, and candidates defensible in both contexts (Shawn
Dubin) stay defensible. The real save has a 40-man of 30 of 40, so a full 40-man cannot occur
there.

Copied save (`RIGHTS-EXP.lg` export, dated 2026-05-25, 40-man 29 of a lowered 28, active 25 of
26; imported into a scratch directory, ports composed by hand with an unverified export and no
log): Blake Walston (60-day list) is a return decision because the **40-man** is full while the
active roster has room; the chain is [clear a 40-man spot → activate], the active constraint is
"a spot is open", and the 40-man list offers 28 designations (disruptive) and Jordan Lawlar for
the 60-day list (not established). A what-if there shows non-40-man candidates with the chain
[clear a 40-man spot → add → place]. Checked for: no impossible paths, no designation shown as
routine, no 40-man option that is an option, no duplicate alternatives, no unresolved right
treated as valid, and every context-dependent case worded as dependent, not definitive.

## 27. The staff report (briefing layout)

The first three passes produced correct but generic output: a list of options with no view of
whether the player is any good for the role. The workspace now reads like a briefing
(`server/mlbReport.ts`, `server/roleStanding.ts`):

1. **Headline and situation.** What the decision is, as sourced facts (the return date, the roster
   counts, the role against its floor, what is and is not established about the activation, who
   is due back inside the horizon).
2. **The role picture.** The current holders of the role beside the player under discussion, on
   one lens stated as such: Player Development's destination fit, the organization-visible tool
   ratings against MLB peers (a composite percentile), with each player's weakest core tool and
   this season's line for context. Not a value, a projection or a decision.
3. **The staff read.** Whether he improves the group (`strengthens`: clearly ahead of the weakest
   current holder; `comparable`; `behind`; `cannot_judge`), who he would displace, and caveats:
   an incumbent without a visible rating is named and never assumed weak; his own season line is
   flagged when too thin to weigh; where he would displace someone, whether that player's results
   agree or disagree with the ratings. Results never change the verdict.
4. **Pathways.** Named ways to act, each a chain of Rights-owned transactions plus the clearing
   they need, the moves involved with their class and costs, what follows for role coverage and
   the farm, and how certain the path is. For a return: put him in the group in place of the
   weakest holder (only when he clearly improves it) and keep the group as it is and clear the
   spot from a role that keeps its floor. For a hole to fill: one pathway per candidate that
   Player Development and Rights do not block, ordered by how ready the path is, then where he
   stands. When the role is short, a candidate who would be the weakest still gets a pathway (a
   body is needed) and the read says what kind of player he would be. The order is readiness, not a
   ranking of players; the GM decides.

Below it, unchanged in substance: every candidate with the evidence behind each verdict, and the
full clearing options, now as wrapping cards (the earlier seven-column table overflowed).

Calibration: `MEANINGFUL_GAP` (8 percentile points) and `RESULTS_SAMPLE_MINIMUM` (20 IP, 80 PA)
are provisional parameters in `roleStanding.ts`, stamped on every result, kept out of the MLB
modules by the boundary test (D-030).

Real save, Mena's return: on visible ratings he is 29th percentile against a rotation of 55, 53,
49, 45 and 35 (Soroka last), so the read is "comparable to the back of the group, not a clear
upgrade"; his 6.7 innings are flagged as too few to weigh; the only pathway is to clear the spot
from a role that keeps its floor (relievers at 7 of 7, three hitters with no coverage standard
yet). Not built: a proactive scan that says "this starter is weak, consider replacing him" with no
injury or hole to prompt it; that is the performance-driven need (§21), and is the next step.

## 28. The scouting department: proactive review, cascades, hitters (fourth pass)

Built after §27 and written up in [ROSTER_REVIEW.md](ROSTER_REVIEW.md) (design, data, stages) with D-031 to
D-034. In short:

- **Unprompted review.** The pitching staff and the lineup are read on two lenses (tools; results) and a
  working estimate. A strong or moderate case is a `role_holder_review` need ("Michael Soroka: the weakest
  starting pitcher on the club; tools and results both point to a weak spot"); watch items are shown but
  are not needs. Never a trigger.
- **Replacement.** Each candidate is compared with the holder lens by lens (clear upgrade / uncertain /
  marginal / sidegrade / downgrade, with certainty). The lead replacement is the most ready real upgrade;
  upgrades that are held up are named with what holds them up.
- **Cascades.** Each way of making room (send down, move a starter to the bullpen, designate, a lineup
  change) is a chain of moves followed through to the other groups and the counts, with the natural
  follow-up move chosen and the Player Rights status of every link.
- **Hitters.** Regulars from usage; bat and glove by position weight; platoon read; bench players as
  lineup decisions.
- **Recommendation.** ACT / EXPLORE / MONITOR / HOLD from a stated rubric, with what to settle and what
  would change it.
- **Real save.** Soroka and Ross (strong); Rodriguez a watch item (results lag tools); Tawa the weakest
  regular; Merrill Kelly a clear upgrade over Soroka held up by Player Development and Rights; Alek Thomas
  a clear upgrade over Tawa as a lineup change.

## 29. The scouting department, tuned and philosophy-aware (fifth pass)

The owner approved rating splits and running as evidence (D-035), asked that the constants be tuned and expanded (D-037), that
philosophy and the competitive window be pivotal to the recommendation (D-036), and that the four remaining items be built (D-038).
Design and build log: [ROSTER_REVIEW.md](ROSTER_REVIEW.md) stage 6; the evidence for every tuned number: [CALIBRATION.md](CALIBRATION.md).

- **Evidence.** `scoutedEvidence.loadScoutedHitterProfiles` reads a hitter's tools, his tools against each hand and his running
  ratings; `toolsModel.ts` turns them into expected wOBA (contact, power and eye carry the bat) and running expectations. Park
  adjustment uses the app's existing park factor; baserunning and defensive results are read from statistics.
- **A hitter is bat + glove + running.** Each dimension has its tools view and its results view, blended by sample, and is shown with
  its weight in the lineup table. The position glove weights are provisional (one partial season of zone ratings).
- **Platoon** is ratings-led: the league norm for his hand, adjusted by his ratings' departure from it, with his own split pulled
  toward that. A regular with a real problem raises a `platoon_complement` need (direction `complement`); the partner on the bench
  is a lineup decision (plan `platoon`), one from the minors is a plan with Player Rights' moves.
- **Position shifts** (plan `shift`): a regular moves to the weak spot and the spot he leaves is covered from the bench or by a swap;
  proposed when the two spots gain together; no transaction; the comfort cost is stated.
- **Bullpen roles and the bench.** Roles come from usage (leverage cut-offs on the league's distribution) and set the stakes of a weak
  arm; a better arm in lower leverage than a worse one is a deployment finding for the manager. The bench is reviewed for role, what
  each man can play and hand; a required position with no cover is a `bench_coverage` need, filled by ordinary discovery.
- **Philosophy and the season** (`staffPreference.ts`): the window and the club's chance of the postseason raise or lower a flag's
  urgency (never remove one), set the bar for "recommend", choose among equivalent ready replacements and order plans, all after
  validity; every lean is a named reason, and the recommendation says what a club with no philosophy would have heard. The facts, the
  rights and the development findings are identical for every club (`tests/staffShading.test.ts`).

