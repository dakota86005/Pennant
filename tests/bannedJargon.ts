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
 * The list was tuned on Player Value's pages and applies to every `/v2` string. A plain word the jargon list would
 * reject on one view ("PCT" in the standings column's glossary entry) gets a scoped exception (`JARGON_EXCEPTIONS`: one
 * phrase, one department and view, optionally one field, its case stated, one line saying why), never a weaker pattern:
 * the phrase is allowed there and only there, every other word of the same string is still checked, and no exception
 * ever exempts a verdict word ("waiver priority" stays out: "priority" is a verdict).
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

/** The rendering leaks alone: what no string the app can show may carry, a breakdown's included. */
export const RENDERING_LEAKS: readonly RegExp[] = [/\bnull\b/i, /\bundefined\b/i, /\bNaN\b/i];

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

/**
 * Where a shown string stands: a department and one of its views (`majorLeague` / `fortyManOptions`), or, for a payload
 * that is not a department's view, its own name and part (`catalog` / `glossary`). Never an operation alone: one
 * operation (the planned per-view endpoint) serves every department's views.
 */
export interface Surface {
  department: string;
  view: string;
}

/**
 * A phrase the jargon list would reject that is the plain word on one view: allowed there, in one shown field when
 * `field` is named, and nowhere else. It never exempts a verdict word (the verdict list is always read on the whole
 * string), and its case is stated: `ignoreCase: false` matches the phrase exactly as written.
 */
export interface JargonException {
  department: string;
  view: string;
  field?: (typeof SHOWN_FIELDS)[number];
  phrase: string;
  ignoreCase: boolean;
  /** One line: why this phrase is the plain word here. */
  reason: string;
}

export const JARGON_EXCEPTIONS: readonly JargonException[] = [
  { department: 'catalog', view: 'glossary', field: 'display', phrase: 'PCT', ignoreCase: false, reason: 'The standings column is PCT in OOTP and every box score; the glossary is where it is explained.' },
  { department: 'catalog', view: 'glossary', field: 'text', phrase: 'Fielding Independent Pitching', ignoreCase: false, reason: "FIP's own name, spelled out where the statistic is explained." },
  { department: 'catalog', view: 'stats', field: 'text', phrase: 'Fielding Independent Pitching', ignoreCase: false, reason: "FIP's own name, spelled out where the statistic is explained." },
];

/**
 * Each `/v2` operation's surface for a shown string at a path, from the request's parameters when it has them (the
 * per-view endpoint: `{ department: params.dept, view: params.view }`). An operation not listed has no surface, so no
 * exception applies to it.
 */
export const SURFACES: Readonly<Record<string, (path: string, params: Readonly<Record<string, string>>) => Surface | null>> = {
  getCatalog: (path) => {
    const part = /^\$\.([A-Za-z0-9_]+)/.exec(path)?.[1];
    return part ? { department: 'catalog', view: part } : null;
  },
  getDataStatusWords: () => ({ department: 'frontOffice', view: 'dataStatus' }),
};

/** Where a shown string stands and which field it is, for the exceptions. */
export interface Placement {
  surface: Surface;
  field?: string;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const applies = (e: JargonException, at: Placement): boolean =>
  e.department === at.surface.department && e.view === at.surface.view && (e.field === undefined || e.field === at.field);

/** The text with the phrases excepted here taken out, so the rest of it is still read against the jargon list. */
export function withoutExceptions(text: string, at: Placement | undefined, exceptions: readonly JargonException[] = JARGON_EXCEPTIONS): string {
  if (!at) return text;
  let out = text;
  for (const e of exceptions) {
    if (applies(e, at)) out = out.replace(new RegExp(`(?<![\\w-])${escape(e.phrase)}(?![\\w-])`, e.ignoreCase ? 'gi' : 'g'), ' ');
  }
  return out;
}

const JARGON = new Set<RegExp>(BANNED_JARGON);

/**
 * The banned patterns a text contains (empty when it reads clean). Where it is placed, that place's exceptions are
 * taken out before the jargon list is read; every other list (the verdicts) is read on the whole string.
 */
export function bannedIn(
  text: string,
  lists: ReadonlyArray<readonly RegExp[]> = [BANNED_JARGON],
  at?: Placement,
  exceptions: readonly JargonException[] = JARGON_EXCEPTIONS,
): RegExp[] {
  const stripped = withoutExceptions(text, at, exceptions);
  return lists.flat().filter((pattern) => pattern.test(JARGON.has(pattern) ? stripped : text));
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

/**
 * Every sentence of a claim's basis (its evidence lines, "not known", "would change if" and the lean), with where it
 * sits. The basis is the breakdown, where a method word may help, so it is held to the verdicts and the rendering
 * leaks, not the jargon list (AGENTS.md "Writing for the GM").
 */
export function basisStrings(payload: unknown): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = [];
  const collect = (node: unknown, path: string): void => {
    if (typeof node === 'string') found.push({ path, text: node });
    else if (Array.isArray(node)) node.forEach((item, i) => collect(item, `${path}[${i}]`));
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) collect(v, `${path}.${k}`);
  };
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) node.forEach((item, i) => walk(item, `${path}[${i}]`));
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'basis' && value && typeof value === 'object') {
          const b = value as Record<string, unknown>;
          for (const field of ['because', 'unknown', 'wouldChange', 'lean']) collect(b[field], `${path}.basis.${field}`);
        } else walk(value, `${path}.${key}`);
      }
    }
  };
  walk(payload, '$');
  return found;
}

/**
 * Each shown string in a payload that carries a banned word or verdict, with the pattern it matched. Given the
 * operation (and the request's parameters), each string is placed on its surface and field, and that place's
 * exceptions are allowed.
 */
export function bannedInPayload(
  payload: unknown,
  operationId?: string,
  exceptions: readonly JargonException[] = JARGON_EXCEPTIONS,
  params: Readonly<Record<string, string>> = {},
): Array<{ path: string; text: string; pattern: string }> {
  const place = (path: string): Placement | undefined => {
    const surface = operationId ? SURFACES[operationId]?.(path, params) : null;
    return surface ? { surface, field: /\.([A-Za-z]+)$/.exec(path)?.[1] } : undefined;
  };
  const shown = shownStrings(payload).flatMap(({ path, text }) =>
    bannedIn(text, [BANNED_JARGON, BANNED_VERDICTS], place(path), exceptions).map((pattern) => ({ path, text, pattern: String(pattern) })),
  );
  const basis = basisStrings(payload).flatMap(({ path, text }) =>
    bannedIn(text, [BANNED_VERDICTS, RENDERING_LEAKS]).map((pattern) => ({ path, text, pattern: String(pattern) })),
  );
  return [...shown, ...basis];
}

/** The exceptions a payload actually leans on (a phrase present where it applies), so a stale one can be found. */
export function exceptionsUsed(
  payload: unknown,
  operationId: string,
  exceptions: readonly JargonException[] = JARGON_EXCEPTIONS,
  params: Readonly<Record<string, string>> = {},
): JargonException[] {
  return exceptions.filter((e) =>
    shownStrings(payload).some(({ path, text }) => {
      const surface = SURFACES[operationId]?.(path, params);
      if (!surface) return false;
      const at = { surface, field: /\.([A-Za-z]+)$/.exec(path)?.[1] };
      return applies(e, at) && withoutExceptions(text, at, [e]) !== text;
    }),
  );
}
