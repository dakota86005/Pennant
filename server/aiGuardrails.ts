/**
 * The rules every AI writer works under: the GM Briefing, the Storylines and (for the value figures) the Staff room.
 *
 * One set, shared, so no writer is handed the farm, the contracts or Pennant's value figures without the rules that go
 * with them (B-63). The application decides; AI explains (D-001): a writer describes what the data and the specialists
 * already say, names what is not known (D-018), never turns a farm review into a promotion or call-up verdict (D-003,
 * D-044), and never gives advice of its own. No writer is handed the postseason odds or the deadline posture (D-060,
 * amended 2026-10-28), so none of these rules mentions them.
 */

/**
 * What the assistants are told about Pennant's value figures (Player Value phase 6c, D-001, D-052), in place of the old
 * note on OOTP's value percentiles, which no context carries any more. Shared by the briefing, the storylines and the
 * staff chat.
 */
export const VALUE_FIGURES_NOTE =
  "VALUE FIGURES: expected wins, a season's cost, contract value, the value of keeping him and a free agent's cost at the " +
  "market are Pennant's own readings (Player Value), each a most likely figure with the range it could be; a null means " +
  'not known, and its reason says why. Quote them as ranges and say when one is not known. You never produce a value ' +
  'number of your own: no dollar figure, rating, rank or score for a player that is not in the data. They describe; they ' +
  'recommend nothing, so never present one as advice to sign, keep, trade or release anyone: the GM decides.';

/** Only what the data says, never what a name or the real world suggests. */
export const STRICT_DATA_RULES =
  "STRICT DATA RULES: Never infer a player's position, role, handedness, injury, contract demand, salary demand, or " +
  'roster status from his name or from outside baseball knowledge. Use only fields explicitly present in the supplied ' +
  'data. If a fact is absent, omit it rather than guess.';

/** Unknown stays unknown (D-018): a null is never a zero, an average or a none. */
export const NULL_MEANS_UNKNOWN =
  "NOT KNOWN: a null figure (an age, a budget, a market, a value) means the save doesn't say. Say it isn't known, or leave " +
  'it out; never read it as zero, as average or as none.';

/** The farm as Minor League Operations and Player Development describe it: their conclusions, never a verdict (D-044). */
export const FARM_RULES =
  "FARM: 'farm.attention' is what Minor League Operations says needs a decision (a prospect who cannot get the work, an " +
  "affiliate that cannot field a team, a roster spot in question). 'farm.promotionDirection' lists players for whom the " +
  "farm review finds a more demanding assignment developmentally defensible ('review' says what it found, 'defensibleAt' " +
  'the levels): a conclusion about his development, never a call-up and never a promotion verdict. Never say a player ' +
  'has earned, deserves or should get a promotion. Only a player currently at AAA may be described as an MLB call-up ' +
  'candidate, and do not say a minor-league promotion fills an MLB bench or bullpen need. Do not rank prospects or ' +
  'invent a top-prospect list.';

/** Contracts as Player Value describes them: facts and ranges, no recommendation (D-052). */
export const CONTRACT_RULES =
  "CONTRACTS: 'contractSituations' describe each contract (salary, term, what happens after this season, next season's " +
  'cost, expected wins, contract value and value of keeping him as ranges with a most-likely figure); they carry no ' +
  "recommendation, so never present one as the app's advice, and say 'not known' where a figure is null. Do not invent " +
  'extension years or dollar figures.';

/** The application decides; AI explains (D-001). */
export const NO_ADVICE =
  "NO ADVICE: nothing in the data is the app's advice, and you give none of your own. Describe and explain; never tell " +
  'the GM to sign, keep, trade, release, promote or call up anyone. The GM decides.';

/** Every rule above, in one block, for a writer's system prompt. */
export const WRITER_GUARDRAILS = [STRICT_DATA_RULES, NULL_MEANS_UNKNOWN, FARM_RULES, CONTRACT_RULES, NO_ADVICE, VALUE_FIGURES_NOTE].join(' ');
