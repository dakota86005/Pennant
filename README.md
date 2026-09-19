# OOTP Front Office

Front Office is a local companion for an **Out of the Park Baseball 27** save.
Its goal is to make running a baseball organization feel like being its GM:
you see the evidence, constraints, competing priorities, and consequences, then
make the decision yourself.

It imports OOTP's CSV export into a local SQLite database and serves a React
application in a browser or packaged desktop app. Your save stays on your
machine. Optional cloud AI features send only the context assembled for the
feature you invoke; local Ollama can be used without an API key.

```text
OOTP CSV export  →  importer (SQLite)  →  local server  →  browser or desktop app
```

## About this fork

This is a fork of [lsukev/ootp-front-office](https://github.com/lsukev/ootp-front-office).
It builds on that project's import pipeline, interface, statistical and roster
tools, development history, transactions tooling, AI features, and other
foundations while pursuing a deeper baseball-operations and simulation
direction. The original author has not endorsed this fork.

The fork's primary emphasis is an organization-first decision experience:
Player Development, Organizational Philosophy, and Minor League Operations
have distinct responsibilities, and the GM retains the final call.

## Design philosophy

### The GM is the decision-maker

Front Office can calculate, flag, simulate, compare, and explain. It does not
make OOTP transactions or write to your save. A recommendation is an advisory
option with evidence and safeguards, not an instruction.

### Subsystem ownership

The farm-system work follows a deliberate hierarchy:

1. **Player Development** determines which development and assignment choices
   are defensible from the player's observed evidence and the affiliate ladder.
2. **Organizational Philosophy** expresses how your organization prefers to
   choose among those defensible options. It cannot make an indefensible move
   defensible.
3. **Minor League Operations** solves roster, coverage, rotation, bullpen, and
   retention problems within those development constraints and preferences.
4. **You, the GM**, decide whether to act.

Roster pressure cannot manufacture a promotion case, and philosophy cannot
override a development safeguard. The application shows blockers, alternatives,
and philosophy adjustments so the reasoning stays inspectable.

### Scouting and fog of war

Subjective judgments about ability, ceiling, readiness, role quality, and
developmental trajectory use the organization's exported scouting ratings and
persisted scouting-history observations. They do not use hidden OOTP
true-talent values. Missing scouting evidence remains missing.

Farm and development pages read ability only through one evidence adapter,
which uses the exported tool ratings (not OOTP's own Overall/Potential values).
Their current and potential figures are therefore a Front Office summary of the
visible tools, on a 20-80 scale whatever OOTP scale the save displays, and will
not always match the number on the in-game player card. Where a grade is not
exported the page says the evidence is incomplete instead of filling it in.

Objective facts may be treated as known when present in the export: statistics,
contracts, service time, age, injuries, roster status, and recorded
transactions. Rating movement represents a change in the organization's
observed evaluation; it is not proof of hidden true-talent development.

## What Front Office does

Choose an organization and work across its MLB club and affiliates, or switch
organizations to scout another system. The interface uses the club's saved team
colors and local OOTP logo where available.

- **Daily club operations:** dashboard, standings, schedule and probable
  starters, lineups, pitching availability, rosters, depth chart, injuries,
  staff, player dossiers, and league reference tools.
- **Farm System:** Farm Overview, Decisions, and Affiliates workspaces; Player
  Development assignment analysis; Scouted Development history; prospect views;
  affiliate roster health; defensive coverage; rotation and bullpen structure.
- **Farm operations:** development protection, destination fit, normal and
  exceptional assignment consideration, position-player and pitching roster
  plans, alternatives and rejections, and advisory retention/release review.
  Level-changing proposals must be authorized by Player Development; no move is
  applied automatically.
- **Organizational Philosophy:** per-organization manual profiles with
  preference dimensions and contract/trade policies. Philosophy currently
  influences prospect promotion thresholds and farm plan/retention ranking.
  Staff and hybrid modes exist in the stored profile shape but presently fall
  back to manual values; staff-derived philosophy is not yet implemented.
- **Major-league and front-office tools:** contracts, payroll, free agents,
  Trade Center, 40-man roster pressure, roster status, injuries, staff, draft,
  franchise history, organization comparison, trends, leaderboards, watchlist,
  and notes.
- **Static sharing:** export a read-only website snapshot from **Settings →
  Share**. It contains exported league data and excludes credentials and
  writable/server-only features.

Many views are schema-tolerant because OOTP exports vary by save, version, and
locale. When optional evidence is absent, a feature should fail narrowly rather
than invent an answer.

## How recommendations work

The app's baseball logic is deterministic TypeScript and SQL operating on the
local import. It gathers save facts and visible scouting evidence, applies
development and transaction guardrails, and exposes reasons, confidence limits,
and alternatives. AI may discuss those results, but it is not a parallel
recommendation engine.

For example, Farm System operations evaluate actual affiliate rosters and avoid
fixing one destination by leaving the source roster unhealthy. Development
protection makes routine balancing stricter for more valuable prospects.
Retention flags are GM-review prompts, not releases.

AAA-to-MLB can appear as a development discussion. A full MLB call-up/recall
management system is not implemented: it will need to combine developmental
readiness with actual MLB opportunity and transaction feasibility (26/40-man
space, options, waivers, service time, injuries, and role availability).

## AI

AI is optional supporting staff: it can provide GM briefings, storylines, trade
discussion, and staff chat grounded in the app's own API. It does not replace
the deterministic domain logic or the GM. The non-AI application works without
a provider credential.

Supported providers are Anthropic, OpenAI, Google Gemini, OpenCode Zen, and
**Ollama (local)**. Select a provider in **Settings → AI Features**. Cloud
providers require their corresponding API key; Ollama uses a local
OpenAI-compatible server and requires no key (default endpoint:
`http://127.0.0.1:11434`). Provider/model selection can be global or
feature-specific.

Cloud AI requests contain only the game data context assembled for the feature
you use. Credentials are stored locally; packaged desktop builds use OS-backed
storage when available. Environment variables also work:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or
`OPENCODE_API_KEY`.

## Current development direction

The next major direction is a distinct **MLB Management** opportunity layer.
It is future work, not current functionality: it should combine a player's
developmental MLB readiness with actual MLB opportunity and transaction
feasibility. Other planned work includes a shared organization-context resolver,
staff-derived philosophy, broader philosophy consumers, rating-scale/fog-of-war
audits, and additional farm-operation test coverage. See
[docs/ROADMAP.md](docs/ROADMAP.md) for the current roadmap.

## Installation and requirements

### Desktop app

If this fork publishes installers, download them from its
[Releases page](https://github.com/dakota86005/ootp-front-office/releases).
On macOS, open the `.dmg` and drag the app to Applications; on Windows, run the
`.exe` installer. Windows builds are currently unsigned, so SmartScreen may ask
you to use **More info → Run anyway**.

The desktop app stores imported data, settings, history, and AI caches in its
OS user-data folder, outside the app bundle. Updates are consent-first: the app
can check for releases, but download and installation require user action.

### Run from source

Requirements:

- OOTP Baseball 27 with at least one save
- Node.js 20 or newer
- macOS or Windows for the supported save auto-detection paths
- An optional cloud-provider API key, or a running local Ollama service, for AI

```bash
git clone https://github.com/dakota86005/ootp-front-office.git
cd ootp-front-office
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite development UI proxies to the local API
server (normally port 5178). For a production-style local server, use:

```bash
npm start
```

`npm install` compiles the native `better-sqlite3` dependency. If that fails,
install Xcode Command Line Tools on macOS (`xcode-select --install`) or the
**Desktop development with C++** workload from [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
on Windows, then retry.

### Source and desktop data

Source mode defaults to the repository's `data/` directory; the desktop app
uses its OS user-data directory. They are separate installs with separate
settings, databases, and histories. To deliberately use the desktop data from
source, set `OOTP_FO_DATA_DIR` to the desktop data folder before starting.
Run only one copy against a shared data directory at a time.

## Normal OOTP workflow

### Export your league

Front Office never parses or modifies OOTP's binary save. In OOTP 27:

1. Load the save.
2. Open **Database Tools**.
3. Choose **Global Actions → Export data to CSV files**.
4. Wait for the export to finish.

OOTP writes the CSVs under `<save>.lg/import_export/csv/`. Front Office accepts
that CSV directory, the `.lg` save directory, or its `saved_games` parent. It
detects common delimiters and encodings.

The app scans common OOTP 27 saved-game folders on macOS and Windows, including
direct/Mac App Store and common OneDrive locations. If it cannot find your save,
choose a folder manually in the app; you do not need to edit source code.

| Platform | Default location scanned |
| --- | --- |
| macOS (Mac App Store) | `~/Library/Containers/com.ootpdevelopments.ootp27macqlm/Data/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/` |
| macOS (direct download) | `~/Library/Application Support/Out of the Park Developments/OOTP Baseball 27/saved_games/` |
| Windows | `Documents/Out of the Park Developments/OOTP Baseball 27/saved_games/` |
| OneDrive | `~/Library/CloudStorage/OneDrive-Personal/ootp/saved_games/` or `~/OneDrive/Documents/Out of the Park Developments/OOTP Baseball 27/saved_games/` |

### Refresh and history

After simming, export CSVs again. Front Office watches the selected export and
can re-import it automatically; **Refresh** forces an import. Each import
preserves a separate local scouting-history database and records observed
ratings, so repeated exports provide the material for Scouted Development.

### Share a static snapshot

Use **Settings → Share** to create a static site snapshot. It is suitable for a
static host, but it is not a live application: server-backed/writable features
such as AI, settings, chat, and watchlist functions are omitted.

### LAN access

The server binds to loopback by default. To expose it on a trusted LAN in source
mode:

```bash
OOTP_FO_BIND=0.0.0.0 npm start
```

There is no authentication in LAN mode. Anyone who can reach it can read the
save and change local app settings; cloud-AI use could also consume your
provider credits. Do not forward the port from your router. If you need a
custom hostname, add it with `OOTP_FO_ALLOWED_HOSTS`.

## Development, tests, and architecture

```bash
npx tsc --noEmit   # TypeScript validation
npm test           # Vitest suite using a synthetic temporary league
npm run build      # Vite production build
npm run desktop:build
```

Two useful checks need suitable imported league data:

```bash
npm run check:stats  # derived-stat centering
npm run check:theme  # generated team-palette contrast
```

To package desktop apps:

```bash
npm run dist:mac
npm run dist:win
```

Electron uses a different native-module ABI from ordinary Node. The desktop
scripts rebuild `better-sqlite3` for Electron; after a desktop build, run
`npm run abi:node` before returning to browser/source development if needed.

The core architecture is one domain API: React, Electron, static export, and AI
all use the same Express-backed calculations. Imported `league.db` is a
replaceable current-export snapshot; `history.db` retains scouting observations
and user-owned state across imports.

### Statistics and project layout

The Rosters page supports configurable batting and pitching columns, including
derived statistics such as OPS+, wRC+, ERA+, FIP, and wOBA. OOTP does not export
all of these directly: Front Office derives them from the imported league
context, using league/level baselines and OOTP park ratings where applicable.
`npm run check:stats` checks the resulting aggregate centering against the
imported data.

```text
server/     Express API, importer, domain models, AI providers, and history store
src/        React UI, pages, shared presentation and API client
electron/   Desktop shell, preload bridge, and updater
scripts/    Validation and desktop-build helpers
data/       Runtime state in source mode (gitignored)
```

Useful project references:

- [Architecture](docs/ARCHITECTURE.md) — runtime, boundaries, data flow, and subsystem ownership
- [Decisions](docs/DECISIONS.md) — durable product and evidence decisions
- [Roadmap](docs/ROADMAP.md) — current foundations and future work
- [Project state](docs/PROJECT_STATE.md) — point-in-time implementation inventory and known gaps
- [AGENTS.md](AGENTS.md) — contribution guidance for coding agents

## Troubleshooting

**No OOTP saves detected** — choose the save folder, its `saved_games` folder,
or `<save>.lg/import_export/csv/` manually. Confirm that you have made a CSV
export.

**A save has no export** — load the correct save in OOTP and repeat **Database
Tools → Global Actions → Export data to CSV files**.

**A page is empty or a statistic looks stale** — re-export from OOTP and use
**Refresh**. Exports may omit optional fields; unavailable evidence should be
shown as unavailable rather than inferred.

**Scouted Development has little to show** — it needs observed snapshots across
exports/dates. Export again after simming; early history is necessarily sparse.

**Ollama cannot be reached** — start Ollama locally and confirm its endpoint,
or configure `OLLAMA_BASE_URL` if it is not at `http://127.0.0.1:11434`.

**A port is in use** — the source API normally uses 5178 and Vite normally uses
5173. Stop the other process or adjust the relevant local configuration.

## Credits and relationship to upstream

Front Office is derived from [lsukev/ootp-front-office](https://github.com/lsukev/ootp-front-office).
This fork gratefully retains and extends the original project's substantial
foundation; differences in direction and implementation belong to this fork.
Nothing here implies endorsement by the upstream author.

## OOTP disclaimer

This is an unofficial fan project. It is not affiliated with or endorsed by Out
of the Park Developments or Out of the Park Baseball.

## License

MIT — see [LICENSE](LICENSE).
