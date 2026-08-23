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

**Status:** Accepted. **Implementation:** Present in scouting/development paths;
ongoing audit required elsewhere.

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
- Continuous `players_value` fields are not approved scouting evidence for
  Major League Operations: their organization-visible provenance is
  unestablished. They remain out of bounds until a source-level audit proves
  otherwise; missing values must not be treated as zero.

## D-003 — Development constrains; philosophy prefers; operations solves

**Status:** Accepted. **Implementation:** Implemented for the current farm
assignment/operations work, with known gaps in the roadmap.

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

## D-011 — Shared roster state precedes MLB opportunity decisions

**Status:** Accepted. **Implementation:** Initial read-only engine present.

Current roster and transaction facts have one authoritative server-side
interpretation in `rosterTransactionState.ts`. Major League Operations, Minor
League Operations, and 40-man planning must consume that state/rule layer
rather than independently interpreting raw OOTP flags.

Consequences:

- Action answers use eligible, ineligible, or indeterminate semantics; missing
  columns and incomplete rule evidence cannot become a convenient default.
- A full active or secondary roster yields a corresponding-move requirement,
  not an invented recommendation about who should be removed.
- The initial engine evaluates only recall, standard option/demotion, and
  40-man addition state. It does not simulate transactions or emulate every
  CBA rule.
- Explicit trade and injury history may be read as events. Current-state flags
  and generic messages must not be reverse-engineered into option, release, or
  recall history.
