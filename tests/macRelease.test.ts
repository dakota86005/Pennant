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

describe('Sparkle in the app (N14 Stage B, step 2)', () => {
  const tools = read('macos/scripts/releasing/fetch-sparkle-tools.sh');
  const version = /SPARKLE_VERSION="([^"]+)"/.exec(tools)?.[1];

  it('links the release tools\' Sparkle, pinned exactly, in the app target only', () => {
    expect(version).toMatch(/^2\.\d+\.\d+$/);
    const project = read('macos/Pennant.xcodeproj/project.pbxproj');
    expect(project).toMatch(new RegExp(`repositoryURL = "https://github.com/sparkle-project/Sparkle";\\s*requirement = \\{\\s*kind = exactVersion;\\s*version = ${version!.replace(/\./g, '\\.')};`));
    expect(project.match(/\/\* Sparkle in Frameworks \*\/ = \{/g)).toHaveLength(1);
    const resolved = JSON.parse(read('macos/Pennant.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved')) as {
      pins: { identity: string; state: { version?: string } }[];
    };
    expect(resolved.pins.find((pin) => pin.identity === 'sparkle')?.state.version).toBe(version);
    // The packages never link it, so their tests can never reach Sparkle's network code
    for (const pkgFile of ['PennantKit', 'PennantFeatures', 'PennantDesign', 'PennantAPI']) {
      expect(read(`macos/Packages/${pkgFile}/Package.swift`)).not.toMatch(/sparkle/i);
    }
  });

  it('asks the GM first: no automatic check until he says yes, and nothing installed by itself', () => {
    const plist = read('macos/Support/Info.plist');
    expect(plist).not.toMatch(/<key>SUEnableAutomaticChecks<\/key>/);
    expect(plist).toMatch(/<key>SUAllowsAutomaticUpdates<\/key>\s*<false\/>/);
    expect(plist).toMatch(/<key>SUVerifyUpdateBeforeExtraction<\/key>\s*<true\/>/);
  });

  it('makes an updater only from a feed and a key, never in a Debug build', () => {
    const updater = read('macos/Pennant/Updater.swift');
    expect(updater).toMatch(/#if DEBUG[\s\S]*return \.off\(\)[\s\S]*#else[\s\S]*Updates\.feedConfigured\(bundle\.infoDictionary\)[\s\S]*#endif/);
    expect(updater).not.toMatch(/SecItem|SecKeychain/);
  });

  it('fetches packages without the Keychain wherever xcodebuild runs', () => {
    for (const file of ['macos/scripts/releasing/build-app.sh', 'macos/scripts/test.sh', '.github/workflows/ci.yml']) {
      const text = uncommented(read(file));
      const calls = text.split(/\bxcodebuild\b/).length - 1;
      expect(calls, file).toBeGreaterThan(0);
      expect(text, file).toContain('-packageAuthorizationProvider netrc');
    }
    expect(read('macos/scripts/releasing/build-app.sh')).toContain('-onlyUsePackageVersionsFromResolvedFile');
  });

  it('checks the dry run\'s app as the workflow does, after signing', () => {
    const dry = uncommented(read('macos/scripts/releasing/dry-run.sh'));
    expect(dry.indexOf('check-updater.sh')).toBeGreaterThan(dry.indexOf('sign-app.sh'));
  });
});

/** A job's steps, each with its name (or its `run`/`uses` line) and its text, comments left out */
function steps(job: string): { name: string; text: string }[] {
  const body = uncommented(job).slice(uncommented(job).indexOf('\n    steps:\n'));
  return body.split(/\n(?= {6}- )/).slice(1).map((text) => ({
    name: (/^ {6}- name: (.+)$/m.exec(text) ?? /^ {8}name: (.+)$/m.exec(text) ?? /^ {6}- (?:run|uses): (.+)$/m.exec(text))?.[1].trim() ?? '',
    text,
  }));
}
const uncommented = (text: string) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const TAG_GUARD = "startsWith(github.ref, 'refs/tags/pennant-v')";

describe('release.yml: tags and secrets', () => {
  const workflow = read('.github/workflows/release.yml');
  const all = jobs(workflow);

  it('has these jobs', () => {
    expect(Object.keys(all)).toEqual(['test', 'macos', 'pennant-mac', 'windows', 'release', 'pennant-mac-appcast']);
  });

  it('triggers only on pennant-v* and guards each job that can see a tag with the same prefix', () => {
    expect(workflow).toContain("tags: ['pennant-v*']");
    expect([...workflow.matchAll(/refs\/tags\/([\w-]*)'/g)].every((m) => m[1] === 'pennant-v')).toBe(true);
    // Each guard, job by job: the tag checks in test, pennant-mac and the appcast job, and release's own condition
    const guards = Object.fromEntries(Object.entries(all).map(([id, text]) => [id, text.split(TAG_GUARD).length - 1]));
    expect(guards).toEqual({ test: 1, macos: 0, 'pennant-mac': 1, windows: 0, release: 1, 'pennant-mac-appcast': 1 });
    for (const id of ['pennant-mac', 'pennant-mac-appcast']) {
      const check = steps(all[id]).find((s) => s.name === 'Tag matches package.json');
      expect(check?.text, id).toContain(`if: ${TAG_GUARD}`);
      expect(check?.text, id).toContain('version.sh --check-tag "${GITHUB_REF_NAME}"');
    }
    expect(all.release).toContain(`if: github.event_name == 'push' && ${TAG_GUARD}`);
  });

  it('runs Pennant for Mac only by hand until N15, and never lets it block or join a release (D-076)', () => {
    for (const id of ['pennant-mac', 'pennant-mac-appcast']) {
      expect(all[id], id).toMatch(/^ {4}if: github\.event_name == 'workflow_dispatch'$/m);
    }
    expect(all['pennant-mac-appcast']).toMatch(/^ {4}needs: pennant-mac$/m);
    expect(all.release).toMatch(/^ {4}needs: \[macos, windows\]$/m);
    const downloads = [...all.release.matchAll(/download-artifact@v4\n\s+with:\n\s+name: ([\w-]+)/g)].map((m) => m[1]);
    expect(downloads).toEqual(['macos', 'windows']);
    expect(uncommented(all.release)).not.toMatch(/pennant-mac|Pennant-for-Mac|appcast/);
    // The appcast is kept as an artifact, never attached
    expect(uncommented(all['pennant-mac-appcast'])).not.toMatch(/gh release|GH_TOKEN|GITHUB_TOKEN/);
    expect(all['pennant-mac-appcast']).toContain('name: pennant-mac-appcast');
  });

  it('can write only from the release job', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow.match(/contents: write/g)).toHaveLength(1);
    expect(all.release).toMatch(/^ {4}permissions:\n {6}contents: write$/m);
  });

  it('gives the Apple and Sparkle secrets only to macOS jobs', () => {
    // The comment above the jobs says why: a Windows job that can see CSC_LINK signs .exe files with the Apple
    // certificate. The same holds for any job not on macOS.
    for (const [id, text] of Object.entries(all)) {
      const onMacRunner = /runs-on: macos-/.test(text);
      if (!onMacRunner) expect(uncommented(text), id).not.toMatch(/secrets\.(APPLE_|SPARKLE_)/);
    }
    expect(all['pennant-mac-appcast']).not.toMatch(/secrets\.APPLE_/);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/secrets\.(APPLE_|SPARKLE_)/);
  });

  it('gives each secret only to the steps that use it, never to a whole job', () => {
    const body = uncommented(workflow);
    expect(body).not.toMatch(/^env:/m);
    for (const [id, text] of Object.entries(all)) {
      expect(uncommented(text), id).not.toMatch(/^ {4}env:/m);
      for (const step of steps(text)) {
        // Nothing that installs, stages or tests code can read a secret
        if (/npm ci|mac:stage|vitest/.test(step.text)) expect(step.text, `${id}: ${step.name}`).not.toContain('secrets.');
      }
    }
    const withSecret = (id: string, prefix: string) => steps(all[id]).filter((s) => s.text.includes(`secrets.${prefix}`)).map((s) => s.name);
    expect(withSecret('pennant-mac', 'APPLE_')).toEqual([
      'Build the Release app (unsigned)',
      'Check the signing and notarizing secrets',
      'Load the Developer ID certificate into a throwaway keychain',
      'Store the notarization account in the throwaway keychain',
      'Sign inside out',
    ]);
    expect(withSecret('macos', 'APPLE_')).toEqual([
      'Load the Developer ID certificate into a throwaway keychain',
      'Store the notarization account in the throwaway keychain',
    ]);
    const sparkle = Object.keys(all).flatMap((id) => steps(all[id]).filter((s) => s.text.includes('SPARKLE_')).map((s) => `${id}: ${s.name}`));
    expect(sparkle).toEqual(['pennant-mac-appcast: Write the appcast']);
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

  // electron-builder 26's own keychain (from CSC_LINK) fails before signing: its importCerts gives
  // set-key-partition-list the certificate's password, not the keychain's. Both macOS jobs load the certificate
  // with ci-keychain.sh instead, and remove that keychain whatever happened.
  it('signs both apps from the reviewed throwaway keychain, never electron-builder\'s own, and always removes it', () => {
    expect(uncommented(workflow)).not.toMatch(/CSC_LINK|CSC_KEY_PASSWORD/);
    for (const id of ['macos', 'pennant-mac']) {
      const names = steps(all[id]).map((s) => s.name);
      const at = (name: string) => names.indexOf(name);
      expect(at('Load the Developer ID certificate into a throwaway keychain'), id).toBeGreaterThan(-1);
      expect(at('Store the notarization account in the throwaway keychain'), id)
        .toBe(at('Load the Developer ID certificate into a throwaway keychain') + 1);
      const remove = steps(all[id]).find((s) => s.name === 'Remove the signing keychain');
      expect(remove?.text, id).toMatch(/^ {8}if: always\(\)$/m);
      expect(remove?.text, id).toContain('ci-keychain.sh delete');
      expect(at('Remove the signing keychain'), id).toBeGreaterThan(at('Verify the app is signed and notarized'));
    }
    const pack = steps(all.macos).find((s) => s.name === 'Package, signed and notarized')?.text ?? '';
    expect(pack).not.toContain('secrets.');
    expect(pack).toContain('export CSC_KEYCHAIN="${PENNANT_SIGN_KEYCHAIN}"');
    // electron-builder refuses a CSC_NAME that starts with the certificate type
    expect(pack).toContain('export CSC_NAME="${PENNANT_SIGN_IDENTITY#Developer ID Application: }"');
    expect(pack).toContain('export APPLE_KEYCHAIN_PROFILE="${PENNANT_NOTARY_PROFILE}"');
    expect(pack).toContain('npx electron-builder --mac --publish never -c.forceCodeSigning=true');
  });

  it('refuses an app that could never update itself before it verifies or keeps anything signed', () => {
    const names = steps(all['pennant-mac']).map((s) => s.name);
    const at = (name: string) => names.indexOf(name);
    expect(at('Refuse an app that could never update itself')).toBeGreaterThan(at('Make, notarize and staple the DMG'));
    expect(at('Refuse an app that could never update itself')).toBeLessThan(at('Verify the app is signed and notarized'));
    expect(at('Refuse an app that could never update itself')).toBeLessThan(names.lastIndexOf('actions/upload-artifact@v4'));
    expect(all['pennant-mac']).toContain('check-updater.sh build/mac-release/Pennant.app');
  });

  it('publishes draft first: creates a draft, uploads, verifies, and only then publishes, as its last step', () => {
    const release = steps(all.release);
    const names = release.map((s) => s.name);
    const upload = release.find((s) => s.name === 'Upload the installers to a draft release');
    expect(upload?.text).toMatch(/gh release create "\$\{GITHUB_REF_NAME\}"[^\n]*\\\n(?:[^\n]*\\\n)*[^\n]*--draft 2>&1/);
    expect(upload?.text).toContain('a re-run never changes a published release');
    // The publish step is the job's last, after the verification, and the only one that publishes
    expect(names.slice(-2)).toEqual(['Verify the draft\'s assets', 'Publish the release']);
    expect(release.at(-1)?.text).toContain('gh release edit "${GITHUB_REF_NAME}" --repo "${GITHUB_REPOSITORY}" --draft=false --latest');
    const publishing = Object.keys(all).flatMap((id) =>
      steps(all[id]).filter((s) => /--draft=false|--latest|gh release edit/.test(s.text)).map((s) => `${id}: ${s.name}`));
    expect(publishing).toEqual(['release: Publish the release']);
    // Uploads happen only before the verification; the verification compares every built file and the manifests
    const uploads = Object.keys(all).flatMap((id) => steps(all[id]).filter((s) => s.text.includes('gh release upload')).map((s) => `${id}: ${s.name}`));
    expect(uploads).toEqual(['release: Upload the installers to a draft release']);
    const verify = release.find((s) => s.name === 'Verify the draft\'s assets')?.text ?? '';
    expect(verify).toContain('comm -23 built.tsv published.tsv');
    expect(verify).toContain('for f in latest-mac.yml latest.yml; do');
    expect(verify).not.toMatch(/\|\| true|continue-on-error/);
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
    expect(r.err).toContain('PENNANT_NOTARY_PROFILE');
    expect(r.err).toContain('APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID');
  });

  it('never puts the notarization password on notarytool\'s command line when notarizing', () => {
    const notarize = read('macos/scripts/releasing/notarize.sh');
    expect(notarize).toContain('--keychain-profile "${PENNANT_NOTARY_PROFILE}"');
    expect(notarize).not.toMatch(/--password|APPLE_APP_SPECIFIC_PASSWORD}/);
  });
});

describe.runIf(onMac)('an app that could never update itself is refused (check-updater.sh)', () => {
  const key = read('macos/Support/sparkle-public-key.txt').trim();
  const feed = 'https://github.com/dakota86005/Pennant/releases/latest/download/appcast.xml';
  function app(name: string, plist: Record<string, string>, sparkle: boolean) {
    const contents = path.join(scratch, 'updater', name, 'Pennant.app', 'Contents');
    fs.mkdirSync(contents, { recursive: true });
    const file = path.join(contents, 'Info.plist');
    execFileSync('/usr/bin/plutil', ['-create', 'xml1', file]);
    for (const [k, v] of Object.entries(plist)) execFileSync('/usr/bin/plutil', ['-insert', k, '-string', v, file]);
    if (sparkle) fs.mkdirSync(path.join(contents, 'Frameworks', 'Sparkle.framework'), { recursive: true });
    return path.dirname(contents);
  }

  it('reads the committed key the one way every step does (lib.sh release_public_key)', () => {
    expect(key).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    for (const script of ['macos/scripts/releasing/check-secrets.sh', 'macos/scripts/releasing/check-updater.sh', 'macos/scripts/embed-server.sh']) {
      expect(read(script), script).toContain('release_public_key');
      expect(read(script), script).not.toContain('{43}=');
    }
  });

  it('passes an app with Sparkle, the feed and the committed key', () => {
    const r = run('check-updater.sh', [app('good', { SUFeedURL: feed, SUPublicEDKey: key }, true)]);
    expect(r.err).toBe('');
    expect(r.status).toBe(0);
  });

  it('refuses an app without Sparkle, saying so', () => {
    const r = run('check-updater.sh', [app('no-sparkle', { SUFeedURL: feed, SUPublicEDKey: key }, false)]);
    expect(r.status).not.toBe(0);
    expect(r.err).toContain("Sparkle isn't in the app yet");
  });

  it('refuses another feed or another key, naming each', () => {
    const r = run('check-updater.sh', [app('wrong', { SUFeedURL: 'https://example.com/appcast.xml', SUPublicEDKey: `${'A'.repeat(43)}=` }, true)]);
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('SUFeedURL');
    expect(r.err).toContain('SUPublicEDKey');
    expect(run('check-updater.sh', [app('none', {}, true)]).status).not.toBe(0);
  });
});

describe('each bundle\'s entitlements, with its build settings filled in', () => {
  const settings = (b: Record<string, string>) => ({ buildSettings: { SRCROOT: scratch, ...b } });
  const fill = (targets: object[]) =>
    spawnSync('node', [path.join(SCRIPTS, 'entitlements.mjs'), path.join(scratch, 'filled')], { input: JSON.stringify(targets), encoding: 'utf8' });

  it('fills in the target\'s settings, keeps the identity\'s prefixes, and skips the test bundle', () => {
    fs.writeFileSync(path.join(scratch, 'App.entitlements'), '<string>$(PENNANT_APP_GROUP)</string><string>$(TeamIdentifierPrefix)x</string>');
    const r = fill([
      settings({ WRAPPER_EXTENSION: 'app', FULL_PRODUCT_NAME: 'Pennant.app', TARGET_NAME: 'Pennant', CODE_SIGN_ENTITLEMENTS: 'App.entitlements', PENNANT_APP_GROUP: 'TEAM.group.com.dakotawise.pennant' }),
      settings({ WRAPPER_EXTENSION: 'xctest', FULL_PRODUCT_NAME: 'PennantUITests.xctest', TARGET_NAME: 'PennantUITests' }),
      settings({ WRAPPER_EXTENSION: 'appex', FULL_PRODUCT_NAME: 'Other.appex', TARGET_NAME: 'Other' }),
      // -alltargets can list the app again, with the same settings: one row, never two
      settings({ WRAPPER_EXTENSION: 'app', FULL_PRODUCT_NAME: 'Pennant.app', TARGET_NAME: 'Pennant', CODE_SIGN_ENTITLEMENTS: 'App.entitlements', PENNANT_APP_GROUP: 'TEAM.group.com.dakotawise.pennant' }),
    ]);
    expect(r.status).toBe(0);
    const file = path.join(scratch, 'filled', 'Pennant.app.entitlements');
    expect(r.stdout).toBe(`Pennant.app\t${file}\nOther.appex\t\n`);
    expect(fs.readFileSync(file, 'utf8')).toBe('<string>TEAM.group.com.dakotawise.pennant</string><string>$(TeamIdentifierPrefix)x</string>');
  });

  it('stops on a product listed again with other entitlements', () => {
    fs.writeFileSync(path.join(scratch, 'Twice.entitlements'), '<string>$(PENNANT_APP_GROUP)</string>');
    const app = (group: string) => settings({ WRAPPER_EXTENSION: 'app', FULL_PRODUCT_NAME: 'Pennant.app', TARGET_NAME: 'Pennant',
      CODE_SIGN_ENTITLEMENTS: 'Twice.entitlements', PENNANT_APP_GROUP: group });
    const r = fill([app('TEAM.group.one'), app('TEAM.group.two')]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Pennant.app is listed more than once with different entitlements');
    // Named once and unnamed once is different too
    const bare = settings({ WRAPPER_EXTENSION: 'app', FULL_PRODUCT_NAME: 'Pennant.app', TARGET_NAME: 'Pennant' });
    expect(fill([app('TEAM.group.one'), bare]).status).not.toBe(0);
  });

  it('stops on a setting the target does not define', () => {
    fs.writeFileSync(path.join(scratch, 'Undefined.entitlements'), '<string>$(NOT_A_SETTING)</string>');
    const r = fill([settings({ WRAPPER_EXTENSION: 'app', FULL_PRODUCT_NAME: 'Pennant.app', TARGET_NAME: 'Pennant', CODE_SIGN_ENTITLEMENTS: 'Undefined.entitlements' })]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('NOT_A_SETTING');
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
    // A prebuilt helper with no extension and no executable bit is still Mach-O, and notarization rejects it unsigned
    bin('Resources/server/node_modules/zz-prebuilt/bin/helper');
    fs.chmodSync(path.join(c, 'Resources/server/node_modules/zz-prebuilt/bin/helper'), 0o644);
    // A Java class shares a universal binary's magic number; it is not code to sign
    fs.writeFileSync(path.join(c, 'Resources/server/node_modules/zz-prebuilt/Foo.class'), Buffer.from('cafebabe00000034', 'hex'));
    const fw = path.join(c, 'Frameworks/Sparkle.framework');
    const b = path.join(fw, 'Versions/B');
    for (const rel of ['Sparkle', 'Autoupdate', 'Updater.app/Contents/MacOS/Updater', 'XPCServices/Downloader.xpc/Contents/MacOS/Downloader',
      'XPCServices/Installer.xpc/Contents/MacOS/Installer']) {
      fs.mkdirSync(path.dirname(path.join(b, rel)), { recursive: true });
      fs.copyFileSync(machO, path.join(b, rel));
      fs.chmodSync(path.join(b, rel), 0o755);
    }
    info(path.join(b, 'Resources'), 'org.sparkle-project.Sparkle', 'Sparkle', 'FMWK');
    info(path.join(b, 'Updater.app/Contents'), 'org.sparkle-project.Sparkle.Updater', 'Updater');
    info(path.join(b, 'XPCServices/Downloader.xpc/Contents'), 'org.sparkle-project.DownloaderService', 'Downloader', 'XPC!');
    info(path.join(b, 'XPCServices/Installer.xpc/Contents'), 'org.sparkle-project.InstallerLauncher', 'Installer', 'XPC!');
    // As Sparkle 2.10.0 ships them: Autoupdate with an application identifier, the downloader with its sandbox
    const shipped = (rel: string, keys: string) => {
      const ent = path.join(scratch, name, `${path.basename(rel)}.shipped.entitlements`);
      fs.mkdirSync(path.dirname(ent), { recursive: true });
      fs.writeFileSync(ent, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${keys}</dict></plist>`);
      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', ent, path.join(b, rel)], { stdio: 'ignore' });
    };
    shipped('Autoupdate', '<key>com.apple.application-identifier</key><string>org.sparkle-project.Sparkle.Autoupdate</string>');
    shipped('XPCServices/Downloader.xpc', '<key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.network.client</key><true/>');
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
      'Contents/Resources/server/node_modules/zz-prebuilt/bin/helper',
      'Contents/Helpers/pennant-server',
      'Contents/Frameworks/Sparkle.framework/Versions/Current/Updater.app',
      'Contents/Frameworks/Sparkle.framework/Versions/Current/XPCServices/Downloader.xpc',
      'Contents/Frameworks/Sparkle.framework/Versions/Current/XPCServices/Installer.xpc',
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
    // Sparkle's helpers as its instructions sign them: the downloader keeps its sandbox, Autoupdate loses the application
    // identifier a Developer ID signature without a provisioning profile cannot carry
    const sparkle = path.join(c, 'Frameworks/Sparkle.framework/Versions/B');
    expect(entitlements(path.join(sparkle, 'XPCServices/Downloader.xpc'))).toContain('com.apple.security.app-sandbox');
    expect(entitlements(path.join(sparkle, 'Autoupdate'))).not.toContain('application-identifier');
    expect(flags(path.join(sparkle, 'Autoupdate'))).toMatch(/flags=0x\w+\([^)]*runtime[^)]*\)/);
  });

  it('stops on an app extension whose entitlements the build never read', () => {
    const { app, tsv } = fakeApp('unlisted-extension');
    fs.writeFileSync(tsv, 'Pennant.app\t\n');
    const r = run('sign-app.sh', [app, '-', tsv]);
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('PennantWidgets.appex is not in');
  });

  it('reads every target\'s entitlements, not only the scheme\'s, so the widget gets its own', () => {
    const build = uncommented(read('macos/scripts/releasing/build-app.sh'));
    expect(build).toMatch(/xcodebuild -project "\$\{PROJECT\}" -alltargets -configuration Release -showBuildSettings -json/);
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

  it('refuses entitlements whose build settings were never filled in', () => {
    const { app, tsv } = fakeApp('unfilled', '<key>com.apple.security.application-groups</key><array><string>$(PENNANT_APP_GROUP)</string></array>');
    const r = run('sign-app.sh', [app, '-', tsv]);
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('build setting');
  });

  it('refuses an app with no server inside', () => {
    const { app, tsv } = fakeApp('no-server');
    fs.rmSync(path.join(app, 'Contents/Helpers/pennant-server'));
    expect(run('sign-app.sh', [app, '-', tsv]).status).not.toBe(0);
  });
});

describe.runIf(onMac)('packing the DMG (make-dmg.sh)', () => {
  function tinyApp(name: string) {
    const app = path.join(scratch, 'dmg', name, 'Pennant.app');
    fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), '<plist version="1.0"><dict/></plist>\n');
    return app;
  }

  // A fresh CI checkout has no build/mac-release/unsigned/; the first real run failed there with no message
  it('makes the output\'s folder when it does not exist yet', () => {
    const dmg = path.join(scratch, 'dmg', 'fresh', 'not', 'made', 'Pennant-unsigned.dmg');
    const r = run('make-dmg.sh', [tinyApp('fresh'), dmg]);
    expect(r.err).toBe('');
    expect(r.status).toBe(0);
    expect(fs.existsSync(dmg)).toBe(true);
  }, 120_000);

  it('prints hdiutil\'s own error when it fails, never a silent exit', () => {
    const locked = path.join(scratch, 'dmg', 'locked');
    fs.mkdirSync(locked, { recursive: true });
    fs.chmodSync(locked, 0o555);
    try {
      const r = run('make-dmg.sh', [tinyApp('locked-app'), path.join(locked, 'Pennant.dmg')]);
      expect(r.status).not.toBe(0);
      expect(r.err).toContain('hdiutil create failed');
      // hdiutil's own words come before ours
      expect(r.err.trim().split('\n').length).toBeGreaterThan(1);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  }, 120_000);

  it('never hides hdiutil\'s output with -quiet', () => {
    for (const file of fs.readdirSync(SCRIPTS)) {
      expect(read(`macos/scripts/releasing/${file}`), file).not.toMatch(/hdiutil[^\n]*-quiet/);
    }
  });
});
