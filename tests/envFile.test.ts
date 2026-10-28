import { describe, expect, it } from 'vitest';
import { envFileMaySet, parseEnvFile } from '../server/config.js';

/** The `.env` a user drops beside the data (B-101, SRVINFRA-28). */
describe('a .env file', () => {
  it('reads a Windows file without carrying the line ending into the value', () => {
    expect(parseEnvFile('ANTHROPIC_API_KEY="sk-ant-abc"\r\nPORT=5178\r\n')).toEqual([['ANTHROPIC_API_KEY', 'sk-ant-abc'], ['PORT', '5178']]);
  });

  it('takes a quoted value as written inside its quotes, and an unquoted one trimmed and without a comment', () => {
    expect(parseEnvFile(`A='it "is"'\nB="x y" \nC=plain # note\nexport D=d\n# comment\nnot a setting\nE=\n`)).toEqual([
      ['A', 'it "is"'], ['B', 'x y'], ['C', 'plain'], ['D', 'd'], ['E', ''],
    ]);
    // Only matching quotes are quotes
    expect(parseEnvFile(`F="half\nG=end"\n`)).toEqual([['F', '"half'], ['G', 'end"']]);
  });

  it("can't flip the test switches, only the user-facing settings and keys", () => {
    for (const name of ['OOTP_FO_DB_WRITABLE', 'OOTP_FO_DB_READONLY', 'OOTP_FO_EXPORT_QUIET_MS', 'OOTP_FO_FRONT_OFFICE_WORKER', 'OOTP_FO_EMBEDDED', 'OOTP_FO_SIDECAR', 'OOTP_FO_PORT']) {
      expect([name, envFileMaySet(name)]).toEqual([name, false]);
    }
    for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'PORT', 'OOTP_FO_BIND', 'OOTP_FO_ALLOWED_HOSTS', 'OOTP_FO_API_PORT', 'OOTP_FO_UPDATER_LOG']) {
      expect([name, envFileMaySet(name)]).toEqual([name, true]);
    }
  });
});
