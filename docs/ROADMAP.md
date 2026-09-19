# Roadmap

This roadmap separates foundations already present from future work. Items are
ordered by dependency and product risk, not promised release date.

## Product direction

Front Office should increasingly model the actual work of running a baseball
organization: imperfect information, specialized departments, constrained
choices, conflicting preferences, and a GM who owns the final call. AI should
make that work more legible and conversational, not replace it with generic
recommendations.

## Foundation already present

These are implementation baselines, not roadmap promises:

- Local OOTP CSV discovery/import, schema-tolerant SQLite storage, automatic
  refresh, and separate persistent scouting history.
- Express domain API, React/Vite UI, Electron desktop shell, static site export,
  auto-update, synthetic Vitest fixture, and release CI.
- Roster, player, statistics, schedule, lineup/pitching, contracts/payroll,
  trades, standings, draft, franchise, storylines, briefing, and staff chat
  surfaces described in [PROJECT_STATE.md](PROJECT_STATE.md).
- Organization-specific manual philosophy profiles with dimensions and policy
  settings.
- A scouted-evidence adapter that is the single source of ability evidence for
  Player Development and Minor League Operations, with focused tests of the
  development engines and a static boundary guard.
- A farm-system architecture that separates prospect/development eligibility,
  destination fit, affiliate roster health, constrained position-player and
  pitcher proposals, and retention evidence.
- Read-only recommendations with explicit safeguards and no OOTP transaction
  writeback.

## Next: make the organizational model dependable

### 1. Test the new domain boundaries directly

Now covered with synthetic inputs: prospect decision thresholds, ordinary and
skip-level authorization, demotion, destination-fit population and low-sample
behavior, development protection, defensive assignment fit, philosophy profile
mechanics, and the evidence adapter. Still uncovered: hitter and pitcher roster
simulations, source-health safeguards and plan ranking, retention guardrails and
advisory outcomes, and organization resolution. The farm modules also assume
export columns (`fatigue_points`, `must_be_active`, and others) the shared
fixture does not carry, so their endpoints need a fuller fixture or
schema-tolerant queries.

Add focused synthetic coverage for:

- philosophy normalization, persistence, resolution, and per-organization
  isolation;
- prospect decision thresholds and normal/skip/demotion assignment gates;
- destination-fit populations, low-sample behavior, and alternate schemas;
- development-protection and defensive-assignment constraints;
- hitter and pitcher roster simulations, source-health safeguards, and plan
  ranking;
- retention guardrails, peer-development evidence, and advisory outcomes; and
- organization resolution when a saved default, human-managed club, or neither
  is present.

The repository has broad API/regression coverage and focused Scouted Development
history/export tests, but the new farm modules do not yet have comprehensive
dedicated coverage.

### 2. Centralize organization context

Introduce a shared server-side resolver with this order: explicit valid
context, saved default, `human_team = 1`, intentional fallback/error. Reuse it
in organization-specific routes, background jobs, exports, and AI tools.
Continue allowing deliberate organization switching, while removing the need
for routine manual IDs.

### 3. Finish the fog-of-war audit

Done for Player Development and Minor League Operations (D-017): one
scouted-evidence adapter, scale normalization, strict missing handling, and a
static guard. Remaining:

- Decide what should replace the neutral placeholder that unknown ratings still
  enter as in readiness (maturity 50) and protection (rating 50, upside 50).
- Route scouting snapshots (`rating_snapshots.cur`/`pot`) through the same
  composite, or record their aggregation method, so history and current level
  share one definition.
- Audit trade, contract, free-agent, franchise, roster, and player-card
  surfaces, which still read `players_value`. Each is a subjective judgment or a
  display that must be either moved to approved evidence or labelled.
- Establish, or keep declining to assume, whether `players_value.oa`/`pot` are
  the organization's scouted view. That needs an export from a save at
  imperfect scouting compared with the in-game card; the repository cannot
  settle it.
- Verify whether fielding-position grades share the tool ratings' display scale.
- Keep AI context free of hidden or provenance-uncertain ratings.

### 4. Correct the philosophy/eligibility boundary

Ordinary-promotion eligibility currently depends on a philosophy-derived
threshold (D-003 known deviation). Make Player Development's eligibility
independent of philosophy and let philosophy rank or gate only among defensible
choices, then update `tests/prospectAssignments.test.ts` deliberately.

### 5. Finish farm-assignment edge cases

- Model ACL/DSL and other same-level Rookie environments explicitly; current
  operations defer Rookie-level balancing.
- Handle multiple affiliates at the same level, eligibility/geography, complex
  assignments, rehabilitation, injuries, and unavailable players consistently.
- Validate position and pitcher-role assignments against observed scouting
  evidence without inventing coverage.
- Add a manual "protect this player" control using the reservation already in
  the development-protection model.

### 6. Add the MLB opportunity layer

AAA-to-MLB is currently surfaced as a discussion, while direct skip-level MLB
moves are intentionally excluded from the minor-league engine. Build a separate
MLB opportunity model that combines developmental readiness with:

- 26/40-man openings and role availability;
- options, waivers, DFA and Rule 5 consequences;
- service-time/control facts without hiding them as value judgments;
- injuries, schedule needs, and competitive context; and
- an explicit GM decision surface.

It must consume Player Development eligibility rather than treating a major
league roster hole as proof a prospect is ready.

## Then: deepen organizational identity

### Staff-informed philosophy

The stored schema supports `staff` and `hybrid` modes, but current resolution
falls back to manual values because staff-derived philosophy is not implemented.
Derive transparent candidate values from actual OOTP staff attributes, show the
source of each dimension, and let the GM override individual dimensions.

### Broader philosophy consumers

Extend philosophy only where the underlying option set is already defensible:
trade alternative ranking, contract posture, free-agent fit, roster depth, and
competitive-window planning. Each consumer must expose the exact dimensions
that affected it and retain hard transaction/development guardrails.

### AI as staff interface to domain work

Expose philosophy, development assignments, farm roster health, operations
plans, retention evidence, and eventually MLB opportunity through the same
domain API tools used by the UI. Staff voices should discuss the organization's
real constraints and disagree for role-specific reasons. AI should cite the
domain result and uncertainty, not invent its own hidden ranking.

## Later: calibration and longitudinal management

- Validate thresholds across synthetic fixtures and diverse voluntarily
  described save shapes without collecting live private saves.
- Track how past GM decisions and observed outcomes inform future review while
  avoiding hindsight claims about hidden true talent.
- Add richer multi-season organizational planning, ownership constraints,
  staffing effects, budget scenarios, and decision journals.
- Improve confidence labels and provenance so every recommendation can answer
  “what did we know, what did we infer, and what remains uncertain?”

## Explicit non-goals

- A generic baseball recommendation chatbot detached from the save and domain
  models.
- Omniscient player evaluation using hidden OOTP true talent.
- Automatic transactions, releases, promotions, or save mutation without the
  GM's explicit final decision.
- Requiring users to find and type organization IDs for ordinary
  organization-specific workflows.
- Uploading live saves, generated databases, credentials, or machine-private
  state to make development easier.
