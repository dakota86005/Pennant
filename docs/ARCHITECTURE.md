# Architecture

This document describes the architecture present in the repository and the
boundaries new work must preserve. See [PROJECT_STATE.md](PROJECT_STATE.md) for
a point-in-time implementation inventory and [ROADMAP.md](ROADMAP.md) for work
that does not exist yet.

## Product model

Pennant is a local companion for an Out of the Park Baseball save. Its
primary product goal is to make the user feel like they are actually running a
baseball organization as the GM. The application should surface the work,
tradeoffs, uncertainty, and competing voices of a front office; it should not
collapse that experience into a generic chatbot that announces an answer.

The decision boundary is:

```text
objective save facts + observed scouting evidence
                    |
                    v
        Player Development constraints
       (which assignments are defensible?)
                    |
                    v
   Organizational Philosophy preferences
      (among the defensible, which?)
                    |
        +-----------+-----------+
        v                       v
  MLB Operations        Minor League Operations
  (major-league          (affiliate roster, role,
   roster problems)       playing time, cascades)
        +-----------+-----------+
                    |
                    v
       explained options and recommendations
                    |
                    v
             user/GM decides
```

Organizational Philosophy never changes whether a move is defensible: Player
Development's judgment is the same for every organization, and philosophy only
says which of the defensible moves is preferred (D-019). Roster pressure never
manufactures a development case. AI can explain, compare, and
surface these results, but it must not replace the domain models or the GM.

## Runtime topology

```text
OOTP CSV export
      |
      v
schema-tolerant importer ---> data/league.db (replaceable imported snapshot)
      |                                  |
      |                                  v
      +--------------------------> Express API (`server/`)
                                           |
                         +-----------------+-----------------+
                         |                                   |
                         v                                   v
                 React/Vite UI (`src/`)          AI tool calls to the same API
                         |
              +----------+----------+
              |                     |
              v                     v
       browser development    Electron shell (`electron/`)

imports ---> data/history.db (persistent scouting snapshots, notes/watchlist,
                              observed roster-state snapshots)

<save>.lg/temp/text_data.sqlite3 (+ -wal)      OOTP's live transaction log
      |  found from the CSV export's path; never opened in place
      v
private read-only copy ---> parsed events ---> Express API
```

The desktop application embeds the Express server on a local port and loads the
same built React application that a browser uses. Electron is a shell, not a
second application implementation.

## Data and persistence

### Imported league database

`server/importer.ts` reads every CSV in the selected OOTP export and creates one
SQLite table per file, using the exported header as the schema. It detects CSV
delimiter and encoding, yields between write chunks, and builds discovered
indexes. `server/db.ts` supplies table/column discovery helpers because OOTP
export shapes vary.

`league.db` is a replaceable view of the latest export, not a checked-in source
asset. Domain queries should tolerate absent tables and renamed/absent columns
where practical instead of assuming one developer's save shape.

### Persistent local state

`server/history.ts` keeps scouting-rating snapshots and user-owned state in a
separate `history.db`, so a re-import cannot erase development history. Settings,
credentials, chat history, AI caches, import metadata, and the selected save
also live under `DATA_DIR`.

From source, `DATA_DIR` defaults to `./data`. In the packaged desktop app,
`electron/main.ts` sets it to Electron's OS user-data directory before loading
server modules. These files are private runtime state and must not be committed.

Credentials come from provider environment variables or local credential
storage. Electron uses OS-backed `safeStorage` when available; source mode can
fall back to a permission-restricted local file. Secrets must never enter logs,
fixtures, static exports, screenshots, or documentation.

### Static export

`server/exporter.ts` produces a read-only website snapshot. Features that need
the server or writable state are omitted. A static export is a publishing
artifact, not an alternative application backend.

## Subsystem responsibilities

| Subsystem | Current responsibility | Boundary |
|---|---|---|
| Import and save discovery | `server/paths.ts`, `importer.ts`, `watcher.ts`, and `api.ts` find OOTP 27 saves, import CSVs, report progress, and refresh on new exports. | Do not parse or mutate binary OOTP saves. The live `temp/` transaction database is read only through a copy (D-021). |
| Roster evidence | `playerState.ts` + `leagueRules.ts` (current state), `transactionLog.ts` + `liveLogSnapshot.ts` + `ootpSave.ts` (chronology and save discovery), `assignmentContext.ts` + `playerContext.ts` (reading one against the other), `dataFreshness.ts` + `dataStatus.ts` (how current each is), `rosterStateHistory.ts` (observed fallback and cross-check). | Three concerns, kept apart: Current State, Transaction Chronology, Rights/Eligibility. Sources are read in the order in D-020; nothing opens an OOTP file for writing. |
| Player Rights | `playerRights.ts` evaluates option, recall, add to 40-man, DFA, outright and IL activation as `eligible` / `ineligible` / `indeterminate` with a basis per reason (D-023), and contract-control eligibility (pre-arbitration, arbitration, free agency) season by season from service time (`evaluateContractControl`, D-052 owner Q-1); `playerContext.ts` (`rightsFor`) assembles its inputs. `leagueRules.ts` is the one `LeagueRules`. | Pure: no table or log access. Consumers (roster crunch, player card, Player Value) read its output and never rebuild it from raw columns. |
| Player Value | `playerValue.ts` (the one entry point and reader), `playerValueContract.ts` (concern 1: contract facts, season by season), `playerValueControl.ts` (concern 2: the control timeline and each status's cost band), `playerValueProduction.ts` (concern 3: expected production in wins, an 80% and a 50% band per season, from major-league results, regressed toward what a player's ratings imply when they are given), `playerValueProductionFit.ts` (the method that fits the production model on the save's own history and backtests it; playing time conditional on quality), `playerValueRatings.ts` (phase 3b, pure: the ratings → rate mapping applied, development toward potential, the blend with results, and a prospect's band from his ratings and his arrival), `playerValueRatingsFit.ts` (phase 3b, pure: fits the ratings model per save: the same-time mapping, arrival rates from minor-league usage, and the development path from the save's rating snapshots once enough exist), `playerValueHistory.ts` (the reader of major-league lines, minor-league usage without WAR, ages, standings and the season's calendar), `playerValueFinances.ts` (concern 4: Club Finances, the opening price of a win, the replacement level), `playerValueSnapshot.ts` (the per-import market snapshot in `history.db`), `playerValueFitStore.ts` (the per-save production fits in `history.db`, D-053), `playerValueCone.ts` (pure: the player card's production cone, production joined with control season by season), `playerValueRoutes.ts` (`/api/player-value/...`), `playerValueCalibration.ts` (policy and the provisional fallback priors, stamped). Phases 1–3 of D-052 ([PLAYER_VALUE.md](PLAYER_VALUE.md) Part 9); surplus and the lens are later phases. Contracts, Payroll (control column, finance header, price of a win), the Trade Center's control, the player card and Free Agents' "hitting the market" read it; `/api/club-finances/:orgId` (`clubFinanceRoutes.ts`) serves Club Finances and the market history; `/api/player-value/:playerId`, `?ids=` and `/api/player-value/production-fit/:orgId` serve a player's value and the production fit in force; `/api/player-value/:playerId/cone` serves the player card's production cone. After an import, and once at server start for an already-imported save, production and then the ratings model are refitted in the background when the export holds a newer completed season (the ratings model also when the save's rating snapshots first become enough for its own development path). | Describes, never authorizes (D-052). Eligibility, including which contracts are market prices, comes from Player Rights; ability only through `scoutedEvidence.ts` (D-017), never a rating column or `players_value`; no minor-league WAR (Q-9); no philosophy, tier, defensibility or prospect decision. Production's fitted numbers are the save's (D-053): fitted from its history, stored per save, adopted only through the gate; the only fitted artefacts in code are the two provisional priors, and the ratings prior measures no arrivals. Injury proneness comes only through `injuryProneness.ts`. Only the two writers write, only to `history.db`, idempotent per key and never able to fail the import; nothing writes `league.db`. A missing rule, service time, financial figure, age or WAR is `indeterminate` or `unknown`. `tests/playerValueBoundary.test.ts` enforces it. |
| Database compatibility | `server/db.ts` discovers available tables and columns; query modules adapt to export differences. | Do not hard-code a single save's schema without a guarded fallback. |
| Domain API | Express routers in `server/*.ts` compute rosters, player dossiers, standings, schedules, stats, contracts, payroll, trades, development, and other front-office reads. | Domain logic belongs here, not duplicated in React or AI prompts. |
| Scouted evidence | `scoutedEvidence.ts` is the only reader of ability ratings for development and operations judgments. It returns branded `ScoutedAbility` evidence with provenance, viewer, scale, and what is missing. | Nothing in Player Development or Minor League Operations may read a rating column or `players_value` directly; `tests/evidenceBoundary.test.ts` enforces it. |
| Player Development | `org.ts`, `mlbAssignmentContext.ts` (per-context MLB assignment assessment, D-025), `prospectDecision.ts`, `prospectAssignments.ts`, `destinationFit.ts`, `developmentFit.ts` (developmental stakes: the protection tier, D-050) with `developmentalContext.ts` (the one reader of a player's objective developmental context, and the one way a tier is computed), `currentAssignment.ts` (is the level a player is at still developing him? D-044), and scouting-history functions evaluate evidence, developmental stakes, legal assignments, and destination fit. | This layer determines defensibility; it does not choose transactions for the GM. Age relative to level says how much developmental time is left and never lowers the bar (D-044). The protection tier is stakes, never authorization: `prospectDecision`, `prospectAssignments` and `destinationFit` do not read it. |
| Organizational Philosophy | `philosophy.ts` defines organization-specific dimensions/policies; `settings.ts` persists and resolves profiles; `Philosophy.tsx` edits them. | Philosophy ranks or adjusts choices after hard baseball/development constraints. It is not player evidence. |
| Minor League Operations | `farmCalibration.ts` (every farm constant, declared once and stamped), `farmResults.ts` + `farmUsage.ts` (league-relative park-adjusted production; season usage and the export's game log), `farmRecentUsage.ts` (pure: the recent window, tenure, sample-awareness — D-048), `clubArrival.ts` (shared chronology: when a man joined the club the export has him on), `currentAssignment.ts` (Player Development: is this level still developing him?), `playingTime.ts` (conflicts), `farmAssignments.ts`, `farmAffiliate.ts`, `farmOrganization.ts`, `farmCascade.ts`, `farmRetention.ts`, `farmOperations.ts` (the service: the organization read once per request as a `FarmSession`, the whole view, the operational reading under a scenario), `farmConsequence.ts` (the MLB ↔ farm contract: what follows a departure, what an arrival does), `farmRoutes.ts` (`/api/farm-operations`), `rehabAssignments.ts` (D-026), `minorLeagueRoster.ts` (counts and coverage, and the read-only scenario; it decides nothing). `scoutedDevelopment.ts` (`/api/scouted-development`) serves the Player Development pages' roster with history evidence and is Player Development's, not the farm's. The superseded solvers were deleted in the hardening phase. | Consumer of the same specialists as MLB Operations (D-044 to D-046, [MINOR_LEAGUE_OPERATIONS.md](MINOR_LEAGUE_OPERATIONS.md)): it owns affiliate roster, role, playing-time and cascade problems and decides no scouting, development, rights or philosophy question. Level-changing moves must already be authorized by Player Development. Operational health and developmental health are separate outputs. Outputs are read-only. `tests/farmOperationsBoundary.test.ts` enforces it. |
| MLB Operations | `mlbRoster.ts` (club view over Player State), `mlbNeeds.ts` (state-derived needs), `mlbResponses.ts` (staged candidates, transaction path, consequences, philosophy annotation), `mlbEvidence.ts` (adapters to the specialists), `mlbOperations.ts` (service + `/api/mlb-operations`), `MlbOperations.tsx`. | Consumer only (D-024, [MLB_OPERATIONS.md](MLB_OPERATIONS.md)); coverage numbers are floors, not targets: decides no scouting, development, rights, philosophy or farm assignment question. Reads no raw rating, roster-status, option or log source; `tests/mlbOperationsBoundary.test.ts` enforces it. |
| AI features | `providers.ts`, `models.ts`, `chat.ts`, `ai.ts`, and `storylines.ts` provide staff chat, briefings, trade discussion, and storylines through configurable providers. | AI consumes computed save-grounded facts, calls the same API as the UI, and supports the front-office experience. It does not become a parallel recommendation engine. |
| Web UI | React pages in `src/` render domain results, evidence, alternatives, and local interactions. `src/App.tsx` owns selected-save and selected-organization UI context. Charts are SVG drawn with visx (D-054): a pure geometry module per chart and the shared conventions in `src/chartTheme.ts` (theme CSS variables only, `role="img"` summaries, focusable detail). | React may shape presentation but should not silently reimplement baseball rules. A chart draws what the API served and computes nothing about a player. |
| Desktop shell | `electron/main.ts`, `preload.ts`, and `updater.ts` embed the local server, expose a minimal IPC bridge, protect navigation, store secrets, and manage consent-first updates. | Keep Node access out of the renderer and keep IPC narrow. |
| Identity and version | `server/project.ts` (product name, the repository addresses and the release-tag prefix, import-free so the shell can load it first) and `server/appInfo.ts` (the version, read from `package.json` from source or handed over by Electron when packaged); served on `/api/status`, shown in the header. `scripts/devPorts.ts` decides the dev page and API ports for both halves of `npm run dev`. | One source per fact (D-049). The npm `name` is held for compatibility (it names the desktop user-data folder); the Electron `appId` (`com.dakotawise.pennant`), the author and the `pennant-v<version>` tag prefix are pinned by `tests/projectIdentity.test.ts`. |
| Tests and checks | Vitest uses a hand-built temporary league; release CI runs type-checking and tests. Manual stat/theme checks use real imported data. | Fixtures must be synthetic and contain no live-save or private data. |

## Evidence and fog of war

The application has two evidence classes.

### Objective save facts

Statistics, contracts, salary commitments, service time, injuries, roster and
transaction status, age, schedule/results, and recorded transactions may be
treated as known when their required export fields exist. Derived metrics must
remain traceable to those facts and label missing or small-sample evidence.

Injury proneness (`players.prone_overall`, `prone_leg`, `prone_back`,
`prone_arm`) is a known fact too: the owner states that it is shown in game, like
personality (owner, 2026-09-22; basis `owner_attested`, D-053). It is read only
through `server/injuryProneness.ts`, schema-tolerant; a missing column, a blank or
a 0 (the export's unfilled value) is unknown, never "normal". It is not a rating
and never reaches a judgment of ability.

### Subjective player judgments

Ability, ceiling, readiness, role quality, and developmental trajectory must be
based on information available to the organization:

- exported current and potential scouting ratings (including OOTP columns whose
  names contain `talent` but represent the visible scouted potential grade);
- the organization's/scouting director's persisted rating observations;
- development history derived from those observations; and
- objective performance/context used as evidence, not as omniscience.

Do not query or infer hidden OOTP true-talent values. A missing or withheld
grade must remain unknown; do not replace it with a league lookup, another
organization's view, or a confident AI guess. Rating movement means the
organization's observed evaluation changed; it may reflect development,
scouting revision, or both.

### The scouted-evidence adapter

`server/scoutedEvidence.ts` is the single entry point for ability evidence in
Player Development, Minor League Operations and Player Value's expected
production (D-017; phase 3b of D-052). Callers decide *which* players (a roster,
an affiliate, a league population — objective facts) and the adapter decides
what their ratings are. It also reads back the persisted rating snapshots
(`loadScoutedObservations`, history.db `rating_snapshots`) under the same rules,
and serves the revealed glove at a player's listed position in bulk
(`loadScoutedGlovesAtPosition`); Player Value's reader is its only caller in
Player Value, and the pure ratings modules take its types only.

- **Approved:** the exported tool ratings (`*_ratings_overall_*` current,
  `*_ratings_talent_*` potential), stamina and pitch grades, and revealed
  fielding-position grades (`gloves.ts`: a current grade above zero is the only
  visibility signal the export offers).
- **Prohibited:** every continuous `players_value` ability/talent field. They
  are never read for a development or operations judgment and are never a
  fallback.
- **Composite:** current and potential are the unweighted mean of the visible
  tools (hitters: contact, gap, power, eye, avoid-K; pitchers: stuff, movement,
  control). It is a Pennant summary of visible tools, not OOTP's weighted,
  position-aware Overall, and it exists only when *every* tool is known.
- **Missing stays missing:** absent, non-numeric, zero, or negative grades are
  unknown. Consumers receive `null` and a `status` of `complete`, `partial`, or
  `unknown`, plus which tools are missing.
- **Scale:** ratings are normalized to 20-80 equivalents so thresholds hold on
  any OOTP display scale; the native scale is reported. See the limits below.
- **Viewer and provenance:** every result names its provenance
  (`declared_organization_visible`, `not_verifiable_from_export`) and the
  resolved viewer organization (the single `human_team = 1` club, or
  unresolved).
- **Type barrier:** `evaluateProspectDecision` and
  `evaluateDevelopmentProtection` take a `ScoutedAbility`, not numbers.

### Evidence sufficiency

Missing evidence is not imputed (D-018). Rating-dependent constraints are
`satisfied`, `not_satisfied`, or `unknown`; an assessment is `defensible`,
`indefensible`, or `indeterminate`, and an indeterminate one reports the
missing evidence while still showing every objective fact.

```text
ScoutedAbility (current/potential may be null)
   |
   +--> prospectDecision: readiness null + readinessRange; recommendation may be
   |                       'indeterminate'; demotion stays objective
   +--> developmentFit:   protection tier null (there is no score); tier constraints unknown
   +--> destinationFit:   unassessed tools -> gate unknown, no partial composite
   |
   v
prospectAssignments: constraints[] -> judgment; plan.eligible (defensible only)
                     plan.indeterminate (with missingEvidence)
   |
   v
Minor League Operations: plans = defensible only; rejected = indefensible;
                         indeterminate[] = surfaced with roster need, unranked
Retention: 'indeterminate' recommendation after objective guardrails
```

Philosophy cannot resolve an unknown: it never enters Player Development's
judgments at all (see below), so an indeterminate assessment is indeterminate
under every philosophy.

### Rating-field provenance

What the repository can and cannot establish. "Declared" means an
owner-accepted decision (D-002) names the field as the organization's scouted
evidence; the export itself proves nothing about visibility.

| Field(s) | Origin | Status |
|---|---|---|
| `players_batting.batting_ratings_overall_*`, `players_pitching.pitching_ratings_overall_*` (current tool grades) | Exported verbatim by the importer. Upstream describes ratings as "your scouts' opinions"; D-002 declares them the scouted current grade. | **Declared visible; not verifiable.** Approved. |
| `*_ratings_talent_*` (potential tool grades) | As above; the name says "talent" but D-002 treats it as the visible scouted potential. | **Declared visible; not verifiable.** Approved. |
| `pitching_ratings_misc_stamina`, `pitching_ratings_pitches_*` | Exported verbatim. Nothing separates them from the other tool grades. | **Declared with the tools; not verifiable.** Approved. |
| `players_fielding.fielding_rating_pos{n}` (current) | Exported. Checked against one in-game player card (commit `3af3aea`): the game shows a grade only where the export's current grade is above zero. | **Visible where > 0** (one observation). Approved. |
| `players_fielding.fielding_rating_pos{n}_pot` | Exported for every position, including ones the game withholds. The same commit found ceilings in the export that the game does not show. | **Not visible where current is 0.** Used only for revealed positions. Shows the export is not uniformly fogged. |
| `players_fielding.fielding_ratings_*` (range, arm, …) | Exported. | **Declared with the tools; not verifiable.** Approved via `gloves.ts`. |
| `running_ratings_speed` | Exported. Not consumed by any development judgment; stored in scouting snapshots. | **UNKNOWN.** |
| `players_value.oa`, `pot` | OOTP's printed Overall/Potential for every player in the league. The only in-repo check (commit `6ca89c8`) was made on a save a user reported at **100% scouting**, where scouted and true grades coincide, so it cannot separate them. | **UNKNOWN. Prohibited.** |
| `players_value.oa_rating`, `pot_rating` | Exactly `round(oa/5)*5` (commit `6ca89c8`). | **UNKNOWN** (derived from `oa`/`pot`). Prohibited. |
| `players_value.overall_value`, `talent_value`, `offensive_value*`, `pitching_value` | OOTP's continuous club-value figures; upstream notes playing time is baked into `overall_value`. A code comment calls `talent_value` "scouted"; nothing supports that. | **UNKNOWN. Prohibited.** |
| `leagues.avg_rating_*` | League-wide aggregates, shown as context by destination fit. Not a judgment input. | **UNKNOWN** provenance. Context only. |
| `rating_snapshots.cur`, `pot` | Derived by Pennant from the approved tool columns at import (unweighted mean, partial averages allowed, native scale). | **Derived.** Not yet routed through the adapter. |
| Viewer organization | Not encoded anywhere in the import. `teams.human_team` marks the human-managed club; `coaches.scout_*` are staff attributes with no accuracy semantics. | **Not encoded.** The adapter uses `human_team`, or reports unresolved. |
| Scouting accuracy setting | Not exported. | **UNKNOWN.** |

The rating scale is the user's OOTP display setting (20-80, 1-20, 1-10, 2-8, or
1-5). No column carries it, so `ratingScaleMax()` reads the largest grade in
four rating columns and snaps it to a known scale. That varies by save and
user configuration, and is a heuristic; whether fielding-position grades share
the tool ratings' scale is an assumption that cannot be verified.

## Roster evidence: state, chronology, and how current they are

Established by D-020 to D-022. Roster facts come from three sources with three
different jobs, read in a fixed order and never merged into one object.

```text
                 what is true NOW                  what HAPPENED                 how current
  OOTP CSV ----> playerState.ts ------+
  (explicit_export)                   |
                                      +--> assignmentContext.ts --> roster rows,
  live .lg/temp  transactionLog.ts ---+     (state read against      player card,
  log  ---------> (explicit_log)      |      explicit history)       roster crunch
      ^                               |
      | ootpSave.ts finds it          +--> dataFreshness.ts / dataStatus.ts
      | liveLogSnapshot.ts copies it        (save date, CSV date, log date)

  imports ----> rosterStateHistory.ts   observed_snapshot: fallback + cross-check only
```

### Current State (`playerState.ts`)

One `PlayerState` per player, each field a `Sourced<T>`: a value with its
provenance, its source column, and, when absent, the reason. It reads the export
as exported — organization, team, level, `is_active`, `is_on_secondary` (the
40-man), `is_on_dl`/`is_on_dl60`, DFA/waiver flags and countdowns, service
time, option counters, Rule 5 protection, and `players_contract.is_major`. A
missing table, a missing column, a player with no row, and a blank value are
four different unknowns. `standing` and `health` are derived conveniences,
offered only when every field they read was exported.

### Transaction chronology (`transactionLog.ts`)

`team_transactions` holds an HTML sentence per club that saw a move, with a date
(`YYYYMMDD`), a numeric team id, and an OOTP type code whose meaning is not
asserted. It contains every row of `league_transactions`. The parser reads the
observed wordings into structured events (`optioned`, `recalled`,
`purchased_contract`, `designated_for_assignment` with waiver status,
`il_placed`, `il_activated`, `restricted_list_placed`/`_activated`, `released`,
`rule5_return`, `rehab_assigned`, `rehab_received`, `rehab_returned`, and
`minor_league_assignment` for level moves) and keeps the rest as `unsupported`
events with the original text. One move written for several clubs is coalesced
and lists each source row. Only the current and previous season are parsed.

### Assignment context (`assignmentContext.ts`)

Reads current state against explicit history to say why a player is where he is.
Precedence: export DFA/waivers; an open rehab episode the export's current team
agrees with; the latest explicit event checked against the export; and finally
`unattributed` for a 40-man player below MLB that nothing explains — with
`source_unavailable`, `source_stale`, or `no_explicit_event` as the reason. It
evaluates no rights: `ordinaryOption` says what the evidence shows the
assignment is, not what may be done next.

### Save discovery and the safe reader

`ootpSave.ts` derives the `.lg` from the export path (`csv_layout`), then from an
enclosing `.lg` (`ancestor_lg`), then from the configured save name, and only
then from a hand-picked folder. `liveLogSnapshot.ts` is the only code that
touches the live database: copy the database and WAL to a private temp
directory, re-stat the source and reject a moved or short copy, validate, retry,
open the copy read-only, delete it on close. Results are cached against the
source files' size and modification time.

### Freshness (`dataFreshness.ts`, `dataStatus.ts`)

See D-022. `GET /api/data-status` reports the save (found, how, simulated-through
date), the CSV (current date, imported), the log (readable, coverage, counts,
unsupported samples), and the overall level with a headline and an action. The
UI shows a compact chip in the header with a short panel, and a banner only when
the snapshot is behind the save.

OOTP writes game dates unpadded (`2026-5-9`), so as text `2026-5-9` sorts after
`2026-5-10` and lexical ordering is unsafe. Code that compares or orders OOTP
dates normalizes them through `parseGameDate` in `dataFreshness.ts`, the one
shared parser, never by comparing the raw strings.

### `rosterStateHistory.ts`

Records a normalized snapshot after each import and the field-level differences
between consecutive snapshots (`provenance: 'observed_snapshot'`). It attaches
explicit log events found in the interval between two snapshots as evidence
(`events_in_window`), and flags a change the covering log does not mention as
`unexplained`, or reports the log as `log_behind`/`log_unavailable` instead. It
never names a transaction, never overrides the export or the log, and is not
read by `playerState.ts`, `transactionLog.ts`, or `assignmentContext.ts`
(`tests/playerState.test.ts` enforces that statically).

### Player Rights (`playerRights.ts`, `leagueRules.ts`)

```text
PlayerState + LeagueRules + roster counts ---+
AssignmentContext (from the log) ------------+--> evaluatePlayerRights()
freshness (export vs save, log vs save) -----+      |
                                                    v
                    per action: status, reasons[basis], requirements[met|unmet|unknown],
                                missing evidence, facts, limitation
                    + optionYears standing, Rule 5 standing
```

`leagueRules.ts` reads the league's option rule, DFA and waiver periods and
roster limits as exported. It is the one `LeagueRules` (D-052): it also reads
the contract regime (free-agency and arbitration lines, minimum salary,
service-year length `rules_min_service_days`, `financial_coefficient`), every
column guarded, resolved through `parent_league_id` because a minor league
exports zeros for them; a missing value is unknown, never 6 / 3 / 172.

Contract-control eligibility (`evaluateContractControl`, owner Q-1) answers,
for this season and each later one asked for, whether a player is
pre-arbitration, arbitration-eligible (which trip), free to leave, bound by a
reserve clause, or `indeterminate`, each with a basis. Service is read through
Player State and projected as a band: this season's remaining days (from the
season's service clock, `seasonServiceClocks`) on the high edge only, each
later season as a full service year on both. A threshold inside the band makes
that season `indeterminate` and names the season on each side; the year before
the arbitration line is decided by Super Two where the league's regime as read
is MLB's (owner ruling, 2026-09-22; basis `owner_attested`): `superTwoCutoffs`
ranks the class once per request or league pass (`serviceClassMembers` in
`playerState.ts`) into a cutoff range, and a player overlapping it stays
`indeterminate`; `has_received_arbitration` is not read. Player Value composes these
into its timeline and never re-derives them. Freshness is applied per action: a stale export
makes every action indeterminate; the log matters only to recall. The rules,
their basis and their unresolved edges are in
[RIGHTS_RESEARCH.md](RIGHTS_RESEARCH.md); the controlled-experiment capture tool
is `scripts/rights-experiment.ts` (`npm run rights:capture` / `rights:diff`).

### Known limits

- Rights that stay indeterminate: IL activation, Rule 5 exposure, re-optioning
  in the season that used the last option year, a fourth option year, rehab
  returns, claims, refusals, and trades (D-023).
- The live log lags in-session moves until the game is saved, and the original
  save's `temp/` log was absent when it was not the loaded save.
- The meaning of the log's `transaction_type` codes (0/1) is not asserted.
- `last_date_simulated.dat` is decoded from one real save.
- A move made after an export on the same in-game day is not detectable by date.

## Development, philosophy, and operations

### Player Development owns eligibility

The prospect decision model evaluates current-level production, sample
confidence, age/level urgency, observed current-to-potential maturity, and the
actual affiliate ladder against developmental thresholds: a base promotion
readiness of 76 moved only by age relative to level, a skip-level requirement
ten points higher with hard floors, and an objective demotion rule. Assignment
evaluation then identifies normal, skip-level, demotion, or MLB-discussion
destinations. Destination-fit compares observed tools with the actual
destination league and gates exceptional skips.

The output is a set of defensible assignments with reasons and blockers, and a
separate set of indeterminate ones. It is not an instruction to move the player.
None of these modules receives, imports, or mentions Organizational Philosophy.

### Developmental stakes: the protection tier

`developmentFit.ts` answers one question for every consumer — how high are the developmental stakes if the
organization mishandles this player? — and authorizes nothing (D-050,
[DEVELOPMENTAL_STAKES.md](DEVELOPMENTAL_STAKES.md)).

```text
ScoutedAbility (potential, by kind) ──► CEILING   impact · regular · fringe · below the major leagues
                                        the ABSOLUTE anchor: against fixed lines (what the weakest tenth,
                                        the median and the best tenth of major leaguers are), never
                                        against the players around him

age ────────────────────────────────┐
league's ROSTERED age profile ──────┼─► DEVELOPMENT REMAINING   most · some · little · none
potential − current ────────────────┘   the CONTEXT: age sets it; being behind his level's schedule or
                                        a projection already realized may only shorten it

            tier = the ceiling, lowered one step for each step by which that development has run out
```

Context may only lower what the ceiling allows: youth is not talent, being young for a level raises
nothing, a weak cohort cannot manufacture a prospect and a strong one cannot erase one. No result,
usage, roster need, philosophy or other player's rating is an input. Missing ratings or age leave the
tier unknown; a missing age profile leaves the schedule unread and discounts nothing. There is no
score: the tier, its reasons and the two readings are the output, and every reading ends by saying how
the two made the tier. `developmentalContext.ts` reads the objective context once per request and is the
only way production code obtains a tier: the farm, the Player Development pages and MLB Operations'
contextual assessment (which is HANDED the protection and cannot compute one) cannot tier one man two
ways, and the farm's "how old is he for his league" is the same reader's. A null age is an unknown
age. `npm run stakes:report` re-measures the reference the provisional lines stand for.

**Short of developmental work is one line** (D-051): `playingTime.ts`'s `shortOfWork` (`not_used`,
`occasional`) decides `squeezed` for every job and, through `shortOfWorkVerdict`, "he is not getting the
work" in the man's own review. Sharing a job and batting without fielding are not shortages; the review
raises them for the man (ordinary, and worth a look), the club does not.

### Organizational Philosophy owns preferences

Philosophy profiles are stored per OOTP organization. The current profile has
manual values and policies; the persisted shape anticipates staff and hybrid
modes, but staff-derived values are not implemented.

Philosophy acts only after Player Development, in `assignmentPreference.ts`:

```text
evidence -> prospectDecision -> prospectAssignments -> destinationFit
              (development thresholds; no philosophy anywhere above)
                                   |
                                   v  defensible / indefensible / indeterminate
                        expressAssignmentPreference(plan, promotionAggressiveness)
                                   |
                                   v  annotates only; judgments come out unchanged
        evaluation.preference: preferred | acceptable | disfavored  (defensible only)
        plan.preference: stance, preferred option, ranked defensible options
```

Among the defensible promotion-direction assignments, plus staying, promotion
aggressiveness chooses how far up the challenge ordering the organization
prefers to reach. It never touches a judgment, eligibility flag, constraint, or
blocker; it ranks no indefensible or indeterminate assignment; and it does not
rank demotion. It may not fabricate evidence or conceal why a result changed.

### Minor League Operations owns placement, playing time and cascades

```text
Player State ─┐
statistics ───┼─► farmResults (league-relative, park-adjusted) ─┐
usage ────────┤   farmUsage (season totals · the game log)      │
chronology ───┘   farmRecentUsage (the window · tenure)         │
  (clubArrival)                                                 │
scoutedEvidence ──► developmentFit (stakes, via the reader) ────┤
                                                                ▼
                            currentAssignment ── is this level still developing him?
                            (Player Development; no philosophy)  │
                            playingTime ── can he get the work?  │
                            (conflicts, never a score)           │
                                                                 ▼
  prospectAssignments + destinationFit ──► farmAssignments ── the assignment, one of eight
  assignmentPreference (after defensibility) ──┘                 descriptive conclusions
                                                                 │
        farmAffiliate ── one club read TWICE: operational health | developmental health
        farmOrganization ── congestion, depth, starters against rotation spots
        farmCascade ── what follows one departure, and where it stops
        farmRetention ── outlook (Player Development) | pressure (Operations) | stance (Philosophy)
                                                                 │
                              farmOperations (service + API) ─► the farm workspace ─► the GM
```

The question is whether where a player is, in the role he is in, getting the
work he is getting, is defensible — not whether a promotion was earned (D-044).
A level is not a peer group: production is read against the player's own league,
park-adjusted, with the sample behind it. Age never lowers the developmental bar;
a player past his level's window raises an organizational question instead. One
man competes for one job, and versatility is cover rather than a second claim.
Every player on an affiliate's active list is reasoned about, and one with no
readable line is reported as not assessable with the reason rather than omitted.

A cascade is a chain whose every step is independently defensible, and it stops:
saying where it stopped is the answer (D-045). Retention is three questions with
three owners, and philosophy cannot reach the developmental outlook.

Everything from `currentAssignment` to `farmRetention` is pure; `farmOperations`
does the reading. Every constant is declared once, in `farmCalibration.ts`.

**Season, recent, current state (D-048, MINOR_LEAGUE_OPERATIONS.md Part 8).** Three
kinds of fact are kept apart. *Season usage* (`farmUsage.clubUsage`, the season
tables, in innings) is context and is always shown. *Recent usage*
(`farmUsage.clubGameLogs` → the pure `farmRecentUsage.ts`, the export's per-game
log, in starts) is evidence of the present role over the club's last fifteen
games. *Current state* — the roster, Player State, the rehab screen, the injury
columns, and for a rotation OOTP's projected starters — says who is here, and is
**never inferred from usage**: a man with 136 innings who is not on the roster
competes for nothing. A man's current work level is the recent read when it can be
read, the season's when the export has no game log (every function then behaves
exactly as before), and `unknown` when the recent read is too thin — so a prospect
four games into a new club is neither "bench depth" nor blocked. The window is cut
once per way a competition changes: a man is measured only over the games he could
have played in (since he arrived, outside an injury spell); everyone is measured
from the game after a man who HELD the job left it; and a rehab assignee's or a
departed part-timer's starts are set aside. An arrival is dated by chronology in
D-020's order — OOTP's transaction log through `clubArrival.ts` (shared handling,
like `rehabAssignments.ts`; the farm never reads the log), then the game log's
bound, else not established. A conflict carries its `timing` (`current`,
`emerging`, `historical`, `recently_resolved`, `uncertain`, `season_only`) and the
men no longer competing for the job as history: history is neither erased nor
allowed to masquerade as the present. A relief window may confirm or clear a
shortage and never raise one. None of this is a performance read: Player
Development takes no usage input, philosophy reaches no usage module, and
retention takes no usage input. Everything temporal is read once per `FarmSession`.

Hardened (MINOR_LEAGUE_OPERATIONS.md Part 7): a blocker holds the job — only a
regular is one, and a part-time man ahead of a prospect leaves him in an
opportunity conflict rather than "blocked by" a name; men taking innings at a
job from another position (a corner outfielder in centre, a two-way pitcher at
first) are named as ahead and count against nobody's claim; a designated hitter
is batting, not fielding; a player injured past a week is not cover and competes
for nothing; a pool Player Development has not evaluated leaves a cascade
indeterminate rather than closed. The organization is read once per request
(`FarmSession`) and never cached across requests. The superseded solvers, their
routes and the three older farm pages are gone: there is one farm implementation.

## MLB Operations

```text
Player State ──► mlbRoster (club view: roles, availability, counts, limits)
                    │
                    ├──► mlbNeeds ── need (kind, origin, severity, urgency, horizon, causes, unknowns)
                    │
need ──► mlbResponses ──┬─ discovery        objective
                        ├─ availability     Player State
                        ├─ development      org.ts mlbAssignmentAssessments, per contemplated context; an unknown duration
                        │                   asks temporary depth AND durable role and resolveAcrossDurations answers,
                        │                   incl. context_dependent (or: incomplete)
                        ├─ rights           rightsFor / playerRights (per required action)
                        ├─ clearing         a chain: clear 40-man spot → add → clear active spot → place; each constraint
                        │                   solved separately (60-day list / designation vs option / designation)
                        ├─ role fit         destinationFit at the MLB club
                        ├─ consequences     counts; minorLeagueRoster scenario; contract facts
                        └─ philosophy       annotation, valid alternatives only
                                 │
                                 ▼
                         groups, unranked ──► GM
                                 │
                 mlbReport ◄─────┘  situation · role picture (working estimate: tools + results, and the glove
                                    for a hitter) · the read · recommendation (D-034) · pathways / plans

   scouting layer (D-031 to D-033): resultsEvidence + resultsMetrics (objective results) · roleReview (two
   lenses, working estimate, findings, replacement comparison) · lineupPicture · platoon · rosterScenario
   (cascades) · mlbReview (unprompted `role_holder_review` needs) · mlbPlans (ways to make room)

   fifth pass (D-035 to D-038): scoutedEvidence (+ rating splits, running) → toolsModel (expected wOBA, platoon and
   running expectations) · platoon (ratings prior) · bullpenRoles · benchReview · lineupShifts · staffPreference (window and
   season shade urgency, the bar, tie-breaks and plan order: after validity, every lean shown) · calibration (stamps) ·
   scripts/calibrate.ts (the harness that tunes the constants against outcomes)

   hardening phase (D-039 to D-043, MLB_OPERATIONS_HARDENING.md): scoutedEvidence peers are major leaguers only ·
   roleStandards (what a holder of each role typically is; a concern is measured against the role, shown with the finding) ·
   mlbExplain (why a flag exists, as data) · benchReview (cover quality, functions) · bullpenRoles (pen-wide findings,
   rotation/pen conflict) · lineupPicture (one man one spot, partners) · calibration stamps: calibrated / provisional / policy
```

UI (D-043): `src/pages/MlbOperations.tsx` is the module shell (tabs, URL-hash route, view boundary); `src/pages/mlb/` holds the views
(`Overview`, `PositionPlayers`, `PitchingStaff`, `Bench`, `Decision`), the shared vocabulary (`common.tsx`), the API shapes
(`types.ts`) and the address (`route.ts`). Overview is an inbox with no player tables; the scouting book and the decision workspace are one
click away.

The response builder is pure: it takes ports (`ResponsePorts`) and never reaches a table, the
log, or a rating column. `mlbOperations.ts` wires the real specialists. Directions: **fill**
(internal role change, recall, add to the 40-man as two Rights component actions), **clear**
(the whole path for an injured player who returns to a roster with no spot: the activation, the
chain, and the active-roster and 40-man constraints each cleared separately, grouped by transaction
class; D-028) and **role_needed** (an open spot names no role). An unknown duration is not assumed:
Player Development is asked about temporary depth and a durable assignment and may answer
`context_dependent` (D-027).
Needs come from the current export only, so they appear on the first import; the GM can also
pose a what-if. Details, standards, owner decisions: [MLB_OPERATIONS.md](MLB_OPERATIONS.md).

## Baseball Operations: two sibling modules, one set of specialists

```text
                          Baseball Operations
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
      MLB Operations                        Minor League Operations
   "how do we solve major-league         "how do we organize the farm so players
    roster problems?"                     develop and affiliates stay functional?"
   mlb*.ts · src/pages/mlb/              farm*.ts · src/pages/farm/
              │                                       │
              └──────────────► shared specialists ◄───┘
        scoutedEvidence · prospectDecision / prospectAssignments / destinationFit /
        developmentFit / currentAssignment · playerState · playerRights ·
        philosophy + assignmentPreference · objective statistics
                                  │
                                  ▼
                        organizational effects
```

Neither module owns a specialist and neither reaches into the other's solver.
They exchange consequences across one contract: MLB Operations asks what happens
to the farm if a player leaves, and Minor League Operations owns the answer —
the vacated job, whether it can be absorbed, whose playing time changes, the
replacements Player Development allows (with the alternatives the chain did not
follow), the cascade and where it stops (D-045) — and what an arrival does: the
job an optioned player takes up, who holds it, whose developmental work he pushes
aside. MLB Operations reaches the farm only through `mlbEvidence.ts`, opens one
`FarmSession` per request and hands it through, and displays the farm's own
findings-derived operational status before and after, so the two modules never
describe one club differently (D-047). An unresolved farm consequence is
information, never an illegality: legality is Player Rights'. The direction is
enforced statically in both boundary tests.

## Organization context

The current UI loads `/api/orgs` and chooses, in order, a saved default
organization, the OOTP team marked `human_team = 1`, then the first MLB club.
Several server/AI fallbacks also query `human_team = 1`. Most domain routes
still require `:orgId`, so organization resolution is not yet centralized.

New organization-specific features should accept/reuse established context
and automatically resolve the configured or human-managed organization when
possible. Raw IDs are useful API identifiers, but should not become routine
user input. A shared server-side resolver is roadmap work; do not claim it
already exists.

## API and AI boundary

`server/api.ts` composes feature routers under `/api`. The React UI calls those
routes through `src/api.ts`. Chat tools deliberately call the running app's own
HTTP endpoints, which keeps calculations consistent with the pages.

AI output must be grounded in returned data, state uncertainty, and respect the
speaker's organizational role. Domain recommendations should be computed in
deterministic TypeScript/SQL first; AI may explain or discuss them. Provider
calls are optional and the non-AI application must continue to work without a
credential.

## Safety boundaries

- The server binds to loopback by default and validates the `Host` header to
  mitigate DNS rebinding. LAN mode has no authentication and must remain an
  explicit user choice.
- Electron disables renderer Node integration, enables context isolation,
  filters external navigation, and restricts path-opening IPC to `DATA_DIR`.
- Updates are consent-first: checking may be automatic, but download/install is
  user controlled.
- The current product reads OOTP exports and proposes actions. It does not
  perform transactions in OOTP or write to the save. The one file it reads from
  a live save beyond the export is the transaction log, and only through a
  private copy (D-021).
