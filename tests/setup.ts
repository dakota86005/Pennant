import { buildFixture } from './fixture';

// The server modules open their database at import time, so the fixture has to
// exist and OOTP_FO_DATA_DIR has to point at it before any of them load.
process.env.OOTP_FO_DATA_DIR = buildFixture();
process.env.OOTP_FO_APP_ROOT = process.cwd();
// The tests build and change their leagues through the server's own connection, which the app serves read-only
process.env.OOTP_FO_DB_WRITABLE = '1';
// An export a test has just written imports at once; the quiet period's own tests set theirs (exportFiles.ts)
process.env.OOTP_FO_EXPORT_QUIET_MS = '0';
