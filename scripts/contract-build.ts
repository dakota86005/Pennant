/**
 * `npm run contract:build`: writes the presentation contract, `contract/openapi.json`, from the server's TypeScript
 * types (`server/contract/`), and the tests' shape contract into the Swift package's shape tests. Commit both; the
 * drift test fails while either differs from a fresh build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SHAPES_SPEC_PATH, SPEC_PATH, buildShapesSpec, buildSpec, serializeSpec } from './lib/contractSpec.js';

for (const [file, spec] of [[SPEC_PATH, buildSpec()], [SHAPES_SPEC_PATH, buildShapesSpec()]] as const) {
  const text = serializeSpec(spec);
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(before === text ? `${path.relative(process.cwd(), file)} is up to date` : `wrote ${path.relative(process.cwd(), file)}`);
}
