/**
 * Player Value, the club's value of a win (D-052 "two prices of a win"; PLAYER_VALUE.md Part 4.5).
 *
 * Pure. The league's market price of a win is what a win costs to buy; this is the other price: what one more win is
 * worth to THIS club now, from its competitive position. It was read on the deadline read's odds model (`posture.ts`)
 * until the owner retired that model from Player Value (2026-10-28, D-060 amended): the odds are the staff's rough read
 * for Standings, not evidence a value may rest on. Nothing in D-052 or D-036 replaces it, so it is not established
 * (D-018): it is said so, with the reason, and never a number, a default or a level race. ROADMAP "Playoff odds from the
 * roster" is what could establish it.
 *
 * It was context beside the value, never part of it, and it remains so: it enters neither the neutral surplus nor our view.
 */

export interface ClubWinValue {
  teamId: number;
  club: string | null;
  /** Always `unknown`: no model of the club's competitive position establishes it (D-060, amended 2026-10-28). */
  status: 'unknown';
  reason: string;
  /** One plain sentence. */
  text: string;
  basis: string[];
}

/** Why it is not established, in one sentence: what a win is worth to the club depends on a model Pennant doesn't have. */
export const WIN_VALUE_NOT_ESTABLISHED =
  "What one more win is worth to the club depends on its chances in the race, and Pennant has no model of those it relies on yet.";

const BASIS = [
  'The league\'s market price of a win (what a win costs to buy) is known where the save measures it; this is the other price: what one more win is worth to this club now.',
  'It used to be read on the staff\'s rough read of the season. That read is shown in Standings only and is not evidence a value rests on, so nothing reads it here.',
  'Context beside the value, never part of it: it enters neither the contract value nor the value of keeping him.',
];

/** The club's value of a win now: not established, with its reason (never a number, a default or a level race). */
export function winValueOf(input: { teamId: number; club: string | null }): ClubWinValue {
  const { teamId, club } = input;
  // "the Arizona Diamondbacks'", "the Boston Red Sox's", "this club's"
  const whose = club ? `the ${club}${club.endsWith('s') ? "'" : "'s"}` : "this club's";
  const Whose = `${whose.charAt(0).toUpperCase()}${whose.slice(1)}`;
  return {
    teamId, club, status: 'unknown', reason: WIN_VALUE_NOT_ESTABLISHED,
    text: `${Whose} value of a win now isn't established: ${WIN_VALUE_NOT_ESTABLISHED.charAt(0).toLowerCase()}${WIN_VALUE_NOT_ESTABLISHED.slice(1)}`,
    basis: BASIS,
  };
}
