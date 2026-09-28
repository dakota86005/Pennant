/**
 * The Morning Report's own parts (N6, Stage A; SWIFTUI_REBUILD.md section 3.4, "What the design's slots need from the
 * server"): the masthead's box score (`TeamSeason`), the lede, "How we win and lose" (`ClubProfile`) and the roster map
 * (`RosterMap`). Served on `FrontOfficeSummary` beside the desk and the cards, from the same cached build.
 *
 * Every sentence is authored on the server, every number is one the server served, and the app draws what is here and
 * nothing else (D-056): a place is a stated count with its "of N" and ties (D-057), a range is Player Value's with its
 * most likely value, control is served structured and never parsed from words, and a figure the export lacks is a
 * sentence, never a zero. Objective facts only on the masthead and in the lede: no odds, posture or window label (D-060).
 */
import type { Cell, Claim, Place, Target, Unit } from '../../contract/presentation.js';
import type { Integer } from '../../contract/primitives.js';
import type { GameDate } from '../../dataFreshness.js';

/** A game's result as the box score shows it. */
export type GameLetter = 'W' | 'L' | 'T';

/** The kicker over the masthead's headline: the club, the league's day, and the last game day the export reflects. */
export interface MastheadKicker {
  /** The club's name; null when the export does not have it. */
  club: Cell | null;
  /** The league's current day ("May 16, 2026"), or why it is not known. */
  today: Cell;
  /** "Through May 15, 2026": the last game day in the export. */
  through: Cell;
}

/** The line under the record: the division place and games back, a stated place with its ties. */
export interface StandingLine {
  /** "2nd in the AL West · 2½ back", with the place (`claim.place`) and the division's clubs as its basis. */
  claim: Claim;
  /** Games back of the division's leader; 0 when it leads or shares the lead. */
  gamesBack: number;
  /** Games ahead of the next club when it leads alone; null otherwise. */
  gamesAhead: number | null;
}

/** The run differential, with runs scored and allowed and the running differential over the last games. */
export interface RunsFigure {
  /** "Run differential", its `value.display` the figure ("+13"). */
  claim: Claim;
  /** "198 scored · 185 allowed". */
  line: Cell;
  scored: Integer;
  allowed: Integer;
  diff: Integer;
  /** The season's running differential after each of the club's last games, oldest first (up to 20); empty before two. */
  trend: Integer[];
}

/** The last five results, oldest first, and the line under them. */
export interface LastFive {
  results: GameLetter[];
  /** "Lost 1 · last five 3–2", with the ties when there are any ("last five 3–1–1"). */
  line: Cell;
}

/** A probable starter and his season line. */
export interface ProbableStarter {
  playerId: Integer;
  name: string;
  /** "R. Castillo". */
  short: string;
  /** "7–4 · 3.21 ERA", or why there is none. */
  line: Cell;
}

/** The club's next game, as the export schedules it. */
export interface TonightGame {
  gameId: Integer;
  /** The game's date as OOTP wrote it. */
  gameDate: GameDate;
  /** "Tonight · 7:05 PM", "Tomorrow · 1:10 PM", "May 18 · 7:05 PM". */
  when: Cell;
  homeAway: 'home' | 'away';
  opponent: { teamId: Integer; name: string; abbr: string | null; record: Cell | null };
  /** "vs Colorado Rockies", "at Colorado Rockies". */
  matchup: Cell;
  /** Our probable starter, as OOTP projects him; null when it projects none (said in `starters`). */
  ours: ProbableStarter | null;
  theirs: ProbableStarter | null;
  /** Both starters on one line, or why they are not known. */
  starters: Cell;
  /** Where the game opens (the schedule and game plans). */
  open: Target;
  /** The game with its basis: the date, the time, the starters' source. */
  claim: Claim;
}

/** The trade deadline, only as the league's own row gives it. */
export interface DeadlineNote {
  /** The deadline as OOTP wrote it. */
  gameDate: GameDate;
  /** Days from the league's current day; negative once it has passed. */
  daysLeft: Integer;
  passed: boolean;
  /** "17 days", "Today", "Passed". */
  count: Cell;
  /** "to the deadline · August 3, 2026". */
  text: Cell;
  claim: Claim;
}

/** A part of the masthead the export cannot give. */
export type MastheadPart = 'record' | 'place' | 'runs' | 'lastFive' | 'streak' | 'tonight' | 'deadline';

export interface MissingPart {
  part: MastheadPart;
  /** One sentence: why it is not shown. */
  line: Cell;
}

/** The masthead's box score: objective facts only (D-060). */
export interface TeamSeason {
  kicker: MastheadKicker;
  /** "Won 26, lost 17", its `value.display` the figure ("26–17"); null when the standings lack it. */
  record: Claim | null;
  place: StandingLine | null;
  runs: RunsFigure | null;
  lastFive: LastFive | null;
  /** "Won 3", "Lost 1". */
  streak: Cell | null;
  tonight: TonightGame | null;
  deadline: DeadlineNote | null;
  /** Each part not shown, with why. */
  missing: MissingPart[];
}

/** Where a dimension falls: a strength (top fifth), a weakness (bottom fifth), the rest, too early, or not placed. */
export type ProfileGroup = 'strength' | 'weakness' | 'rest' | 'tooEarly' | 'notPlaced';

/**
 * A group's heading as "How we win and lose" shows it: its title ("Strengths") and the stated policy line beside it
 * ("Top fifth of the league"), each with its hint; `line` is null where the title says it all ("The rest"), so the
 * two never repeat each other.
 */
export interface ProfileGroupHeading {
  title: Cell;
  line: Cell | null;
}

/** The heading of each group, in the order the page shows them. */
export interface ProfileGroups {
  strength: ProfileGroupHeading;
  weakness: ProfileGroupHeading;
  rest: ProfileGroupHeading;
  tooEarly: ProfileGroupHeading;
  notPlaced: ProfileGroupHeading;
}

/**
 * The strip a dimension is drawn on: how many clubs it shows, and where the stated lines fall (a place at or above
 * `strengthThrough` is a strength, at or below `weaknessFrom` a weakness), in the same arithmetic that puts the
 * dimension in its group. Both lines are null in a league too small to have a top or bottom fifth.
 */
export interface ProfileStrip {
  /** The clubs the strip shows: the clubs placed, or, where our club is not, the clubs that have the figure (0 for none). */
  of: Integer;
  strengthThrough: Integer | null;
  weaknessFrom: Integer | null;
}

/** The legend under "How we win and lose"; `shading` is null when no strip shows a top or bottom fifth. */
export interface ProfileLegend {
  /** The filled dot (this season's place). */
  dot: Cell;
  /** The hollow ring (the recent place). */
  ring: Cell;
  /** The shaded ends (the top and bottom fifths). */
  shading: Cell | null;
}

/** A dimension's place over the recent games, or why it has none. */
export interface RecentPlace {
  place: Place | null;
  /** "Last 15: 9th", "Last 15: too few". */
  text: string;
  /** Why there is no recent place; null when there is one. */
  why: string | null;
}

/** One dimension of "How we win and lose". */
export interface ProfileDimension {
  id: string;
  /** "Scoring runs". */
  name: string;
  /** An SF Symbol's name. */
  symbol: string;
  /** The place among the clubs that have the figure; null when too early or not placed. */
  place: Place | null;
  /** "6th of 30", "T-26th of 30", "Too early", "Not placed". */
  placeText: string;
  /** The strip it is drawn on: its clubs and the stated lines, served so the app counts nothing. */
  strip: ProfileStrip;
  recent: RecentPlace;
  /** "4.63 runs a game · league middle 4.31". */
  detail: Cell;
  group: ProfileGroup;
  /** The place as a claim: its figure, the league's middle, the ties, the clubs left out, the policy line. */
  claim: Claim;
}

export interface ClubProfile {
  /** "Through May 15, 2026 · 43 games". */
  note: Cell;
  /** The clubs in the league; 0 when the profile could not be read. */
  clubs: Integer;
  /** Each group's heading. */
  groups: ProfileGroups;
  /** What the marks on a strip mean, for this league. */
  legend: ProfileLegend;
  dimensions: ProfileDimension[];
  /** Why the profile could not be read this time; null when it was. */
  unavailable: Cell | null;
}

/** Expected wins as the map draws them: the most likely value inside its range. */
export interface WinsValue {
  low: number;
  likely: number;
  high: number;
  unit: Unit;
  /** "Most likely 2.1 wins · could be 0.8 to 3.4". */
  text: string;
  /** "2.1 wins". */
  short: string;
}

export interface PlayerRef {
  playerId: Integer;
  name: string;
  /** "K. Marte". */
  short: string;
}

/** Player Development's answer on the farm's next man, in words. */
export type ReadinessState = 'ready' | 'notYet' | 'cantTell' | 'notAssessed';

export interface FarmNextMan extends PlayerRef {
  /** "Triple-A". */
  level: string;
  state: ReadinessState;
  /** "Ready for a look", "Not ready yet", "Can't tell yet", "Not assessed", with Player Development's reasons in its hint. */
  readiness: Cell;
  /** Player Development's readiness against the readiness its bar asks for, as it serves them; null where either is not known. */
  bar: FarmBar | null;
  /** "L. Moreau · Triple-A · not ready yet". */
  text: string;
}

/** The farm's next man's readiness against his bar, with the scale they are both on and the line that labels them. */
export interface FarmBar {
  readiness: Integer;
  required: Integer;
  /** The scale Player Development's readiness is on (0 to 100): a man past his bar is not a full bar. */
  scale: { low: Integer; high: Integer };
  /** "Readiness 41 · his bar 55", with how the two are read in its hint. */
  line: Cell;
}

/** How long the club controls a player, served structured (never parsed from words). */
export type ControlKind = 'through' | 'clock' | 'unknown';
export type ControlClock = 'arbitration' | 'freeAgentAfterSeason';

export interface ControlTerm {
  kind: ControlKind;
  /** "Through 2029", "Free agent after this season", "Arbitration this winter", "Control not known". */
  text: string;
  hint: string;
  /** The last season the club surely holds him; null when not known. */
  through: Integer | null;
  /** When the end is a range: the latest it could be; null otherwise. */
  latest: Integer | null;
  /** Seasons left counting this one, to `through`; null when not known. */
  seasonsLeft: Integer | null;
  /** `through` is the last season laid out, and control runs past it. */
  atLeast: boolean;
  clock: ControlClock | null;
}

/** How a node's holder was chosen: the most starts there lately in the club's game log, or the listed man where it is silent. */
export type HolderRule = 'starts' | 'listed';

/** One position on the roster map. */
export interface RosterNode {
  /** "C", "1B" ... "DH". */
  pos: string;
  /** "Catcher". */
  name: string;
  holder: PlayerRef | null;
  /** How the holder was chosen: the regular the club's game log shows, or its listed man where the log is silent; null with nobody. */
  holderRule: HolderRule | null;
  value: WinsValue | null;
  /** "2.1 wins", "Not valued". */
  valueText: string;
  /** His league place at the position; null when not valued. */
  place: Place | null;
  /** "7th of 30", "T-7th of 30", "Not placed". */
  placeText: string;
  /** How many other placed clubs' holders he is not separable from (half-time ranges meet); null when not placed. */
  overlap: Integer | null;
  /** How many other placed clubs' holders he is clearly ahead of, and clearly behind; null when not placed. */
  clearlyAhead: Integer | null;
  clearlyBehind: Integer | null;
  /** "Clearly ahead of 4 · not separable from 22 · clearly behind 3", "Not separable from the other 29", or why he is not placed. */
  overlapText: Cell;
  /** Who is behind him at the position. */
  behind: Cell;
  farmNext: FarmNextMan | null;
  /** The farm's next man in words, or who is not there ("Nobody in the farm listed at shortstop"). */
  farmText: Cell;
  control: ControlTerm;
  /** Major League Ops raised a need at the position. */
  need: boolean;
  /** The node with its basis. */
  claim: Claim;
}

/** A pitcher beside the map. */
export interface StaffPitcher {
  playerId: Integer;
  /** "Next", "2nd" ... for the rotation; "CL", "RP" for the bullpen. */
  role: string;
  name: string;
  short: string;
  /** "7–4 · 3.21 ERA". */
  line: Cell;
  value: WinsValue | null;
  /** "Next game", "IL · 12 days"; null when none. */
  note: Cell | null;
  /** What the range says, or why he is not valued. */
  hint: string;
  need: boolean;
  claim: Claim;
}

/** The scale every range on the map shares, in the values' unit (whole wins holding every range shown, and zero). */
export interface ValueScale {
  low: number;
  high: number;
  unit: Unit;
}

export interface RosterMap {
  positions: RosterNode[];
  /** Null when nothing on the map is valued: no diagram without a scale. */
  valueScale: ValueScale | null;
  rotation: StaffPitcher[];
  bullpen: StaffPitcher[];
  /** Major League Ops' needs at the rotation's or the bullpen's role that name no pitcher shown (a return, a short staff). */
  rotationNeeds: Cell[];
  bullpenNeeds: Cell[];
  /** What the map says about itself ("The league plays without a designated hitter"). */
  notes: Cell[];
  /** Why the map could not be read this time; null when it was. */
  unavailable: Cell | null;
}

/** The Morning Report's own parts, as the summary serves them. */
export interface MorningParts {
  teamSeason: TeamSeason | null;
  lede: Claim | null;
  clubProfile: ClubProfile | null;
  rosterMap: RosterMap | null;
}
