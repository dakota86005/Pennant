/**
 * The organization's identity, read from its philosophy settings alone (N12 Track C, D-073): what the React page worked
 * out on the client (`src/pages/Philosophy.tsx`: `buildIdentity`, `positionLabel`, `comparableTeams`), moved to the
 * server, which owns the words, the tags and every line they rest on (the plan's "server-side identity endpoint"). The
 * React page keeps its own copy until the cutover (D-066's precedent).
 *
 * Nothing here reads the club's record, odds or a posture (D-060): an identity says what the GM set, never where the club
 * stands. Nothing here judges a player or a move (D-003, D-019): the settings only order defensible choices, afterwards.
 * The words keep Player Value's method words off the screen ("surplus" is "value for the money", AGENTS.md).
 */

/** Each preference in the GM's words: its label, its ends, its one line, and how it reads in a list. */
export const DIMENSION_WORDS: Record<string, { label: string; low: string; high: string; description: string; short: string }> = {
  competitiveWindow: {
    label: 'Competitive window', low: 'Build for the future', high: 'Maximize current wins', short: 'competitive window',
    description: 'How strongly the organization weighs winning now against value in later seasons.',
  },
  riskTolerance: {
    label: 'Risk tolerance', low: 'Prefer floor and certainty', high: 'Take on variance for upside', short: 'risk tolerance',
    description: 'Tolerance for uncertain projections, volatile players, injury risk and high-variance outcomes.',
  },
  payrollFlexibility: {
    label: 'Payroll flexibility', low: 'Comfortable with commitments', high: 'Protect future flexibility', short: 'payroll flexibility',
    description: 'How strongly guaranteed money in later seasons counts as a cost of its own.',
  },
  costEfficiency: {
    label: 'Cost efficiency', low: 'Pay for ability', high: 'Maximize value for the money', short: 'cost efficiency',
    description: 'How heavily what a player costs, against what he produces, weighs in a choice.',
  },
  teamControl: {
    label: 'Team control', low: 'Production matters most', high: 'Strong control premium', short: 'team control',
    description: 'How much years of inexpensive or guaranteed club control add to a player\'s worth to the club.',
  },
  prospectPreservation: {
    label: 'Prospect preservation', low: 'Prospects are trade currency', high: 'Protect the farm', short: 'prospect preservation',
    description: 'How reluctant the organization is to trade meaningful prospect capital.',
  },
  promotionAggressiveness: {
    label: 'Promotion aggression', low: 'Master each level', high: 'Challenge prospects quickly', short: 'promotion aggression',
    description: 'Among the moves Player Development finds sound for a prospect, how much the club prefers the quicker one.',
  },
  upsidePreference: {
    label: 'Upside preference', low: 'Prefer certainty', high: 'Prefer ceiling', short: 'upside preference',
    description: 'How much upside and projection count against established ability.',
  },
  ageCurveSensitivity: {
    label: 'Age-curve sensitivity', low: 'Trust veterans', high: 'Discount aging aggressively', short: 'age-curve sensitivity',
    description: 'How strongly expected decline with age weighs on contracts and on a player\'s worth to the club.',
  },
  positionalScarcity: {
    label: 'Positional scarcity', low: 'Mostly position-neutral', high: 'Strong scarcity premium', short: 'positional scarcity',
    description: 'How much scarcity at catcher, shortstop, center field and other difficult roles adds.',
  },
  defenseEmphasis: {
    label: 'Defense emphasis', low: 'Bat-first', high: 'Glove-first', short: 'defensive emphasis',
    description: 'How strongly defense weighs in building the roster, against offense.',
  },
  pitchingDepth: {
    label: 'Pitching depth', low: 'Concentrate pitching', high: 'Protect pitching inventory', short: 'pitching depth',
    description: 'How much the organization values spare starting and relief depth.',
  },
  rosterDepth: {
    label: 'Roster depth', low: 'The top of the roster matters most', high: 'Depth matters greatly', short: 'roster depth',
    description: 'How strongly bench, bullpen, optionable depth and cover for injuries are valued.',
  },
  starConcentration: {
    label: 'Star concentration', low: 'Balanced roster', high: 'Stars and supporting pieces', short: 'star concentration',
    description: 'Whether resources go to a few elite players or spread across the roster.',
  },
  versatility: {
    label: 'Versatility', low: 'Prefer specialists', high: 'Prefer flexible players', short: 'versatility',
    description: 'How much playing several positions, and the roster flexibility it brings, adds to a player.',
  },
};

/** The groups the editor shows, in order, with their one line (`GROUPS`). */
export const GROUPS: Array<{ id: string; title: string; description: string; ids: string[] }> = [
  { id: 'direction', title: 'Organizational Direction', description: 'The basic direction of the baseball operation: when wins matter most and how much uncertainty it will live with.', ids: ['competitiveWindow', 'riskTolerance'] },
  { id: 'financial', title: 'Financial Strategy', description: 'How the club spends and how much future flexibility matters.', ids: ['payrollFlexibility', 'costEfficiency'] },
  { id: 'valuation', title: 'Player Valuation', description: 'The traits the front office weighs more when comparing players.', ids: ['teamControl', 'ageCurveSensitivity', 'positionalScarcity', 'upsidePreference'] },
  { id: 'development', title: 'Player Development', description: 'How the organization treats prospect capital, and which sound moves it prefers for a prospect.', ids: ['prospectPreservation', 'promotionAggressiveness'] },
  { id: 'roster', title: 'Roster Construction', description: 'What kind of major-league roster the organization prefers to build.', ids: ['defenseEmphasis', 'pitchingDepth', 'rosterDepth', 'starConcentration', 'versatility'] },
];

/** Each policy in the GM's words (`POLICY_LABELS`). */
export const POLICY_WORDS: Record<string, { label: string; description: string }> = {
  agingContracts: { label: 'Contracts into aging years', description: 'How willing the organization is to guarantee money into likely decline years.' },
  arbitrationExtensions: { label: 'Buying out arbitration', description: 'How strongly the club prefers early extensions that buy arbitration or free-agent seasons.' },
  rentalAcquisitions: { label: 'Rental acquisitions', description: 'How willing the club is to trade value for players with little club control left.' },
  salaryDumps: { label: 'Salary-dump trades', description: 'How willing the organization is to spend prospect or player value to move payroll.' },
};

/** Where a value reads on its scale (`positionLabel`): a policy line, stated. */
export function positionWords(id: string, value: number): string {
  const d = DIMENSION_WORDS[id];
  if (!d) return 'Balanced';
  if (value <= 15) return `Strongly — ${d.low}`;
  if (value <= 34) return d.low;
  if (value <= 44) return `Leans — ${d.low}`;
  if (value <= 55) return 'Balanced';
  if (value <= 65) return `Leans — ${d.high}`;
  if (value <= 84) return d.high;
  return `Strongly — ${d.high}`;
}

interface IdentityRule { id: string; lowTag: string; highTag: string; lowClause: string; highClause: string }

const RULES: IdentityRule[] = [
  { id: 'competitiveWindow', lowTag: 'Future-oriented', highTag: 'Win-now', lowClause: 'protects future value even when it costs wins today', highClause: 'strongly prioritizes winning in the current window' },
  { id: 'riskTolerance', lowTag: 'Risk-averse', highTag: 'Upside-tolerant', lowClause: 'prefers certainty and higher-floor outcomes', highClause: 'takes on meaningful risk in pursuit of upside' },
  { id: 'payrollFlexibility', lowTag: 'Commitment-tolerant', highTag: 'Flexibility-first', lowClause: 'is comfortable making meaningful future payroll commitments', highClause: 'places a strong premium on keeping future payroll flexible' },
  { id: 'costEfficiency', lowTag: 'Ability-first', highTag: 'Value-driven', lowClause: 'is willing to pay market price for ability', highClause: 'places a strong premium on value for the money' },
  { id: 'teamControl', lowTag: 'Production-first', highTag: 'Control-conscious', lowClause: 'values present production more than years of control', highClause: 'places a premium on players with meaningful club control' },
  { id: 'prospectPreservation', lowTag: 'Trade-aggressive', highTag: 'Prospect-protective', lowClause: 'is comfortable treating prospects as trade currency', highClause: 'is reluctant to spend significant prospect capital' },
  { id: 'promotionAggressiveness', lowTag: 'Patient development', highTag: 'Aggressive development', lowClause: 'prefers, among sound moves, letting prospects master each level', highClause: 'prefers, among sound moves, challenging a prospect sooner' },
  { id: 'upsidePreference', lowTag: 'Certainty-first', highTag: 'Upside-driven', lowClause: 'leans toward established ability and certainty', highClause: 'leans toward ceiling and projection' },
  { id: 'ageCurveSensitivity', lowTag: 'Veteran-friendly', highTag: 'Age-sensitive', lowClause: 'is relatively willing to trust veteran performance', highClause: 'discounts players aggressively as aging risk grows' },
  { id: 'positionalScarcity', lowTag: 'Position-neutral', highTag: 'Scarcity-aware', lowClause: 'treats players as relatively position-neutral', highClause: 'places a meaningful premium on scarce defensive positions' },
  { id: 'defenseEmphasis', lowTag: 'Bat-first', highTag: 'Defense-first', lowClause: 'leans toward offense when balancing bat and glove', highClause: 'places a strong premium on defense' },
  { id: 'pitchingDepth', lowTag: 'Top-heavy pitching', highTag: 'Pitching depth', lowClause: 'prefers concentrating pitching at the top of the staff', highClause: 'places a premium on pitching inventory and spare arms' },
  { id: 'rosterDepth', lowTag: 'Top-end focused', highTag: 'Depth-oriented', lowClause: 'concentrates value in the strongest part of the roster', highClause: 'places a premium on bench, bullpen and optionable depth' },
  { id: 'starConcentration', lowTag: 'Balanced roster', highTag: 'Star-concentrated', lowClause: 'prefers spreading resources across a balanced roster', highClause: 'is willing to concentrate resources in elite players' },
  { id: 'versatility', lowTag: 'Specialist-friendly', highTag: 'Versatility-valuing', lowClause: 'is comfortable carrying players with narrower roles', highClause: 'places a premium on multi-position and roster flexibility' },
];

const high = (v: Record<string, number>, id: string) => Math.max(0, ((v[id] ?? 50) - 50) / 50);
const low = (v: Record<string, number>, id: string) => Math.max(0, (50 - (v[id] ?? 50)) / 50);

const COMPOSITES: Array<{ tag: string; clause: string; score: (v: Record<string, number>) => number }> = [
  { tag: 'Sustainable contender', clause: 'tries to win now while protecting the controllable core and the farm', score: (v) => Math.min(high(v, 'competitiveWindow'), high(v, 'teamControl'), high(v, 'prospectPreservation')) },
  { tag: 'All-in contender', clause: 'is willing to spend future value aggressively to improve the current club', score: (v) => Math.min(high(v, 'competitiveWindow'), low(v, 'prospectPreservation'), high(v, 'riskTolerance')) },
  { tag: 'System builder', clause: 'prioritizes building a controllable long-term core over immediate wins', score: (v) => Math.min(low(v, 'competitiveWindow'), high(v, 'prospectPreservation'), high(v, 'teamControl')) },
  { tag: 'Efficiency engine', clause: 'treats payroll efficiency and future flexibility as major advantages', score: (v) => Math.min(high(v, 'costEfficiency'), high(v, 'payrollFlexibility')) },
  { tag: 'Star-led contender', clause: 'concentrates resources in elite players while prioritizing the current window', score: (v) => Math.min(high(v, 'competitiveWindow'), high(v, 'starConcentration')) },
  { tag: 'Deep contender', clause: 'tries to contend through roster depth rather than a small group of stars', score: (v) => Math.min(high(v, 'competitiveWindow'), high(v, 'rosterDepth')) },
  { tag: 'Matchup machine', clause: 'values interchangeable players, depth and the ability to create favorable matchups', score: (v) => Math.min(high(v, 'rosterDepth'), high(v, 'versatility')) },
  { tag: 'Run-prevention club', clause: 'places unusual emphasis on defense and on keeping pitching depth', score: (v) => Math.min(high(v, 'defenseEmphasis'), high(v, 'pitchingDepth')) },
  { tag: 'Fast-track pipeline', clause: 'prefers, among sound moves, challenging high-upside prospects sooner', score: (v) => Math.min(high(v, 'promotionAggressiveness'), high(v, 'upsidePreference')) },
  { tag: 'Premium-core builder', clause: 'places extra value on controllable players at difficult-to-fill positions', score: (v) => Math.min(high(v, 'teamControl'), high(v, 'positionalScarcity')) },
  { tag: 'Short-commitment model', clause: 'is especially cautious about aging curves and long-term payroll', score: (v) => Math.min(high(v, 'payrollFlexibility'), high(v, 'ageCurveSensitivity')) },
  { tag: 'Ceiling seeker', clause: 'takes on uncertainty for higher-upside outcomes', score: (v) => Math.min(high(v, 'riskTolerance'), high(v, 'upsidePreference')) },
  { tag: 'Floor-first operation', clause: 'leans toward predictable outcomes and established ability over projection', score: (v) => Math.min(low(v, 'riskTolerance'), low(v, 'upsidePreference')) },
  { tag: 'Depth over stars', clause: 'prefers spreading roster value across a deep roster rather than concentrating it in stars', score: (v) => Math.min(high(v, 'rosterDepth'), low(v, 'starConcentration')) },
];

/** The lines the identity is read by, stated (D-041: policy). */
export const IDENTITY_LINES = {
  /** A setting at least this far from 50 is expressed. */
  expressed: 10,
  /** A combined identity needs every part at least this strong (0–1, from 50 to the end). */
  composite: 0.28,
  tags: 6,
};

function joinClauses(clauses: string[]): string {
  if (clauses.length === 0) return 'keeps a broadly balanced approach without a strongly expressed lean';
  if (clauses.length === 1) return clauses[0];
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`;
}

export interface IdentityReading {
  headline: string;
  tags: string[];
  summary: string;
  nuance: string;
  /** Which settings it was read from, strongest first, in words ("Competitive window 82"). */
  from: string[];
}

/** The organization's identity from its settings (`buildIdentity`). */
export function identityOf(values: Record<string, number>): IdentityReading {
  const individual = RULES.map((rule) => {
    const value = values[rule.id] ?? 50;
    return { ...rule, value, distance: Math.abs(value - 50), high: value > 50 };
  }).sort((a, b) => b.distance - a.distance);
  const composites = COMPOSITES.map((c) => ({ ...c, strength: c.score(values) }))
    .filter((c) => c.strength >= IDENTITY_LINES.composite)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 2);
  const expressed = individual.filter((i) => i.distance >= IDENTITY_LINES.expressed);
  const tags = [...composites.map((c) => c.tag), ...expressed.map((i) => (i.high ? i.highTag : i.lowTag))]
    .filter((t, i, all) => all.indexOf(t) === i)
    .slice(0, IDENTITY_LINES.tags);
  const strongest = expressed.slice(0, 5).map((i) => (i.high ? i.highClause : i.lowClause));
  const clauses = composites[0] ? [composites[0].clause, ...strongest.slice(0, 3)] : strongest;
  const neutral = individual.filter((i) => i.distance < IDENTITY_LINES.expressed).length;
  const nuance = neutral >= 9
    ? 'Most other settings stay near neutral, so this is a focused philosophy rather than a strongly prescriptive one.'
    : neutral >= 5
      ? 'Several secondary settings stay close to neutral, leaving the front office room outside its strongest priorities.'
      : 'This is a strongly defined philosophy, with few settings left near neutral.';
  return {
    headline: composites[0]?.tag ?? (expressed[0] ? (expressed[0].high ? expressed[0].highTag : expressed[0].lowTag) : 'Balanced operation'),
    tags: tags.length > 0 ? tags : ['Balanced'],
    summary: `This organization ${joinClauses(clauses)}.`,
    nuance,
    from: expressed.map((i) => `${DIMENSION_WORDS[i.id]?.label ?? i.id} ${i.value}`),
  };
}

/** Clubs from baseball history as illustrations of a style (`COMPARABLE_TEAMS`): never a claim of literal ratings. */
const COMPARABLES: Array<{ id: string; name: string; description: string; values: Record<string, number> }> = [
  { id: 'tb2020', name: '2020 Tampa Bay Rays', description: 'Low-cost, highly flexible roster construction built around depth, controllable players, matchup options and adaptable pitching.', values: { competitiveWindow: 82, riskTolerance: 65, payrollFlexibility: 92, costEfficiency: 95, teamControl: 88, prospectPreservation: 82, pitchingDepth: 88, rosterDepth: 92, starConcentration: 20, versatility: 95 } },
  { id: 'sf2021', name: '2021 San Francisco Giants', description: 'A depth-first contender that leaned heavily on versatile players, platoons, role optimization and productive veterans.', values: { competitiveWindow: 82, riskTolerance: 60, costEfficiency: 78, ageCurveSensitivity: 25, defenseEmphasis: 60, rosterDepth: 95, starConcentration: 25, versatility: 95 } },
  { id: 'chc2016', name: '2016 Chicago Cubs', description: 'A young, controllable contender with depth and versatility that grew more willing to spend future value once the window opened.', values: { competitiveWindow: 95, riskTolerance: 65, payrollFlexibility: 45, costEfficiency: 60, teamControl: 85, prospectPreservation: 45, promotionAggressiveness: 80, upsidePreference: 75, rosterDepth: 85, versatility: 80 } },
  { id: 'nyy2020', name: '2020 New York Yankees', description: 'A star-heavy perennial contender comfortable with major payroll commitments while still drawing value from homegrown players.', values: { competitiveWindow: 97, payrollFlexibility: 15, costEfficiency: 30, teamControl: 62, prospectPreservation: 50, rosterDepth: 70, starConcentration: 92 } },
  { id: 'kc2015', name: '2015 Kansas City Royals', description: 'A win-now club built around run prevention, bullpen strength, roster depth, athleticism and a willingness to spend prospect capital.', values: { competitiveWindow: 95, riskTolerance: 70, costEfficiency: 72, prospectPreservation: 30, defenseEmphasis: 92, pitchingDepth: 92, rosterDepth: 78, starConcentration: 35, versatility: 62 } },
  { id: 'lad2023', name: '2023 Los Angeles Dodgers', description: 'A sustained contender blending stars with organizational depth, internal development, flexible players and a steady prospect pipeline.', values: { competitiveWindow: 95, payrollFlexibility: 40, costEfficiency: 62, teamControl: 72, prospectPreservation: 68, promotionAggressiveness: 72, upsidePreference: 68, rosterDepth: 90, starConcentration: 70, versatility: 82 } },
  { id: 'oak2002', name: '2002 Oakland Athletics', description: 'An extreme value-oriented contender built around cost efficiency, controllable players, disciplined spending and finding undervalued production.', values: { competitiveWindow: 82, payrollFlexibility: 95, costEfficiency: 100, teamControl: 92, prospectPreservation: 78, upsidePreference: 62, starConcentration: 30 } },
  { id: 'atl1995', name: '1995 Atlanta Braves', description: 'A sustained contender centered on elite pitching, organizational continuity, a strong core and enough depth to support it.', values: { competitiveWindow: 92, teamControl: 70, prospectPreservation: 70, pitchingDepth: 100, rosterDepth: 78, starConcentration: 62 } },
];

export interface ComparableReading { id: string; name: string; description: string; match: string; shared: string[]; distance: number }

/** The three clubs whose tendencies sit nearest these settings, closest first (`comparableTeams`). */
export function comparablesOf(values: Record<string, number>): ComparableReading[] {
  return COMPARABLES.map((team) => {
    const entries = Object.entries(team.values);
    const distance = Math.sqrt(entries.reduce((sum, [id, target]) => sum + ((values[id] ?? 50) - target) ** 2, 0) / entries.length);
    const similarity = Math.max(0, 100 - distance);
    const shared = entries
      .filter(([id, target]) => {
        const current = values[id] ?? 50;
        return Math.abs(target - 50) >= 15 && Math.sign(target - 50) === Math.sign(current - 50) && Math.abs(current - target) <= 25;
      })
      .sort((a, b) => Math.abs(b[1] - 50) - Math.abs(a[1] - 50))
      .slice(0, 3)
      .map(([id]) => DIMENSION_WORDS[id]?.short ?? id);
    const match = similarity >= 82 ? 'Very close' : similarity >= 72 ? 'Close' : similarity >= 62 ? 'Some overlap' : 'Loose overlap';
    return { id: team.id, name: team.name, description: team.description, match, shared, distance };
  }).sort((a, b) => a.distance - b.distance).slice(0, 3);
}
