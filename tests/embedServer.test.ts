import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Mac app's "Embed the server" build phase (`macos/scripts/embed-server.sh`) refuses a stale server stage (review
 * S6): a stage made from another bundle, lockfile or Node, or a server source newer than its bundle. Run against a
 * pretend repository in a temporary folder; macOS only (the script uses plutil and PlistBuddy).
 */
const scripts = path.join(process.cwd(), 'macos', 'scripts');

function write(file: string, content: string, mode = 0o644): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode });
}

function pretendRepository(): { root: string; run: () => { status: number | null; output: string } } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-embed-'));
  write(path.join(root, 'package.json'), '{"version":"1.2.3"}');
  write(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}');
  for (const file of ['server.cjs', 'value-refit-worker.cjs', 'calibration-refit-worker.cjs', 'front-office-worker.cjs']) {
    write(path.join(root, 'build/sidecar', file), `// ${file}`);
  }
  write(path.join(root, 'build/sidecar/package.json'), '{"version":"1.2.3"}');
  write(path.join(root, 'build/node-runtime/pennant-server'), '#!/bin/sh\necho v24.21.0\n', 0o755);
  write(path.join(root, 'server/index.ts'), 'export {};');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(root, 'server/index.ts'), old, old);
  const stage = path.join(root, 'build/macos-server');
  write(path.join(stage, 'Helpers/pennant-server'), '#!/bin/sh\n', 0o755);
  write(path.join(stage, 'Resources/server/server.cjs'), '// staged');
  write(path.join(stage, 'Resources/server/package.json'), '{"version":"1.2.3"}');
  fs.mkdirSync(path.join(stage, 'Resources/server/node_modules/better-sqlite3'), { recursive: true });
  fs.writeFileSync(path.join(stage, '.stamp'), execFileSync(path.join(scripts, 'stage-stamp.sh'), [root], { encoding: 'utf8' }));
  // SRCROOT is the repository's macos/, with the real scripts
  fs.mkdirSync(path.join(root, 'macos'));
  fs.symlinkSync(scripts, path.join(root, 'macos/scripts'));
  const target = path.join(root, 'out');
  write(path.join(target, 'Pennant.app/Contents/Info.plist'), '');
  execFileSync('plutil', ['-create', 'xml1', path.join(target, 'Pennant.app/Contents/Info.plist')]);
  const run = () => {
    const result = spawnSync('/bin/bash', [path.join(scripts, 'embed-server.sh')], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        SRCROOT: path.join(root, 'macos'),
        TARGET_BUILD_DIR: target,
        CONTENTS_FOLDER_PATH: 'Pennant.app/Contents',
        INFOPLIST_PATH: 'Pennant.app/Contents/Info.plist',
        CODE_SIGNING_ALLOWED: 'NO',
      },
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };
  return { root, run };
}

describe.runIf(process.platform === 'darwin')('embedding the staged server', () => {
  it('embeds a stage that matches its inputs, and sets the version', () => {
    const { root, run } = pretendRepository();
    const result = run();
    expect(result.output).toContain('Embedded the server (version 1.2.3)');
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(root, 'out/Pennant.app/Contents/Resources/server/server.cjs'))).toBe(true);
    const version = execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(root, 'out/Pennant.app/Contents/Info.plist')], { encoding: 'utf8' });
    expect(version.trim()).toBe('1.2.3');
  });

  it('refuses a stage made from another server bundle', () => {
    const { root, run } = pretendRepository();
    fs.writeFileSync(path.join(root, 'build/sidecar/server.cjs'), '// rebuilt since staging');
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('npm run mac:stage');
  });

  it('refuses a stage made from another lockfile', () => {
    const { root, run } = pretendRepository();
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}');
    expect(run().status).toBe(1);
  });

  it('refuses when the server source is newer than its bundle', () => {
    const { root, run } = pretendRepository();
    fs.writeFileSync(path.join(root, 'server/index.ts'), 'export const changed = true;');
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('source has changed');
  });

  it('refuses a stage with no stamp', () => {
    const { root, run } = pretendRepository();
    fs.rmSync(path.join(root, 'build/macos-server/.stamp'));
    expect(run().status).toBe(1);
  });
});
