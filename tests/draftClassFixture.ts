import { db } from '../server/db.js';
import { insert, type BuiltSave } from './syntheticSave';

/** The first player id of the draft class `addDraftClass` adds. */
export const CLASS = 90000;

/**
 * A draft class for the synthetic save (it has none; N12 Track B): 30 amateurs flagged for its draft, one already
 * drafted and one in another league's draft; a hitter and a pitcher whose ceiling our scouts haven't graded in full, and
 * a pitcher not graded in full now. The scouting tests read it, and the contract captures the published board on it.
 */
export function addDraftClass(save: BuiltSave): void {
  let id = CLASS;
  for (let i = 0; i < 30; i += 1) {
    const pitcher = i % 3 === 0;
    insert('players', { player_id: id, first_name: 'Draft', last_name: `Kid${i}`, age: 17 + (i % 6), position: pitcher ? 1 : 2 + (i % 9), role: 0, bats: 1 + (i % 3), throws: 1 + (i % 2), team_id: 0, organization_id: 0, retired: 0, hidden: 0, draft_eligible: 1, college: i % 2, picked_in_draft: i === 29 ? 1 : 0, draft_league_id: i === 28 ? 555 : save.leagueId });
    if (pitcher) insert('players_pitching', { player_id: id, pitching_ratings_overall_stuff: 30 + i, pitching_ratings_overall_movement: 35, pitching_ratings_overall_control: i === 3 ? 0 : 40, pitching_ratings_talent_stuff: 50 + i, pitching_ratings_talent_movement: 55, pitching_ratings_talent_control: i === 6 ? 0 : 50 });
    else insert('players_batting', { player_id: id, batting_ratings_overall_contact: 30 + i, batting_ratings_overall_gap: 40, batting_ratings_overall_power: 35, batting_ratings_overall_eye: 40, batting_ratings_overall_strikeouts: 40, batting_ratings_talent_contact: 50 + i, batting_ratings_talent_gap: 55, batting_ratings_talent_power: i === 4 ? 0 : 60, batting_ratings_talent_eye: 50, batting_ratings_talent_strikeouts: 50 });
    id += 1;
  }
}

/** Takes the class out again, so what is read afterwards is the synthetic save as it was. */
export function removeDraftClass(): void {
  for (const table of ['players', 'players_pitching', 'players_batting']) db.prepare(`DELETE FROM ${table} WHERE player_id >= ? AND player_id < ?`).run(CLASS, CLASS + 30);
}
