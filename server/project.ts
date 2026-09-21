/**
 * Who this product is and where it lives.
 *
 * Deliberately import-free: the Electron shell needs these before it has set the
 * environment the server modules read at load time, so nothing here may pull in
 * `config.ts` (which creates the data directory the moment it is imported).
 */

export const PRODUCT_NAME = 'Pennant';

/** Pennant's own repository. Releases, the updater feed and the Help menu point here. */
export const PROJECT_URL = 'https://github.com/dakota86005/ootp-front-office';
export const RELEASES_URL = `${PROJECT_URL}/releases`;

/**
 * Pennant's release tag is `pennant-v<package version>` (D-049), never a bare `v<version>`.
 * Upstream's tags are `v0.1.0` … `v0.40.1`, so a `v*` namespace would collide with them in
 * any clone that also holds the upstream remote's tags, and the release workflow's `v*`
 * trigger would fire on them. The prefix is also spelled out in two files that cannot
 * import this one (`.github/workflows/release.yml`, `electron-builder.yml`); a test keeps
 * all three in agreement.
 */
export const RELEASE_TAG_PREFIX = 'pennant-v';
export const releaseTag = (version: string): string => `${RELEASE_TAG_PREFIX}${version}`;

/**
 * The project Pennant began as a fork of. Kept as a link, never as the update feed:
 * upstream's releases are upstream's product and carry upstream's version numbers.
 */
export const UPSTREAM_URL = 'https://github.com/lsukev/ootp-front-office';
