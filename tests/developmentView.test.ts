import { describe, expect, it } from 'vitest';
import {
  biggestDevelopmentChangeIds,
  initialDevelopmentView,
  peerDevelopmentLabel,
  scoutedDevelopmentSummary,
  type DevelopmentViewItem,
} from '../src/pages/Development.js';

describe('Scouted Development presentation rules', () => {
  it('never describes insufficient peer evidence as typical', () => {
    const summary = scoutedDevelopmentSummary(
      'improving',
      3,
      'insufficient'
    );

    expect(summary).toMatch(/insufficient|building/i);
    expect(summary).not.toMatch(/typical/i);

    const badge = peerDevelopmentLabel('insufficient', null);
    expect(badge).toMatch(/building|insufficient/i);
    expect(badge).not.toMatch(/typical/i);
  });

  it('reports only the players actually available in Biggest Changes', () => {
    const items: DevelopmentViewItem[] = [
      { playerId: 1, peerPace: 'insufficient', compositeChange: 4 },
      { playerId: 2, peerPace: 'insufficient', compositeChange: -2 },
      { playerId: 3, peerPace: 'insufficient', compositeChange: 1 },
      { playerId: 4, peerPace: 'insufficient', compositeChange: 0 },
    ];

    expect(biggestDevelopmentChangeIds(items)).toEqual([1, 2, 3]);
  });

  it('opens immature two-snapshot data on a populated useful view', () => {
    const twoSnapshotPlayers: DevelopmentViewItem[] = [
      { playerId: 1, peerPace: 'insufficient', compositeChange: 3 },
      { playerId: 2, peerPace: 'insufficient', compositeChange: -1 },
    ];

    expect(initialDevelopmentView(twoSnapshotPlayers)).toBe('changes');
    expect(
      initialDevelopmentView([
        { playerId: 3, peerPace: 'insufficient', compositeChange: 0 },
      ])
    ).toBe('all');
  });

  it('keeps Ahead as the initial view when mature results exist', () => {
    expect(
      initialDevelopmentView([
        { playerId: 1, peerPace: 'ahead', compositeChange: 2 },
        { playerId: 2, peerPace: 'insufficient', compositeChange: -5 },
      ])
    ).toBe('ahead');
  });
});
