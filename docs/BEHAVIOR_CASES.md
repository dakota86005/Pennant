# MLB Operations behavioral cases

The regression protection for baseball behavior. **159 tests in 14 files**, added in the hardening phase
([MLB_OPERATIONS_HARDENING.md](MLB_OPERATIONS_HARDENING.md)). They are not snapshots and they never say "Player X must be ranked first":
each is a baseball invariant, an acceptable-behavior case, or a boundary, stated so that a failure means either the model has a defect
or the invariant was wrong, and either is worth knowing.

## How they are organized

| File | What it protects |
|---|---|
| `mlbGoldenHitters.test.ts` (15) | The same bat is a different finding in a different job; a DH is his bat; an unseen glove stays unseen and makes a comparison less firm; speed alone is not a complete offensive player; improving a tool or a glove never lowers an estimate. |
| `mlbGoldenPitching.test.ts` (17) | Roles from usage for extreme profiles (closer, high-leverage, long, low-leverage, not yet clear); the same weak line means different things in different jobs; deployment findings say what / what instead / why; pen-wide findings; the rotation and the pen compete for an arm. |
| `mlbGoldenLineup.test.ts` (5) | One man, one spot; a shared spot is shared, and the partner is named; an unsettled spot is not given a regular. |
| `mlbGoldenBench.test.ts` (14) | Standing at a position is not covering it; an emergency catcher is not a backup catcher; the bench is functions, never a score; a two-position function says which position is thin; what is an attention item and what is a finding. |
| `mlbGoldenPlatoon.test.ts` (12) | Unknown split evidence stays unknown (never "no issue"); thin splits never overwhelm ratings and the league; a rating-supported difference survives a weak sample; symmetry between the hands; the read says what drives it. |
| `mlbGoldenAvailability.test.ts` (9) | An injured player is not an available replacement; a transaction Rights cannot establish is not presented as established; a rehab assignment is not an option; a promotion off the 40-man exposes its prerequisite; a DFA is not an ordinary option; removing rights evidence never rewrites the baseball read. |
| `mlbGoldenPlans.test.ts` (8) | No two plans are the same move; consequences are always stated; a plan that would leave a role below its floor says so; a second move must earn its keep. |
| `mlbGoldenContext.test.ts` (10) | Philosophy and season shade preference and urgency only: every candidate fact identical across five clubs; no candidate added or removed; a blocked option stays blocked; urgency never turns uncertainty into certainty; the neutral stance is recoverable; every lean names its dimension; preference never passes a clearly better option. |
| `mlbExplain.test.ts` (11) | The structured answer to why it was flagged, what moved it, what a neutral club would hear, what context changed and never changes, what would change it, what is unknown; for a strong regular, a moderate case, a pitcher, a depth player, incomplete evidence, a bench gap, an unavailable candidate. |
| `mlbInvariants.test.ts` (12) | Metamorphic relations: a finding belongs to the man and his job, not the group (adding a star or a scrub, or reordering, changes nobody else's); a better player is never a bigger concern; unknown is never firmer than known; aging only gets worse; the role standards are ordered the way the jobs are. |
| `mlbThresholdBoundaries.test.ts` (18) | Every policy threshold at the value and a step either side: role floors, regular and partner shares, the platoon minimum and margins, leverage cut-offs, deployment gap, credible-arm line, shift gain and edge, roster floors, IL-return window, the window and season cut-offs. |
| `toolsModelProfiles.test.ts` (12) | The tools model at the corners: monotone, no double counting, no single tool dominates, unlike bats stay unlike, missing tools are never averaged around, running stays small. |
| `resultsStress.test.ts` (14) | How much current performance should move a belief: a hot week, a slump, a full year, an improving and a declining player, no history, sample size as uncertainty, park effects, baserunning. |
| `mlbPopulation.test.ts` (2) | A peer is a major leaguer: fails without the amateur filter (D-039). |

Shared scenario: `tests/mlbGolden.ts` (a club whose fifth starter is far below what a rotation takes, with Triple-A arms who are clear
upgrades on paper, and five organizations that lean every way the layer knows how) on top of `tests/mlbFixtures.ts`. Rights come from the
real evaluator, so the tests exercise the actual three-valued contract.

## Adding a case

When real-save testing finds a new failure mode, add the case before the fix:

1. State the baseball invariant in one sentence. If it names a player, it is the wrong invariant.
2. Put it in the file for its area (or a new file if it is a new area) as an `it` whose name is that sentence.
3. Build it from synthetic evidence through the pure function that owns the answer (`estimateOf`, `reviewGroup`, `evaluatePlatoon`,
   `reviewBench`, `roleOf`, ...) or, for a pipeline behavior, through `replacePacket` in `tests/mlbGolden.ts`.
4. Watch it fail for the reason you expect; fix the model; record the finding in the log in the hardening doc (BUG, SYSTEMATIC or
   DEBATABLE).
5. For a threshold, add the boundary to `mlbThresholdBoundaries.test.ts`. A hair either side, never "exactly on the line": an
   estimate is a blend of floating-point percentiles.

## What is deliberately not encoded

Who ranks first at a position, what any club's recommendation is, or any number that depends on the season's sample. Those change
with the game and would make the corpus a snapshot. The base-rate run over all 30 clubs
(`scripts/calibrate.ts standards`, and the counts in the hardening doc) is the check on how often a flag fires, and it is re-run when a
threshold or a standard changes.
