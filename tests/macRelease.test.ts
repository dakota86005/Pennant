import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { RELEASES_URL, RELEASE_TAG_PREFIX, releaseTag } from '../server/project';

/**
 * Pennant for Mac's release pipeline (macos/scripts/releasing/, release.yml's pennant-mac jobs, D-076, DEVELOPMENT.md
 * "Releasing Pennant for Mac"): the version comes from package.json, the app is signed inside out, and the Apple and
 * Sparkle secrets reach only macOS jobs. The signing tests sign a fake tree ad hoc (no keychain, no identity) and run
 * on macOS only; release.yml's pennant-mac job runs this file on the runner before it builds.
 */
const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, 'macos', 'scripts', 'releasing');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const onMac = process.platform === 'darwin';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-release-test-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function run(script: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync('bash', [path.join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: scratch, ...env },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

/** release.yml's jobs, each as its own block of text, keyed by id */
function jobs(workflow: string): Record<string, string> {
  const body = workflow.slice(workflow.indexOf('\njobs:\n'));
  const parts = body.split(/\n(?= {2}[a-z][\w-]*:\n)/).slice(1);
  return Object.fromEntries(parts.map((p) => [p.trim().split(':')[0], p]));
}

describe('the version comes from package.json, never a copy (D-049)', () => {
  it.runIf(onMac)('prints the version and the release tag', () => {
    expect(run('version.sh', []).out.trim()).toBe(pkg.version);
    expect(run('version.sh', ['--tag']).out.trim()).toBe(releaseTag(pkg.version));
  });

  it.runIf(onMac)('accepts only pennant-v + the version as the tag', () => {
    expect(run('version.sh', ['--check-tag', releaseTag(pkg.version)]).status).toBe(0);
    for (const wrong of [`v${pkg.version}`, `${RELEASE_TAG_PREFIX}9.9.9`, '']) {
      expect(run('version.sh', ['--check-tag', wrong]).status).not.toBe(0);
    }
  });

  it.runIf(onMac)('checks the version an app and its extensions carry', () => {
    const app = path.join(scratch, 'Versioned.app');
    const plist = (dir: string, version: string) => {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'Info.plist');
      execFileSync('/usr/bin/plutil', ['-create', 'xml1', file]);
      for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
        execFileSync('/usr/bin/plutil', ['-insert', key, '-string', version, file]);
      }
    };
    plist(path.join(app, 'Contents'), pkg.version);
    plist(path.join(app, 'Contents', 'PlugIns', 'Widgets.appex', 'Contents'), pkg.version);
    expect(run('version.sh', ['--check-app', app]).status).toBe(0);
    plist(path.join(app, 'Contents', 'PlugIns', 'Widgets.appex', 'Contents'), '0.0.1');
    const stale = run('version.sh', ['--check-app', app]);
    expect(stale.status).not.toBe(0);
    expect(stale.err).toContain('Widgets.appex');
  });

  it('is never written into the project or the Info.plist by hand', () => {
    const project = read('macos/Pennant.xcodeproj/project.pbxproj');
    expect(project).not.toMatch(/MARKETING_VERSION|CURRENT_PROJECT_VERSION/);
    expect(read('macos/Support/Info.plist')).not.toMatch(/CFBundleShortVersionString|CFBundleVersion/);
    expect(read('macos/scripts/embed-server.sh')).toContain('plutil -extract version raw');
  });
});

describe('the feed is Pennant\'s own repository', () => {
  it('reads the appcast from origin\'s newest release', () => {
    const lib = read('macos/scripts/releasing/lib.sh');
    expect(lib).toContain('RELEASE_TAG_PREFIX="pennant-v"');
    expect(lib).toContain(`RELEASE_FEED_URL="https://github.com/\${RELEASE_GITHUB_REPO}/releases/latest/download/appcast.xml"`);
    expect(`https://github.com/${/RELEASE_GITHUB_REPO="([^"]+)"/.exec(lib)?.[1]}/releases`).toBe(RELEASES_URL);
  });

  it('is set only in Release builds, so a Debug build never checks for updates', () => {
    const embed = read('macos/scripts/embed-server.sh');
    expect(embed).toMatch(/if \[ "\$\{CONFIGURATION:-\}" = "Release" \]; then[\s\S]*set_plist SUFeedURL/);
    expect(read('macos/Support/Info.plist')).not.toMatch(/SUFeedURL|SUPublicEDKey/);
  });
});

describe('release.yml: tags and secrets', () => {
  const workflow = read('.github/workflows/release.yml');
  const all = jobs(workflow);

  it('triggers only on pennant-v* and checks the tag in every job that can see one', () => {
    expect(workflow).toContain("tags: ['pennant-v*']");
    expect([...workflow.matchAll(/refs\/tags\/([\w-]*)'/g)].every((m) => m[1] === 'pennant-v')).toBe(true);
    expect(all['pennant-mac']).toContain('version.sh --check-tag "${GITHUB_REF_NAME}"');
    expect(all['pennant-mac-appcast']).toContain('version.sh --check-tag "${GITHUB_REF_NAME}"');
  });

  it('gives the Apple and Sparkle secrets only to macOS jobs', () => {
    // The comment above the jobs says why: a Windows job that can see CSC_LINK signs .exe files with the Apple
    // certificate. The same holds for any job not on macOS.
    expect(Object.keys(all)).toEqual(['test', 'macos', 'pennant-mac', 'windows', 'release', 'pennant-mac-appcast']);
    for (const [id, text] of Object.entries(all)) {
      const onMacRunner = /runs-on: macos-/.test(text);
      if (!onMacRunner) expect(text, id).not.toMatch(/secrets\.(APPLE_|SPARKLE_)/);
    }
    expect(all['pennant-mac-appcast']).not.toMatch(/secrets\.APPLE_/);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/secrets\.(APPLE_|SPARKLE_)/);
  });

  it('never weakens the signed-and-notarized check', () => {
    for (const id of ['macos', 'pennant-mac']) {
      expect(all[id]).toContain('- name: Verify the app is signed and notarized');
      expect(all[id]).toContain('codesign --verify --deep --strict --verbose=2 "$APP"');
      expect(all[id]).toContain('spctl --assess --type execute --verbose=4 "$APP"');
      expect(all[id]).not.toMatch(/continue-on-error|\|\| true/);
    }
    expect(all['pennant-mac']).toContain('xcrun stapler validate "$DMG"');
  });

  it('publishes only the signed DMG, never the unsigned one, and needs the Mac app', () => {
    expect(all.release).toMatch(/needs: \[macos, windows, pennant-mac\]/);
    const downloads = [...all.release.matchAll(/download-artifact@v4\n\s+with:\n\s+name: ([\w-]+)/g)].map((m) => m[1]);
    expect(downloads).toEqual(['macos', 'windows', 'pennant-mac']);
    expect(all.release).toContain('"Pennant-for-Mac-${GITHUB_REF_NAME#pennant-v}.dmg"');
  });

  it('runs these tests before it builds', () => {
    expect(all['pennant-mac']).toContain('npx vitest run tests/macRelease.test.ts');
  });
});

describe('without the secrets the pipeline fails, naming them', () => {
  it('names every missing secret and the public key', () => {
    const sign = run('check-secrets.sh', ['sign']);
    expect(sign.status).not.toBe(0);
    for (const name of ['APPLE_CERTIFICATE_P12', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
      expect(sign.err).toContain(name);
    }
    const appcast = run('check-secrets.sh', ['appcast']);
    expect(appcast.status).not.toBe(0);
    expect(appcast.err).toContain('SPARKLE_ED_PRIVATE_KEY');
  });

  it('refuses to notarize without the account', () => {
    const r = run('notarize.sh', [path.join(scratch, 'Nothing.dmg')]);
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID');
  });
});

describe.runIf(onMac)('signing inside out (SWIFTUI_REBUILD.md section 5.2)', () => {
  const machO = '/usr/bin/true'; // any Mach-O file stands in for a binary; signing replaces its signature

  /** A fake Pennant.app shaped like the real one: the server's .node, the Node binary, Sparkle, a widget extension */
  function fakeApp(name: string, appEntitlements?: string): { app: string; tsv: string } {
    const app = path.join(scratch, name, 'Pennant.app');
    const c = path.join(app, 'Contents');
    const bin = (rel: string) => {
      fs.mkdirSync(path.dirname(path.join(c, rel)), { recursive: true });
      fs.copyFileSync(machO, path.join(c, rel));
      fs.chmodSync(path.join(c, rel), 0o755);
    };
    const info = (dir: string, id: string, exe: string, type = 'APPL') => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleExecutable</key>
<string>${exe}</string><key>CFBundlePackageType</key><string>${type}</string></dict></plist>`);
    };
    info(c, 'com.dakotawise.pennant', 'Pennant');
    bin('MacOS/Pennant');
    bin('Helpers/pennant-server');
    bin('Resources/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node');
    fs.writeFileSync(path.join(c, 'Resources/server/server.cjs'), '// not code\n');
    const fw = path.join(c, 'Frameworks/Sparkle.framework');
    const b = path.join(fw, 'Versions/B');
    for (const rel of ['Sparkle', 'Autoupdate', 'Updater.app/Contents/MacOS/Updater', 'XPCServices/Downloader.xpc/Contents/MacOS/Downloader']) {
      fs.mkdirSync(path.dirname(path.join(b, rel)), { recursive: true });
      fs.copyFileSync(machO, path.join(b, rel));
      fs.chmodSync(path.join(b, rel), 0o755);
    }
    info(path.join(b, 'Resources'), 'org.sparkle-project.Sparkle', 'Sparkle', 'FMWK');
    info(path.join(b, 'Updater.app/Contents'), 'org.sparkle-project.Sparkle.Updater', 'Updater');
    info(path.join(b, 'XPCServices/Downloader.xpc/Contents'), 'org.sparkle-project.DownloaderService', 'Downloader', 'XPC!');
    fs.symlinkSync('B', path.join(fw, 'Versions/Current'));
    fs.symlinkSync('Versions/Current/Sparkle', path.join(fw, 'Sparkle'));
    fs.symlinkSync('Versions/Current/Resources', path.join(fw, 'Resources'));
    info(path.join(c, 'PlugIns/PennantWidgets.appex/Contents'), 'com.dakotawise.pennant.widgets', 'PennantWidgets', 'XPC!');
    bin('PlugIns/PennantWidgets.appex/Contents/MacOS/PennantWidgets');

    const plistOf = (keys: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${keys}</dict></plist>`;
    const widgetEnt = path.join(scratch, name, 'PennantWidgets.entitlements');
    fs.writeFileSync(widgetEnt, plistOf(`<key>com.apple.security.app-sandbox</key><true/>
<key>com.apple.security.application-groups</key><array><string>$(TeamIdentifierPrefix)group.com.dakotawise.pennant</string></array>`));
    const rows = [`PennantWidgets.appex\t${widgetEnt}`];
    if (appEntitlements !== undefined) {
      const appEnt = path.join(scratch, name, 'Pennant.entitlements');
      fs.writeFileSync(appEnt, plistOf(appEntitlements));
      rows.push(`Pennant.app\t${appEnt}`);
    } else {
      rows.push('Pennant.app\t');
    }
    const tsv = path.join(scratch, name, 'entitlements.tsv');
    fs.writeFileSync(tsv, `${rows.join('\n')}\n`);
    return { app, tsv };
  }
  const entitlements = (target: string) =>
    execFileSync('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const flags = (target: string) =>
    spawnSync('/usr/bin/codesign', ['-dvv', target], { encoding: 'utf8' }).stderr;

  it('signs each piece before what contains it, and the result verifies deep and strict', () => {
    const { app, tsv } = fakeApp('inside-out');
    const r = run('sign-app.sh', [app, '-', tsv]);
    expect(r.err).toBe('');
    expect(r.status).toBe(0);
    const order = r.out.split('\n').filter((l) => l.startsWith('[sign] ') && !l.startsWith('[sign] verified')).map((l) => l.slice(7));
    expect(order).toEqual([
      'Contents/Resources/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      'Contents/Helpers/pennant-server',
      'Contents/Frameworks/Sparkle.framework/Versions/Current/Updater.app',
      'Contents/Frameworks/Sparkle.framework/Versions/Current/XPCServices/Downloader.xpc',
      'Contents/Frameworks/Sparkle.framework/Versions/Current/Autoupdate',
      'Contents/Frameworks/Sparkle.framework',
      'Contents/PlugIns/PennantWidgets.appex',
      'Pennant.app',
    ]);
    // The test's own check, beside the script's
    expect(spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]).status).toBe(0);

    const c = path.join(app, 'Contents');
    for (const target of [app, path.join(c, 'Helpers/pennant-server'), path.join(c, 'PlugIns/PennantWidgets.appex'),
      path.join(c, 'Resources/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node')]) {
      expect(flags(target), target).toMatch(/flags=0x\w+\([^)]*runtime[^)]*\)/);
    }
    const node = entitlements(path.join(c, 'Helpers/pennant-server'));
    expect(node).toContain('com.apple.security.cs.allow-jit');
    expect(node).toContain('com.apple.security.cs.allow-unsigned-executable-memory');
    expect(entitlements(path.join(c, 'PlugIns/PennantWidgets.appex'))).toContain('ADHOC.group.com.dakotawise.pennant');
    expect(entitlements(app)).not.toMatch(/allow-jit|app-sandbox/);
  });

  it('refuses an app whose own entitlements carry JIT or the sandbox', () => {
    for (const key of ['com.apple.security.cs.allow-jit', 'com.apple.security.app-sandbox']) {
      const { app, tsv } = fakeApp(`refuse-${key}`, `<key>${key}</key><true/>`);
      const r = run('sign-app.sh', [app, '-', tsv]);
      expect(r.status).not.toBe(0);
      expect(r.err).toContain(key);
    }
  });

  it('stops when a target names an entitlements file that is not there', () => {
    const { app, tsv } = fakeApp('missing-entitlements');
    fs.writeFileSync(tsv, `PennantWidgets.appex\t${path.join(scratch, 'nowhere.entitlements')}\n`);
    const r = run('sign-app.sh', [app, '-', tsv]);
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('nowhere.entitlements');
  });

  it('refuses an app with no server inside', () => {
    const { app, tsv } = fakeApp('no-server');
    fs.rmSync(path.join(app, 'Contents/Helpers/pennant-server'));
    expect(run('sign-app.sh', [app, '-', tsv]).status).not.toBe(0);
  });
});
