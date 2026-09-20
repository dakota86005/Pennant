# Product and architecture decisions

These records capture durable decisions, not a list of everything currently
implemented. Each entry states its implementation status so future intent is
not mistaken for present behavior.

## D-001 — Simulate front-office work, not a recommendation chatbot

**Status:** Accepted. **Implementation:** Partial and ongoing.

Front Office's primary goal is to feel like running a baseball organization as
the GM. The experience should expose decisions, constraints, evidence,
alternatives, organizational voices, and consequences. AI is a supporting
staff capability inside that system, not the product's generic answer box.

Consequences:

- Deterministic domain models compute facts, eligibility, and recommendations.
- AI may retrieve, explain, compare, role-play staff viewpoints, and generate
  grounded narrative; it must not silently replace those models.
- Interfaces should give the GM evidence and agency, not just a score or a
  confident imperative.

The current staff chat calls the application's own API and the farm workspaces
show evidence, safeguards, and alternatives. Applying this standard uniformly
across all features remains ongoing.

## D-002 — Preserve organizational knowledge and fog of war

**Status:** Accepted. **Implementation:** Enforced for Player Development and
Minor League Operations through the scouted-evidence adapter (D-017); scouting
history is present; pre-fork trade, contract, franchise, and roster surfaces
still read `players_value` and are not yet audited.

Subjective player-ability judgments must use the organization's/scouting
director's observed ratings and development history. Hidden OOTP true-talent
values are out of bounds. Visible exported potential fields—including fields
named `*_talent_*`—are usable only as the organization's scouted projection,
not as proof of underlying truth.

Objective facts such as statistics, contracts, service time, injuries, roster
status, age, schedule/results, and transactions may be treated as known when
the export provides them.

Consequences:

- Unknown ratings remain unknown; do not backfill them with omniscient data or
  AI inference.
- A rating-history change is an observed scouting change. It cannot be labeled
  pure true-talent development.
- Comparisons should use the organization's available evidence and identify
  small samples, missing fields, and low-confidence populations.
- Synthetic fixtures must model only visible/exported information.

## D-003 — Development constrains; philosophy prefers; operations solves

**Status:** Accepted. **Implementation:** Implemented for the current farm
assignment/operations work (authority boundary enforced structurally, D-019),
with known gaps in the roadmap.

Player Development determines which assignments or development decisions are
defensible. Organizational Philosophy expresses preferences among defensible
choices. Minor League Operations solves roster and assignment problems using
the development constraints and organizational preferences.

Consequences:

- Roster need cannot create a promotion or demotion case.
- Philosophy cannot legalize an assignment rejected by development evidence.
- Operations may choose among authorized destinations and rank alternatives
  based on coverage, roster structure, source health, depth, and philosophy.
- The response must expose blockers, safeguards, and philosophy adjustments so
  the GM can understand why a proposal exists.

The former deviation from the second consequence is corrected; see D-019.

## D-004 — The user/GM makes the final decision

**Status:** Accepted. **Implementation:** Current farm/retention outputs are
read-only; no OOTP transaction writeback exists.

The application can recommend, flag, simulate, and explain, but it does not
execute the baseball decision for the user. Release-candidate language is a
request for GM review, not authority to release a player.

Any future mutation workflow must be separately designed, explicitly approved,
previewable, reversible where possible, and require a clear user confirmation.
Automatic OOTP save mutation is not an incidental extension of a read model.

## D-005 — Resolve the current organization automatically

**Status:** Accepted. **Implementation:** Partial.

Organization-specific features should use an established organization context
without asking the user for a raw OOTP organization ID. Resolution should
prefer an explicitly saved organization, then the OOTP organization marked as
human managed, and use an intentional fallback only when neither exists.

The current React app follows this order and several server/AI helpers query
`human_team = 1`, but most routes still require an explicit `:orgId` and there
is no shared server resolver. Centralizing this behavior is roadmap work.

Consequences:

- Do not add new manual ID fields to the user experience when current context
  is available.
- Keep IDs in APIs and persistence where they are stable identifiers.
- Switching organizations for scouting remains a deliberate supported action;
  automatic resolution determines the default, not a permanent lock.

## D-006 — Local-first data and explicit AI egress

**Status:** Accepted. **Implementation:** Present.

Imported league data, history, settings, caches, and credentials live locally.
AI is optional. When an AI feature is invoked, only the context assembled for
that feature is sent to the selected provider. Non-AI features must work with
no provider credential.

Credentials use environment variables or local credential storage; Electron
uses OS-backed encryption when available. Static exports exclude secrets and
writable/private features.

Consequences:

- Never commit credentials, API keys, `.env` files, live OOTP saves, generated
  databases, AI caches, settings, chat histories, local paths, or
  machine-specific private data.
- Never use a live save as a test fixture or attach it to an issue.
- Review screenshots and logs for local paths and secrets before sharing.

## D-007 — Treat OOTP CSV exports as a variable external schema

**Status:** Accepted. **Implementation:** Present, with per-feature audits still
needed as fields are added.

OOTP versions, locales, and saves produce different CSV shapes. The importer
therefore discovers delimiters, encoding, tables, and columns, while query
modules check optional inputs where possible.

Consequences:

- A feature should fail narrowly when optional evidence is absent, preserving
  the rest of the page.
- Queries should use `tableExists`, `tableColumns`, `hasColumns`, or
  `locateColumn` when an export field is not universally available.
- New behavior needs fixtures for missing/alternate shapes, not only the
  developer's current save.

## D-008 — One domain API serves browser, desktop, static generation, and AI

**Status:** Accepted. **Implementation:** Present.

Express and the server domain modules are the single computational backend.
React is a client. Electron embeds the same server and UI. Chat tools call the
same API endpoints used by pages so the assistant cannot drift into a second
implementation of standings, contracts, or player evaluation.

Consequences:

- Put reusable baseball calculations in server modules with explicit outputs.
- Do not encode decisive baseball rules only in React rendering or prompts.
- Keep Electron's IPC bridge limited to desktop-only capabilities.

## D-009 — Separate replaceable imports from persistent observations

**Status:** Accepted. **Implementation:** Present.

`league.db` represents the latest OOTP export and may be rebuilt. `history.db`
persists observations and user-owned state across imports. This separation is
what makes scouting-development history possible without corrupting or
accidentally retaining stale imported tables.

Consequences:

- Re-import code may replace imported tables but must not erase history.
- Persistent records need save/organization/player keys that prevent data from
  bleeding across saves.
- Both databases remain generated private data and are ignored by Git.

## D-010 — Safe Git and repository hygiene are agent requirements

**Status:** Accepted. **Implementation:** Documented in `AGENTS.md` and backed
by ignore rules.

AI coding agents must inspect the worktree, preserve unrelated changes, avoid
destructive Git commands, and never commit or push without explicit direction.
They should make the smallest scoped change, validate it proportionally, and
update durable documentation when a boundary or project-state fact changes.

## D-017 — Subjective ability evidence comes only through the scouted-evidence adapter

**Status:** Accepted. **Implementation:** Present for Player Development and
Minor League Operations (`server/scoutedEvidence.ts`).

`players_value.oa`, `players_value.pot`, and every other continuous
`players_value` ability/talent field are **not** approved evidence for
subjective ability or development judgments. The export carries no viewer
organization, scouting-accuracy setting, or per-field visibility flag, and the
one in-repo comparison against the game (commit `6ca89c8`) was made on a save a
user reported at 100% scouting, where scouted and true grades coincide. A convenient exported field is
not organization-visible merely because it is exported. Such a field may be
approved only when its provenance is positively established as the
human-managed organization's visible scouting evaluation.

The approved source is the exported tool ratings (D-002): current
`*_ratings_overall_*`, potential `*_ratings_talent_*`, stamina and pitch grades,
and revealed fielding-position grades. That approval is by decision, not proof;
every result carries `declared_organization_visible` /
`not_verifiable_from_export`.

Consequences:

- One entry point. Development and operations code obtains a `ScoutedAbility`
  from `loadScoutedAbilities`; it does not read rating columns, `players_value`,
  or `gloves()` itself. `tests/evidenceBoundary.test.ts` fails if a guarded
  module does, or if a new module starts reading `players_value`.
- Missing stays missing. Absent, non-numeric, zero, and negative grades are
  unknown. A composite (unweighted mean of the visible tools) exists only when
  every tool is known. Potential is never inferred from current, or the reverse.
  There is no fallback to `players_value`.
- Ratings are normalized to 20-80 equivalents from the detected display scale,
  so thresholds keep their meaning; the native scale is reported.
- The composite is a Front Office summary, not OOTP's Overall. Pages that show
  `cur`/`pot` from these paths therefore differ from the game card by design.
- Consumers report incomplete evidence (`ratingsEvidence`, `ratingEvidence`,
  `missingEvidence`, destination-fit `unassessedComponents`) and treat what
  depends on it as unknown (D-018), never as a pass or a failure.
- Objective facts (statistics, age, contracts, service time, options, injuries,
  roster status, assignments, transactions) are unaffected and remain known.

**Remaining gaps:** scouting snapshots keep their own non-strict, native-scale
composite. Pre-fork surfaces (trade, contracts, franchise, roster/player
displays) still read `players_value`. Fielding-position grades are assumed to
share the tool ratings' scale. Unknown ratings no longer enter any development
arithmetic; see D-018.

## D-018 — Unknown evidence stays unknown: indeterminate, not imputed

**Status:** Accepted. **Implementation:** Present for Player Development
(readiness, protection, assignment authorization, destination fit) and Minor
League Operations (position and pitching operations, retention).

"We do not know" is distinct from "average", "bad", and "good". A missing
organization-visible rating is never replaced by a midpoint, average,
replacement value, or zero. Player Development represents evidence sufficiency
explicitly (`server/developmentJudgment.ts`):

- A rating-dependent constraint is `satisfied`, `not_satisfied`, or `unknown`.
- An assessment built from constraints is `indefensible` if any constraint is
  not satisfied (a known negative stands whatever else is unknown),
  `indeterminate` if none is but any is unknown, and `defensible` only if all
  are satisfied.
- Readiness is `null` when ratings maturity is; the range it could take is
  reported (`readinessRange`, the model's own outer bounds, not an estimate). A
  conclusion that holds across that whole range — poor production, a demotion —
  still stands. Protection is `null` (tier `null`) unless both current and
  potential are known.
- Objective evidence (production, sample, age/level context, status, history)
  is always evaluated and shown, including on an indeterminate assessment.

Consequences:

- **Philosophy cannot resolve unknown evidence.** Player Development's
  judgments never receive a philosophy (D-019), so no philosophy setting can
  turn an indeterminate assessment into authorization or into a rejection.
- **Operations must handle the third state.** `eligible` is true only for
  `defensible`; `eligible: false` does not mean rejected — read `judgment`.
  Position and pitching operations list an indeterminate candidate in
  `indeterminate` with the missing evidence and the destination's roster need.
  It is not planned (approved), not in `rejected`, and not ranked. Retention adds
  an `indeterminate` recommendation (after objective transaction guardrails,
  which still apply).
- **Indeterminate is not a roster decision.** It does not mean protect, hold,
  or block, and the GM may act despite it. No caller may encode it as one.
- Ranking-only terms that depend on an unassessed comparison are omitted rather
  than valued.

**Remaining gaps:** a destination-fit stretch cost that cannot be computed is
omitted from ranking (contributes nothing) rather than imputed; a pitcher whose
stamina is unknown keeps his current role as developmental role (flagged
`structureEvidence: 'unknown'`); a comparison population below 25 is treated as
not satisfied rather than unknown; neutral defaults for missing objective
context (level-average age, K% baseline) are unchanged.

## D-019 — Player Development authorizes; Organizational Philosophy only prefers

**Status:** Accepted. **Implementation:** Present (`prospectDecision.ts`,
`prospectAssignments.ts`, `assignmentPreference.ts`).

Whether an assignment is developmentally defensible is a function of evidence
and baseball-development rules. It is identical for every organization: for the
same player, evidence, and destination, `defensible` / `indefensible` /
`indeterminate` does not vary with philosophy. Organizational Philosophy
expresses which of the DEFENSIBLE alternatives the organization prefers, and
nothing else.

Before this decision, `promotionAggressiveness` set the promotion threshold
(76 ± 10) that ordinary-promotion and MLB-discussion eligibility, the skip-level
requirement above its floor, and the recommendation bands were measured against.
An aggressive organization could therefore call defensible a promotion a neutral
one could not, and a conservative one could call indefensible what a neutral one
could authorize. The threshold combined two concepts and is now split:

- **Developmental (Player Development):** `development.promotionThreshold` —
  a base readiness of 76 moved only by age relative to level. It gates ordinary
  promotion and MLB discussion; a skip-level move needs ten more (never below 84,
  with fixed performance, maturity and sample floors); a demotion rests on
  objective production, sample and age. The 45-point minimum sample applies to
  every organization.
- **Preference (Philosophy):** `assignmentPreference.ts` runs after
  authorization and destination fit, and only annotates. Among the defensible
  promotion-direction assignments, plus staying (patience), aggressiveness
  chooses how far up the challenge ordering the organization prefers to reach:
  each defensible option is `preferred`, `acceptable`, or `disfavored`. A
  disfavored assignment is exactly as defensible as a preferred one.

Consequences:

- Player Development modules (`prospectDecision`, `prospectAssignments`,
  `destinationFit`, `developmentFit`, `developmentJudgment`) take no philosophy
  and may not import or mention it; `tests/philosophyBoundary.test.ts` enforces
  it statically and by behavior across philosophies.
- Philosophy cannot authorize an indefensible assignment, cannot make a
  defensible one indefensible, and cannot resolve an indeterminate one: an
  indeterminate assignment is never ranked and is never read as "stay".
- Demotion is not ranked: no philosophy dimension expresses demotion patience.
- Minor League Operations receives the defensible set, the indeterminate set
  separately, and the preference beside them (`assignments.preference`). It
  optimizes within the defensible set and never plans anything else. Its own
  philosophy-based ranking adjustments (`promotionAggressiveness`,
  `prospectPreservation`, and others) apply only to candidates Player
  Development has already authorized. Operations does not yet read the
  preference object; when it does, it must keep preference inside the defensible
  set and use it for ordering only, never as a cutoff.

**Remaining gaps:** retention still adds a philosophy adjustment to its
development score, which feeds release-candidate thresholds (a retention
judgment, not assignment authorization, but it blends the two); Operations'
same-level moves are ranked with philosophy-weighted costs.


## D-020 — Roster evidence has a source hierarchy, and three concerns stay separate

**Status:** Accepted. **Implementation:** Current State and Transaction
Chronology are implemented (`playerState.ts`, `transactionLog.ts`,
`assignmentContext.ts`); Rights / Eligibility is deliberately not.

An audit of a real macOS save overturned an earlier assumption that transaction
chronology is unavailable. OOTP keeps a live SQLite transaction log in the
save's `temp/` folder. The official CSV export remains the best broad source
for current state. They answer different questions, so roster evidence is read
in this order:

1. **Explicit CSV/export current state** — team, level, active and 40-man
   membership, injured-list flags, DFA/waivers and countdown, service time,
   option counters, contract kind. If OOTP exports a fact, it is read as
   exported and never re-derived from history or snapshots.
2. **Explicit live transaction log** — what happened and when: optioned,
   recalled, purchased contract, DFA/waivers, injured list, restricted list,
   release, Rule 5 return, injury rehab, and level moves. Unrecognised wording
   is kept as an `unsupported` event, not dropped and not interpreted.
3. **Pennant's observed snapshots** (`rosterStateHistory`) — a longitudinal
   fallback and a cross-check. A difference between two imports is evidence
   that state changed, never proof of which transaction changed it. It must not
   manufacture "optioned", "recalled", or "DFA" and must not override 1 or 2.

Every meaningful field carries a provenance (`explicit_export`,
`explicit_log`, `observed_snapshot`, `derived`, `unknown`) and, when unknown, a
reason (`source_unavailable`, `source_stale`, `rule_not_implemented`,
`not_exported_by_ootp`, `transaction_type_not_understood`,
`no_observed_example`, `no_explicit_event`) — see `server/provenance.ts`.

Three concerns are never collapsed into one roster object:

- **Current State** — what is objectively true now.
- **Transaction Chronology** — what explicitly happened.
- **Rights / Eligibility** — what may legally or operationally be done now.
  Not implemented; it depends on unresolved OOTP semantics (see the roadmap).

Consequences:

- **40-man membership is `players_roster_status.is_on_secondary`.** The earlier
  inference (active, or secondary, or on the MLB injured list) reported 35
  against the export's 30 on a real save, counting five 60-day-IL players OOTP
  does not list. Whether such a player should occupy a slot is a rights
  question and is not settled by overriding the export.
- **Rehab is first-class.** A rehab player appears in the export as Triple-A, on
  the 40-man, not active, with no distinguishing flag — identical to an optioned
  player. Only the log tells them apart. A rehab assignment is not an option or
  a demotion (`ordinaryOption: false`). When the log is unavailable the same
  export state is `unattributed` with `ordinaryOption: null`; it is never
  assumed to be an option.
- The export outranks the log where they disagree about current placement: an
  open rehab episode in the log does not survive the export showing the player
  elsewhere.
- Option counters are preserved as exported. Nothing reads them as
  "optionable"; true optionability is unresolved.

## D-021 — The live log is found automatically and only ever read from a copy

**Status:** Accepted. **Implementation:** Present.

Normal use must need nothing beyond the OOTP database export the user already
makes. The save is derived from where the export lives
(`<save>.lg/import_export/csv` names its own `.lg`), and the live database from
the save (`temp/text_data.sqlite3`). A hand-picked `.lg` folder exists only as a
fallback (`POST /api/save-source`) for when derivation genuinely fails.

The live database belongs to OOTP and may be mid-write, so it is never opened in
place. `server/liveLogSnapshot.ts` copies the database and its WAL to a private
temp directory, re-stats the source and rejects a copy that moved or is the
wrong size, validates the copy (`quick_check` plus required tables), retries
when it is torn, opens only the copy read-only, and deletes it on close. The
`-shm` file is not copied: it is a shared-memory index SQLite rebuilds from the
copied WAL. Nothing ever opens an OOTP file for writing.

Consequences:

- If the save or database cannot be found or read, Pennant continues on CSV
  state and reports the log as unavailable, with the reason.
- Log text is read as bytes and decoded as UTF-8 with a Windows-1252 fallback:
  OOTP stores some rows in a legacy encoding (`Vázquez` as byte `0xE1`).
- Parsing the `.dat` binaries remains out of scope; `last_date_simulated.dat`
  is the one exception, a seven-byte date whose layout is inferred from one
  real save and rejected as unknown if it does not decode to a valid date.

## D-022 — Freshness is measured in simulated game days, never wall-clock time

**Status:** Accepted. **Implementation:** Present (`dataFreshness.ts`).

The save, the CSV export, and the transaction log are each placed on one basis:
the last in-game day whose games have been simulated. An export's
`leagues.current_date` names the day about to be played, so it reflects the day
before (verified: `current_date` 2026-5-16, last played game and log 2026-5-15).
File modification times are diagnostics only.

Consequences:

- The log is judged by how far the database has been written (the newest date
  across its transaction, history, news, and injury tables), not by its newest
  transaction, so an off-day does not make it look behind.
- Overall roster evidence is `current`, `partial`, `stale`, or `unavailable`. A
  missing or lagging log makes it `partial` — current state is intact,
  chronology-dependent reasoning is limited — and is never reported as a stale
  snapshot. Only the CSV being behind the save is `stale`, with an
  action-oriented message to export again.
- Moves made on the current, not-yet-simulated day are dated that day in the
  log and are in an export taken afterwards; they do not make the export look
  behind. A move made after the export on the same day cannot be detected by
  date.
