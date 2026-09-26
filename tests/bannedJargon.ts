/**
 * The words the GM never reads in visible text (AGENTS.md "Writing for the GM", D-056): one list for every page test
 * and for every string the Mac app can show (`text`, `hint` and `display` in a `/api/v2` payload). A method word, a
 * doc id, a column name or a rendering leak may stand in a hover or a breakdown where it helps, never on the face.
 *
 * It replaced the per-page copies (Contracts, Free Agents, Payroll, the Trade Center, the value section, the roster,
 * the lineup, the player card, Org Comparison and the yardsticks line); each page now checks all of it. A word added
 * here is banned everywhere at once. A page's own rule that is not about jargon (Org Comparison states no rank) stays
 * in its test. The String Catalog check in the Mac app reads the same list (N3).
 *
 * Three patterns are marginally narrower than a page's old copy, accepted at N2: "pays for talent" (the philosophy's
 * lean) is allowed, `\bOff Value\b` no longer matches "Off Values", and a doc id needs a word boundary ("AD-012" passes).
 * The list was tuned on Player Value's pages and now applies to every `/v2` string; before department copy moves (N8),
 * plain words it would reject ("Win Pct", "prior season", "waiver priority") need a scoped exception, not a weaker
 * pattern.
 */

/** Method words, internal names and rendering leaks. */
export const BANNED_JARGON: readonly RegExp[] = [
  // Percentiles and OOTP's own valuation, which the pages no longer show (D-017, D-052)
  /percentile/i, /\bpct\b/i, /players_value/i, /overall_value/i, /OOTP's own/i, /offensive value/i, /\bOff Value\b/i,
  // OOTP's "Talent" figure; the philosophy's lean "pays for talent" is a plain phrase, not the figure
  /(?<!pays for )\btalent\b/i, /\bOA\b/i, /\bPOT\b/i, /OA→POT/, /Overall/, /Potential/,
  // Player Value's method words (the value section, Contracts, Payroll, the Trade Center)
  /\bcentrals?\b/i, /retention/i, /surplus/i, /edge against edge/i, /\bedges?\b/i, /\bindependent\b/i, /\bband\b/i,
  /\bladder\b/i, /\bclass \d/i, /if held/i, /\bpre-arb\b/i, /\barb\b/i, /range of reasonable readings/i,
  /export's replacement level/i, /discounted like the dollars/i,
  // Calibration's method words (the yardsticks line)
  /calibrat/i, /\bprovisional\b/i, /\bprior\b/i, /\bgate\b/i, /held-out/i, /coverage/i, /quantile/i,
  // The evidence vocabulary: said in plain words on the face ("not known"), never by its code
  /indeterminate/i,
  // Doc ids (D-, Q-, R-, A-numbers)
  /\b[DQRA]-\d/i,
  // Rendering leaks
  /\bnull\b/i, /\bundefined\b/i, /\bNaN\b/i,
];

/**
 * Verdict words: the application describes and the GM decides (D-001), so no page tells him what to do or how a deal
 * came out. The union of the pages' lists (Contracts, Free Agents, the Trade Center, the trade reading). A word that is
 * a verdict on one page only stays in that page's test ("target" on Free Agents; the Trade Center loads OOTP's targets).
 */
export const BANNED_VERDICTS: readonly RegExp[] = [
  /\b(?:win|wins|won|lose|loses|lost|winning|losing)\s+(?:the|this)\s+(?:trade|deal)\b/i,
  /\baccept\w*/i, /\breject\w*/i, /\bshould\b/i, /\bmust\b/i, /\brecommend\w*/i, /\bfair\b/i, /\bunfair\b/i,
  /\bsteal\b/i, /\bfleec\w*/i, /\brip-?off\b/i, /\bgood deal\b/i, /\bbad deal\b/i, /\boverpa(?:y|id)\b/i, /\bbargain\b/i,
  /\bpriority\b/i, /\bpass on\b/i, /\bavoid him\b/i, /\bsign(?:ing)? (?:him|now|them)\b/i,
  /\bextend (?:him|now)\b/i, /\bextension candidate\b/i, /\bre-sign\b/i, /\blet (?:him )?walk\b/i,
  /\brelease candidate\b/i, /\bcore keeper\b/i, /\bhold off\b/i, /\bconsider moving\b/i, /\bwatch decline\b/i,
  /\bmarket-dependent\b/i,
];

/** The banned patterns a text contains (empty when it reads clean). */
export function bannedIn(text: string, lists: ReadonlyArray<readonly RegExp[]> = [BANNED_JARGON]): RegExp[] {
  return lists.flat().filter((pattern) => pattern.test(text));
}

/** The fields of a `/api/v2` payload the Mac app shows as text (a `Claim`'s line and help tag, a value's or cell's display). */
export const SHOWN_FIELDS = ['text', 'hint', 'display'] as const;

/** Every shown string in a payload, with where it sits (`$.sections[2].claims[0].text`). */
export function shownStrings(payload: unknown): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        const at = `${path}.${key}`;
        if ((SHOWN_FIELDS as readonly string[]).includes(key) && typeof value === 'string') found.push({ path: at, text: value });
        else walk(value, at);
      }
    }
  };
  walk(payload, '$');
  return found;
}

/** Each shown string in a payload that carries a banned word or verdict, with the pattern it matched. */
export function bannedInPayload(payload: unknown): Array<{ path: string; text: string; pattern: string }> {
  return shownStrings(payload).flatMap(({ path, text }) =>
    bannedIn(text, [BANNED_JARGON, BANNED_VERDICTS]).map((pattern) => ({ path, text, pattern: String(pattern) })),
  );
}
