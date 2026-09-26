import { describe, expect, it } from 'vitest';
import { timestampWords } from '../server/timeWords.js';

/** One served form for a time (review N6): the Mac app shows the server's words and never formats a time itself. */
describe('a served time in words', () => {
  it('writes an ISO time as a US English date and time, and leaves a missing or unreadable one unwritten', () => {
    expect(timestampWords('2040-07-01T12:00:00.000Z')).toMatch(/^Jul 1, 2040, \d{1,2}:\d{2}\s?[AP]M$/);
    expect(timestampWords(null)).toBeNull();
    expect(timestampWords('yesterday')).toBeNull();
  });
});
