import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveLogError, openLiveSnapshot, withLiveSnapshot } from '../server/liveLogSnapshot.js';
import { fingerprint, link, makeSave, tx, type FakeSave } from './liveLogFixture';

/**
 * The live database belongs to OOTP and may be mid-write. These pin down that
 * it is only ever copied and never opened in place, that a consistent copy is
 * insisted on, and that nothing of OOTP's is written or left behind.
 */

const saves: FakeSave[] = [];
const roots: string[] = [];
const save = (opts?: Parameters<typeof makeSave>[0]): FakeSave => {
  const s = makeSave(opts);
  saves.push(s);
  return s;
};
const tempRoot = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-snap-root-'));
  roots.push(dir);
  return dir;
};
const leftovers = (root: string) => fs.readdirSync(root).filter((n) => n.startsWith('pennant-ootp-log-'));

afterEach(() => {
  for (const s of saves.splice(0)) s.cleanup();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

const row = (n: number) => ({ date: '20300531', text: tx.released([n, `Player ${n}`], 'RP') });
const count = (db: { prepare: (s: string) => { get: () => unknown } }) =>
  (db.prepare('SELECT COUNT(*) AS n FROM team_transactions').get() as { n: number }).n;

describe('safe live-database snapshot', () => {
  it('reads rows that exist only in the WAL while OOTP still has the database open', () => {
    const s = save({ rows: [row(1)], keepWriterOpen: true });
    s.add([row(2), row(3)]); // in the WAL, not yet in the main file
    expect(fs.existsSync(s.files.wal)).toBe(true);
    expect(fs.existsSync(s.files.shm)).toBe(true);

    const root = tempRoot();
    const snap = openLiveSnapshot(s.files, { tempRoot: root, requiredTables: ['team_transactions'] });
    expect(count(snap.db)).toBe(3);
    expect(snap.meta.walCopied).toBe(true);
    expect(snap.meta.shmPresent).toBe(true);
    snap.close();
  });

  it('reads a checkpointed database that has no WAL and no SHM', () => {
    const s = save({ rows: [row(1), row(2)] });
    expect(fs.existsSync(s.files.wal)).toBe(false);
    expect(fs.existsSync(s.files.shm)).toBe(false);

    const root = tempRoot();
    const snap = openLiveSnapshot(s.files, { tempRoot: root });
    expect(count(snap.db)).toBe(2);
    expect(snap.meta.walCopied).toBe(false);
    expect(snap.meta.shmPresent).toBe(false);
    snap.close();
  });

  it('does not copy the SHM: it is rebuilt from the copied WAL', () => {
    const s = save({ rows: [row(1)], keepWriterOpen: true });
    s.add([row(2)]);
    const root = tempRoot();
    let seenInCopy: string[] = [];
    const snap = openLiveSnapshot(s.files, {
      tempRoot: root,
      afterCopy: () => {
        seenInCopy = fs.readdirSync(path.join(root, leftovers(root)[0]));
      },
    });
    expect(seenInCopy.some((n) => n.endsWith('-shm'))).toBe(false);
    expect(count(snap.db)).toBe(2);
    snap.close();
  });

  it('retries when the source changes mid-copy, and reports how many attempts it took', () => {
    const s = save({ rows: [row(1)], keepWriterOpen: true });
    let mutated = false;
    const root = tempRoot();
    const snap = openLiveSnapshot(s.files, {
      tempRoot: root,
      retryDelayMs: 0,
      afterCopy: () => {
        // OOTP writes between the copy and the check, on the first attempt only
        if (!mutated) {
          mutated = true;
          s.add([row(2)]);
        }
      },
    });
    expect(snap.meta.attempts).toBe(2);
    expect(count(snap.db)).toBe(2); // the retry saw the newer state
    snap.close();
    expect(leftovers(root)).toEqual([]);
  });

  it('gives up with a torn-snapshot error when the source never holds still', () => {
    const s = save({ rows: [row(1)], keepWriterOpen: true });
    let n = 10;
    const root = tempRoot();
    expect(() =>
      openLiveSnapshot(s.files, {
        tempRoot: root,
        attempts: 3,
        retryDelayMs: 0,
        afterCopy: () => s.add([row(n++)]),
      })
    ).toThrowError(expect.objectContaining({ code: 'torn', attempts: 3 }));
    expect(leftovers(root)).toEqual([]);
  });

  it('reports a missing database as unavailable without retrying', () => {
    const s = save({ withLog: false });
    expect(() => openLiveSnapshot(s.files, { tempRoot: tempRoot() })).toThrowError(
      expect.objectContaining({ code: 'not_found' })
    );
  });

  it('rejects a file that is not a database, and a database without the required table', () => {
    const s = save({ rows: [row(1)] });
    const root = tempRoot();
    expect(() =>
      openLiveSnapshot(s.files, { tempRoot: root, requiredTables: ['no_such_table'], attempts: 2, retryDelayMs: 0 })
    ).toThrowError(expect.objectContaining({ code: 'invalid' }));

    fs.writeFileSync(s.files.db, Buffer.alloc(4096, 0x41));
    let thrown: unknown;
    try {
      openLiveSnapshot(s.files, { tempRoot: root, attempts: 2, retryDelayMs: 0 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(LiveLogError);
    expect((thrown as LiveLogError).code).toBe('invalid');
    expect(leftovers(root)).toEqual([]);
  });

  it('never writes to, adds to, or changes anything in the save', () => {
    const s = save({ rows: [row(1)], keepWriterOpen: true });
    s.add([row(2)]);
    // Make the whole save read-only: a reader that tried to write would fail
    const before = fingerprint(s.root);
    const root = tempRoot();
    fs.chmodSync(s.files.tempDir, 0o555);
    for (const f of [s.files.db, s.files.wal, s.files.shm]) fs.chmodSync(f, 0o444);
    try {
      const n = withLiveSnapshot(s.files, (snap) => count(snap.db), { tempRoot: root });
      expect(n).toBe(2);
    } finally {
      fs.chmodSync(s.files.tempDir, 0o755);
      for (const f of [s.files.db, s.files.wal, s.files.shm]) fs.chmodSync(f, 0o644);
    }
    expect(fingerprint(s.root)).toEqual(before);
  });

  it('removes its copy on close, and closing twice is harmless', () => {
    const s = save({ rows: [row(1)] });
    const root = tempRoot();
    const snap = openLiveSnapshot(s.files, { tempRoot: root });
    expect(leftovers(root)).toHaveLength(1);
    snap.close();
    snap.close();
    expect(leftovers(root)).toEqual([]);
  });

  it('cleans up even when the work done with a snapshot throws', () => {
    const s = save({ rows: [row(1)] });
    const root = tempRoot();
    expect(() =>
      withLiveSnapshot(s.files, () => {
        throw new Error('boom');
      }, { tempRoot: root })
    ).toThrow('boom');
    expect(leftovers(root)).toEqual([]);
  });

  it('only ever deletes directories it created', () => {
    const s = save({ rows: [row(1)] });
    const root = tempRoot();
    const bystander = path.join(root, 'someone-elses-data');
    fs.mkdirSync(bystander);
    fs.writeFileSync(path.join(bystander, 'keep.txt'), 'x');
    withLiveSnapshot(s.files, () => undefined, { tempRoot: root });
    expect(fs.existsSync(path.join(bystander, 'keep.txt'))).toBe(true);
  });

  it('copes with rows that hold nothing but a name link', () => {
    const s = save({ rows: [{ date: '20300531', text: link.player(5, 'Only A Link') }] });
    withLiveSnapshot(s.files, (snap) => expect(count(snap.db)).toBe(1), { tempRoot: tempRoot() });
  });
});
