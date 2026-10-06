/**
 * The general check of the OSA mark, shared by the tests that build each department's payloads.
 */
/**
 * The general check of the OSA mark (D-067, N11, review M4): every place in a served payload that names a player (his
 * `playerId`, or a row's `player`) and shows one of his grades, or rests on them, with whether it carries the mark
 * (`ratingsFill`). A target (`{ kind: 'player', playerId }`) only names him.
 */
// N9's clubhouse tools: a pitcher's stamina, a roster's scouted grade and each rating (`rating.<id>`), the depth's ceiling
const GRADE_CELLS = new Set(['ratings', 'current', 'grade', 'estimate', 'bat', 'glove', 'run', 'tools', 'canPlay', 'fit', 'against', 'stamina', 'scouted', 'ceiling']);
const GRADE_CELL_PREFIXES = ['rating.'];
const GRADE_FIELDS = ['first', 'latest', 'snapshots'];
/** The fill's sentence (`OSA_FILL_WORDS`): a cell or line of his that says it rests on his grades. */
const FILL_SENTENCE = /OSA's view/;

/** Whether one of his own cells (his row's cells, or a cell he carries directly, such as a depth entry's line) says so. */
function saysFilled(o: Record<string, unknown>): boolean {
  const own = [...Object.values((o.cells ?? {}) as Record<string, unknown>), ...Object.values(o)];
  return own.some((c) => !!c && typeof c === 'object' && typeof (c as { hint?: unknown }).hint === 'string' && FILL_SENTENCE.test((c as { hint: string }).hint));
}

function showsGrades(o: Record<string, unknown>): boolean {
  const cells = (o.cells ?? {}) as Record<string, unknown>;
  if (Object.keys(cells).some((k) => GRADE_CELLS.has(k) || GRADE_CELL_PREFIXES.some((p) => k.startsWith(p)))) return true;
  if (GRADE_FIELDS.some((k) => k in o)) return true;
  if (saysFilled(o)) return true;
  // A fact or a fact row whose label says it is a scouted grade ("Scouted now → ceiling")
  return Array.isArray(o.facts) && /"(?:display|label)":"Scouted/.test(JSON.stringify(o.facts));
}

export function gradeOwners(payload: unknown, at: string): Array<{ path: string; marked: boolean }> {
  const out: Array<{ path: string; marked: boolean }> = [];
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const names = typeof o.playerId === 'number' || typeof (o.player as { playerId?: unknown } | null | undefined)?.playerId === 'number';
    if (names && typeof o.kind !== 'string' && showsGrades(o)) out.push({ path, marked: Boolean(o.ratingsFill) });
    for (const [k, x] of Object.entries(o)) walk(x, `${path}.${k}`);
  };
  walk(payload, at);
  return out;
}
