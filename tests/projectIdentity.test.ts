import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import request from './request.js';
import { appInfo, appVersion } from '../server/appInfo.js';
import { PRODUCT_NAME, PROJECT_URL, RELEASES_URL, RELEASE_TAG_PREFIX, UPSTREAM_URL, releaseTag } from '../server/project.js';

/**
 * What the project says it is, and that it says it once.
 *
 * These are consistency checks over the identity surfaces, not a ban on the old name:
 * "ootp-front-office" is correctly the package name, the repository, and upstream's
 * name in the attribution, so no test greps the whole tree for it. What is pinned is
 * that the version has ONE source, that the surfaces a user sees say Pennant, that
 * the update feed and the release tags cannot point at upstream, that the application
 * id is Pennant's own, and that the identifiers held back on purpose (D-049) are not
 * renamed by accident.
 */
const read = (path: string): string => readFileSync(path, 'utf8');
const pkg = JSON.parse(read('package.json')) as { name: string; version: string; author?: string };

describe('the version has one source', () => {
  it('is a pre-1.0 semantic version', () => {
    expect(pkg.version).toMatch(/^0\.\d+\.\d+$/);
  });

  it('is what the server reports, read from package.json and not copied', () => {
    expect(appVersion()).toBe(pkg.version);
    expect(appInfo()).toMatchObject({ name: PRODUCT_NAME, version: pkg.version });
  });

  it('is what the status route hands the UI', async () => {
    const status = await request('/api/status');
    expect(status.app).toEqual(appInfo());
    expect(status.app.name).toBe('Pennant');
    expect(status.app.version).toBe(pkg.version);
  });

  it('agrees with the lockfile', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      name: string;
      version: string;
      packages: Record<string, { name?: string; version?: string }>;
    };
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
    expect(lock.name).toBe(pkg.name);
  });

  it('is the newest release the changelog records', () => {
    const headings = [...read('CHANGELOG.md').matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0]).toBe(pkg.version);
  });
});

describe('the surfaces a user sees say Pennant', () => {
  it('names the browser tab, the README, the installer and the desktop window', () => {
    expect(read('index.html')).toContain('<title>Pennant</title>');
    expect(read('README.md').split('\n')[0]).toBe('# Pennant');
    const builder = read('electron-builder.yml');
    expect(builder).toMatch(/^productName: Pennant$/m);
    expect(builder).toMatch(/^\s+shortcutName: Pennant$/m);
    expect(read('electron/main.ts')).toContain('title: PRODUCT_NAME');
    expect(PRODUCT_NAME).toBe('Pennant');
  });

  it('never presents the old product name in the installer config or the desktop shell', () => {
    for (const file of ['electron-builder.yml', 'electron/main.ts', 'electron/updater.ts', 'index.html']) {
      expect(read(file), file).not.toMatch(/OOTP Front Office/);
    }
  });

  it('names release assets without spaces, from a literal rather than the held package name', () => {
    const artifact = read('electron-builder.yml').match(/^artifactName: (.+)$/m)?.[1] ?? '';
    expect(artifact).toBe('Pennant-${version}-${arch}.${ext}');
    expect(artifact).not.toMatch(/\s/);
  });

  it('ships an icon that exists', () => {
    for (const [, path] of read('electron-builder.yml').matchAll(/^\s+icon: (\S+)$/gm)) {
      expect(existsSync(path), path).toBe(true);
    }
    expect(existsSync('public/favicon.png')).toBe(true);
  });
});

describe('the update feed and the links point at Pennant, never at upstream', () => {
  it('publishes to the repository the app links to', () => {
    const builder = read('electron-builder.yml');
    const owner = builder.match(/^\s+owner: (\S+)$/m)?.[1];
    const repo = builder.match(/^\s+repo: (\S+)$/m)?.[1];
    expect(`https://github.com/${owner}/${repo}`).toBe(PROJECT_URL);
    expect(RELEASES_URL.startsWith(PROJECT_URL)).toBe(true);
    expect(PROJECT_URL).not.toBe(UPSTREAM_URL);
  });

  it('keeps upstream as a credit: only server/project.ts names it, and the desktop shell reads it from there', () => {
    for (const file of readdirSync('electron')) {
      expect(read(`electron/${file}`), file).not.toContain('lsukev');
    }
    expect(read('server/project.ts')).toContain('lsukev');
  });
});

describe('the application id is Pennant\'s own (D-049)', () => {
  it('is com.dakotawise.pennant, no longer upstream\'s', () => {
    const builder = read('electron-builder.yml');
    expect(builder).toMatch(/^appId: com\.dakotawise\.pennant$/m);
    expect(builder).not.toMatch(/^appId:.*lsukev/m);
    expect(builder).not.toMatch(/^appId: com\.lsukev\.ootpfrontoffice/m);
  });

  it('names the author', () => {
    expect(pkg.author).toBe('Dakota Wise');
  });
});

describe('release tags are pennant-v<version>, never upstream\'s v<version> (D-049)', () => {
  const workflow = read('.github/workflows/release.yml');

  it('builds a tag from the one version', () => {
    expect(RELEASE_TAG_PREFIX).toBe('pennant-v');
    expect(releaseTag(pkg.version)).toBe(`pennant-v${pkg.version}`);
  });

  it('cannot be mistaken for, or matched by a pattern for, an upstream tag', () => {
    // Upstream's tags are v0.1.0 … v0.40.1
    for (const upstream of ['v0.1.0', 'v0.27.2', 'v0.40.1']) {
      expect(upstream.startsWith(RELEASE_TAG_PREFIX)).toBe(false);
    }
    expect(RELEASE_TAG_PREFIX.startsWith('v')).toBe(false);
  });

  it('is the only tag the release workflow triggers on', () => {
    expect(workflow).toContain("tags: ['pennant-v*']");
    expect(workflow).not.toMatch(/tags:\s*\[\s*'v\*'/);
    expect(workflow).not.toContain("refs/tags/v'");
    expect([...workflow.matchAll(/refs\/tags\/([\w-]*)'/g)].map((m) => m[1])).toEqual(['pennant-v', 'pennant-v']);
  });

  it('is guarded against package.json in the workflow with the same prefix', () => {
    expect(workflow).toContain(`expected="${RELEASE_TAG_PREFIX}$(node -p "require('./package.json').version")"`);
  });

  it('is the prefix electron-builder would use if it ever published by hand', () => {
    expect(read('electron-builder.yml')).toMatch(new RegExp(`^\\s+tagNamePrefix: ${RELEASE_TAG_PREFIX}$`, 'm'));
  });

  it('is what the desktop updater links to for release notes', () => {
    const updater = read('electron/updater.ts');
    expect(updater).toContain('releaseTag(info.version)');
    expect(updater).not.toMatch(/\/tag\/v\$\{/);
  });

  it('is what the documentation tells you to type', () => {
    expect(read('docs/DEVELOPMENT.md')).toContain(`git tag ${releaseTag('<x.y.z>')}`);
    expect(read('CHANGELOG.md')).toContain(`/releases/tag/${releaseTag(pkg.version)}`);
  });
});

describe('the identifiers still held back on purpose (D-049)', () => {
  // Renaming the package name is a migration, not a cosmetic edit: Electron names the
  // desktop user-data folder from it, and there is no migration. If you are here because
  // this failed, read D-049 before "fixing" the test.
  it('keeps the package name that names the desktop data folder', () => {
    expect(pkg.name).toBe('ootp-front-office');
  });

  it('adds no productName to package.json, which would rename the data folder', () => {
    // Electron takes the folder from productName when it exists, else from name
    expect(pkg).not.toHaveProperty('productName');
  });

  it('keeps the OOTP_FO_ configuration variables the README documents', () => {
    const config = read('server/config.ts');
    expect(config).toContain('OOTP_FO_DATA_DIR');
    expect(config).toContain('OOTP_FO_APP_ROOT');
  });
});

describe('upstream attribution survives', () => {
  it('keeps the MIT notice with upstream\'s copyright', () => {
    expect(read('LICENSE')).toContain('Copyright (c) 2026 Kevin Ivy');
    expect(read('electron-builder.yml')).toContain('Kevin Ivy');
  });

  it('credits upstream and states the fork in the README', () => {
    const readme = read('README.md');
    expect(readme).toContain(UPSTREAM_URL);
    expect(readme.toLowerCase()).toContain('fork');
  });

  it('keeps upstream\'s own release notes, out of the root', () => {
    expect(existsSync('docs/upstream/README.md')).toBe(true);
    expect(readdirSync('.').filter((f) => /^CHANGELOG-.*\.txt$/.test(f))).toEqual([]);
  });
});
