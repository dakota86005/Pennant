/**
 * `npm run contract:build`: writes the presentation contract, `contract/openapi.json`, from the server's TypeScript
 * types (`server/contract/`). Commit the result; the drift test fails while it differs from a fresh build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SPEC_PATH, buildSpec, serializeSpec } from './lib/contractSpec.js';

const text = serializeSpec(buildSpec());
const before = fs.existsSync(SPEC_PATH) ? fs.readFileSync(SPEC_PATH, 'utf8') : null;
fs.mkdirSync(path.dirname(SPEC_PATH), { recursive: true });
fs.writeFileSync(SPEC_PATH, text);
console.log(before === text ? `${path.relative(process.cwd(), SPEC_PATH)} is up to date` : `wrote ${path.relative(process.cwd(), SPEC_PATH)}`);
