/**
 * The start-up's own work, held back until the app's first answers are out (N6 polish: "launch to the kept report in
 * 1 s" on a 1.1 GB league).
 *
 * A start used to do its looks and upkeep in front of everything: in the ready line's turn (the history's key, which
 * reads every player's name, and the baseline snapshot) and in the turns right after it (the look at the saves, the
 * market record's check, the refit's check, the Front Office warm-up), about 400 ms on the owner's league, while the
 * Mac app's first three requests (the status, the settings, the clubs: what it needs to draw the report it kept)
 * waited behind them. None of that work is needed to answer those three. So it is queued here and run once those three
 * have been answered, or after `START_WORK_DELAY_MS` for a client that never
 * asks (the Electron app, a script), whichever comes first; each job in its own turn, in the order it was queued, so
 * a request that arrives meanwhile is answered between two jobs.
 *
 * Nothing here decides anything: it only moves when the existing start-up work runs.
 */
import type { NextFunction, Request, Response } from 'express';

/** How long the start-up's work waits for the app's first requests at most. */
export const START_WORK_DELAY_MS = 1_500;

type Job = { name: string; run: () => void };

let queue: Job[] = [];
let released = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let startedAt = 0;

/** Queues a piece of the start-up's work, or runs it on the next turn when the start-up's work is under way. */
export function afterFirstAnswers(name: string, run: () => void): void {
  if (released) {
    setImmediate(() => runJob({ name, run }));
    return;
  }
  queue.push({ name, run });
}

function runJob(job: Job): void {
  try {
    job.run();
  } catch (err) {
    console.error(`[server] the start-up's ${job.name} failed:`, err);
  }
}

/** Runs the queued work, one job a turn. Called once; later calls do nothing. */
export function releaseStartupWork(why: string): void {
  if (released) return;
  released = true;
  if (timer) clearTimeout(timer);
  timer = null;
  if (process.env.OOTP_FO_LOG_START === '1') console.log(`[server] start-up work begins ${Math.round(performance.now() - startedAt)} ms after listening (${why})`);
  const jobs = queue;
  queue = [];
  const next = (): void => {
    const job = jobs.shift();
    if (!job) return;
    runJob(job);
    setImmediate(next);
  };
  setImmediate(next);
}

/** Starts the fallback clock when the server starts listening. */
export function startupWorkClock(delayMs = START_WORK_DELAY_MS): void {
  startedAt = performance.now();
  if (released || timer) return;
  timer = setTimeout(() => releaseStartupWork('no client asked'), delayMs);
  timer.unref?.();
}

/** The requests the Mac app needs answered to draw the report it kept: the status, then the settings and the clubs. */
const FIRST_ANSWERS = ['/status', '/settings', '/orgs'];
let answered = new Set<string>();

/**
 * Express middleware (on `/api`): once the status, the settings and the clubs have each been answered, the start-up's
 * work begins.
 */
export function releaseAfterFirstAnswers(req: Request, res: Response, next: NextFunction): void {
  if (!released && req.method === 'GET' && FIRST_ANSWERS.includes(req.path)) {
    const path = req.path;
    res.once('finish', () => {
      answered.add(path);
      if (FIRST_ANSWERS.every((p) => answered.has(p))) releaseStartupWork('the first answers are out');
    });
  }
  next();
}

/** For tests: back to a fresh start. */
export function resetStartupWork(): void {
  queue = [];
  answered = new Set();
  released = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Whether the start-up's work has begun (for tests and the log). */
export function startupWorkReleased(): boolean {
  return released;
}
