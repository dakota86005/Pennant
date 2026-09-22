---
paths:
  - "package.json"
  - "electron-builder.yml"
  - "server/project.ts"
  - "server/appInfo.ts"
  - "electron/main.ts"
  - "electron/updater.ts"
  - ".github/workflows/release.yml"
  - "CHANGELOG.md"
  - "LICENSE"
  - "tests/projectIdentity.test.ts"
---

# Project identity and releases: working reminder

This is a router, not the doctrine. The canonical detail is in `docs/DECISIONS.md` D-049, `docs/DEVELOPMENT.md`
("Versions", "Release tags", "Releases", "Application id and compatibility holds"), `docs/ARCHITECTURE.md`
"Subsystem responsibilities" (Identity and version) and `docs/PENNANT_CONSOLIDATION.md`. Where this file and
those documents differ, they win. `tests/projectIdentity.test.ts` pins every fact below.

These identities are different things; a Pennant rename of one says nothing about the others.

| Identity | Current value | Where |
|---|---|---|
| Product / display | Pennant | `productName`, window, installer, README, header |
| Application id | `com.dakotawise.pennant` | `electron-builder.yml` `appId`; must not change once an installer is published |
| Package name (held) | `ootp-front-office` | `package.json` `name`; names the desktop user-data folder |
| Environment / data (held) | `OOTP_FO_*`, `data/` | user configuration and persisted state |
| Version | one number | `package.json` `version`, read by `server/appInfo.ts`; lockfile and CHANGELOG agree |
| Release tag | `pennant-v<version>` | `RELEASE_TAG_PREFIX` in `server/project.ts`, `release.yml`, `publish.tagNamePrefix` |
| Release assets | `Pennant-<version>-<arch>.<ext>` | a literal `artifactName`, so the held name does not leak |
| Repository / feed | Pennant's (`origin`) | `server/project.ts`, `electron-builder.yml` `publish` |
| Upstream | `lsukev/ootp-front-office` | a credit only: README, CHANGELOG, Help menu, `LICENSE`, `docs/upstream/` |

- A held identifier changes only with a designed migration; none exists and none is attempted. Adding a
  `productName` to `package.json` would rename the data folder too. The keychain entry is a presumed hazard.
- Keep the tag prefix in its three places in agreement; the workflow refuses a tag that is not `pennant-v` +
  the `package.json` version. Use plain `X.Y.Z` (a prerelease breaks the updater's tag handling).
- The updater and links name Pennant's repository from one constant; upstream is never the feed.
- Keep upstream's copyright in `LICENSE` and the build's `copyright` line; nothing implies upstream endorses Pennant.
- Never create, move or delete tags, never fetch upstream's tags, and never publish without the owner.
- Not decided: renaming the GitHub repository, a package-name or data-folder migration (owner's call).
