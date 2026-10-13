/**
 * Each signed bundle's entitlements, as Xcode would sign them (build-app.sh, D-076). Reads `xcodebuild
 * -showBuildSettings -json` on standard input; for the app and each app extension whose target names an entitlements
 * file (CODE_SIGN_ENTITLEMENTS), writes that file with its build settings filled in (`$(PENNANT_APP_GROUP)` becomes
 * the target's App Group) to OUT_DIR/<product>.entitlements, and prints `<product>\t<file>` lines (an empty file
 * column for a bundle that names none). `$(TeamIdentifierPrefix)` and `$(AppIdentifierPrefix)` come from the signing
 * identity, so sign-app.sh fills those in; any other setting the target does not define stops the build.
 *
 *   xcodebuild … -showBuildSettings -json | node entitlements.mjs OUT_DIR > entitlements.tsv
 */
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('entitlements.mjs OUT_DIR');
fs.mkdirSync(out, { recursive: true });
const FROM_IDENTITY = new Set(['TeamIdentifierPrefix', 'AppIdentifierPrefix']);

/** A target's entitlements file as signed: its build settings filled in, the signing identity's left for sign-app.sh. */
function filled(b, named) {
  const source = path.isAbsolute(named) ? named : path.join(b.SRCROOT, named);
  return fs.readFileSync(source, 'utf8').replace(/\$[({](\w+)[)}]/g, (whole, name) => {
    if (FROM_IDENTITY.has(name)) return whole;
    if (b[name] === undefined || b[name] === '') {
      throw new Error(`${named} uses $(${name}), which ${b.TARGET_NAME} does not define in this configuration.`);
    }
    return b[name];
  });
}

const targets = JSON.parse(fs.readFileSync(0, 'utf8'));
// `-alltargets` can list a target more than once (the app has appeared twice, with identical settings): one row for each
// product, and a product listed again with other entitlements stops the build, since it could be signed only one way
const seen = new Map();
for (const { buildSettings: b } of targets) {
  if (!['app', 'appex'].includes(b.WRAPPER_EXTENSION)) continue;
  const named = b.CODE_SIGN_ENTITLEMENTS ?? '';
  const text = named ? filled(b, named) : '';
  if (seen.has(b.FULL_PRODUCT_NAME)) {
    if (seen.get(b.FULL_PRODUCT_NAME) !== text) {
      throw new Error(`${b.FULL_PRODUCT_NAME} is listed more than once with different entitlements; it can be signed only one way.`);
    }
    continue;
  }
  seen.set(b.FULL_PRODUCT_NAME, text);
  if (!named) {
    console.log(`${b.FULL_PRODUCT_NAME}\t`);
    continue;
  }
  const file = path.join(out, `${b.FULL_PRODUCT_NAME}.entitlements`);
  fs.writeFileSync(file, text);
  console.log(`${b.FULL_PRODUCT_NAME}\t${file}`);
}
