/**
 * Pennant outside its windows, served (N14, Stage A, D-075): the glance the desktop widget and the menu bar extra show,
 * and the list the Mac app puts in Spotlight. Both are read from what the server already keeps per import: the glance
 * from the club's Front Office summary (built once per import in its worker), the list from the search index (built
 * once per import). Nothing here is a new judgment; every word is the Morning Report's or the search's.
 */
import { frontOfficeSummaryNow } from './frontOfficeAttention.js';
import { importedAt } from './playerStateRoutes.js';
import { servedDepartments } from './presentation/catalog.js';
import type { DeptId } from './contract/presentation.js';
import { glanceWords, type Glance } from './presentation/frontOffice/glance.js';
import { spotlightWords, type SpotlightList } from './presentation/spotlightWords.js';
import { searchIndex } from './search.js';

/** The glance for a club (`GET /api/v2/glance/:org`), from its summary as served. */
export async function glanceNow(orgId: number): Promise<Glance> {
  const summary = await frontOfficeSummaryNow(orgId);
  const names = new Map<DeptId, string>(servedDepartments(null).map((d) => [d.id, d.name]));
  return glanceWords(summary, (id) => names.get(id) ?? id);
}

/** The list Spotlight is given for a club (`GET /api/v2/spotlight/:org`). */
export function spotlightNow(orgId: number): SpotlightList {
  const importStamp = importedAt.value;
  return spotlightWords(searchIndex(importStamp).entries, orgId, importStamp);
}
