import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request, { post } from './request.js';
import { DATA_DIR } from '../server/config.js';
import { allKeyStatus, clearApiKey, getApiKey, saveApiKey, setSecretCrypto } from '../server/settings.js';

/**
 * Saving a setting, which sounds too simple to be worth a test.
 *
 * It is here because it was not. The handler copied fields across by hand, and
 * the two switches added later were never added to it: the request answered
 * 200, the switch moved, and nothing was written — so the preference came back
 * off at the next launch. The shipped rounding toggle had this fault for four
 * releases. Every boolean is checked here rather than the two that were
 * missed, so the next one added cannot be forgotten quietly.
 */

const booleans = async (): Promise<string[]> => {
  const { settings } = await request('/api/settings');
  return Object.keys(settings).filter((k) => typeof settings[k] === 'boolean');
};

describe('POST /settings', () => {
  it('has switches to save', async () => {
    expect((await booleans()).length).toBeGreaterThan(0);
  });

  it('writes every switch, and reads it back the same', async () => {
    for (const field of await booleans()) {
      const before = (await request('/api/settings')).settings[field] as boolean;

      const flipped = (await post('/api/settings', { [field]: !before })).settings[field];
      expect(flipped, `${field} came back unchanged from the save`).toBe(!before);

      const reread = (await request('/api/settings')).settings[field];
      expect(reread, `${field} did not survive being read again`).toBe(!before);

      await post('/api/settings', { [field]: before });
    }
  });

  it('leaves a switch alone when the request does not mention it', async () => {
    const before = (await request('/api/settings')).settings;
    const after = (await post('/api/settings', { theme: before.theme })).settings;
    for (const field of await booleans()) expect(after[field]).toBe(before[field]);
  });
});

/**
 * A key saved from the Settings screen of the Electron build or `npm run dev` lives in `credentials.json`, encrypted by
 * the OS where it can be. An earlier build kept its last four characters in plain text beside the encrypted value; the
 * hint is now read from the key when the status is asked for, so no character of an encrypted key is on disk (B-101,
 * batch 7 review L3).
 */
describe('a key saved to the data folder', () => {
  const KEY = 'AIzaSyTheGeminiKeyEndsIn7Q4z';
  const file = path.join(DATA_DIR, 'credentials.json');
  let before: string | null;
  let envKey: string | undefined;
  // A stand-in for the OS's encryption: reversible, and keeps no character of the key in the clear
  const sealed = (plain: string): string => Buffer.from(plain).toString('base64').split('').reverse().join('');
  const opened = (cipher: string): string => Buffer.from(cipher.split('').reverse().join(''), 'base64').toString();

  beforeEach(() => {
    before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    envKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    setSecretCrypto({ available: () => true, encrypt: sealed, decrypt: opened, label: 'a test keychain' });
  });

  afterEach(() => {
    if (before === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, before);
    if (envKey !== undefined) process.env.GEMINI_API_KEY = envKey;
  });

  it('keeps no character of an encrypted key on disk, and still shows its last four', () => {
    saveApiKey(KEY, 'gemini');
    const onDisk = fs.readFileSync(file, 'utf8');
    expect(onDisk).not.toContain(KEY.slice(-4));
    expect(JSON.parse(onDisk).gemini).not.toHaveProperty('hint');
    expect(getApiKey('gemini')).toBe(KEY);
    expect(allKeyStatus().gemini).toMatchObject({ configured: true, source: 'stored', hint: '7Q4z' });
    clearApiKey('gemini');
  });

  it("rewrites an earlier build's file without the hint it kept", () => {
    fs.writeFileSync(file, JSON.stringify({ gemini: { encrypted: true, value: sealed(KEY), hint: KEY.slice(-4) } }));
    expect(allKeyStatus().gemini).toMatchObject({ configured: true, hint: '7Q4z' });
    expect(fs.readFileSync(file, 'utf8')).not.toContain(KEY.slice(-4));
    expect(getApiKey('gemini')).toBe(KEY);
  });

  it("shows no hint for a key this machine can't decrypt, and still says one is saved", () => {
    fs.writeFileSync(file, JSON.stringify({ gemini: { encrypted: true, value: 'not-sealed-here' } }));
    setSecretCrypto({ available: () => true, encrypt: sealed, decrypt: () => { throw new Error('another machine'); }, label: 'a test keychain' });
    expect(allKeyStatus().gemini).toMatchObject({ configured: true, source: 'stored', hint: null });
  });
});
