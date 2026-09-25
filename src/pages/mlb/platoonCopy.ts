/** The platoon read's one visible line, in plain words; the reasons below it say why. */
export function platoonHeadline(p: { verdict: string; weakSide?: string | null; drivers?: { league: number | null } | null }): string {
  if (p.verdict === 'problem') return `Weak against ${p.weakSide === 'L' ? 'left' : 'right'}-handers.`;
  if (p.verdict === 'no_issue') return 'No platoon problem.';
  // No usual split for his hand in this league: the read cannot be judged however much of his own record there is
  if (p.drivers && p.drivers.league === null) return "Can't judge a platoon split: the usual split for his hand isn't known in this league.";
  return 'Not enough to read a platoon split.';
}
