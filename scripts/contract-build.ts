/**
 * `npm run contract:build`: writes the presentation contract, `contract/openapi.json`, from the server's TypeScript
 * types (`server/contract/`), the tests' shape contract into the Swift package's shape tests, and the contract's digest
 * into PennantAPI (`ContractDigest.swift`). Commit all three; the drift test fails while any differs from a fresh build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DIGEST_SWIFT_PATH, SHAPES_SPEC_PATH, SPEC_PATH, buildShapesSpec, buildSpec, digestSwift, serializeSpec } from './lib/contractSpec.js';

const spec = serializeSpec(buildSpec());
for (const [file, text] of [[SPEC_PATH, spec], [SHAPES_SPEC_PATH, serializeSpec(buildShapesSpec())], [DIGEST_SWIFT_PATH, digestSwift(spec)]] as const) {
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(before === text ? `${path.relative(process.cwd(), file)} is up to date` : `wrote ${path.relative(process.cwd(), file)}`);
}
