/**
 * Test-only shim for `node:sqlite`.
 *
 * Vite decides what counts as a Node builtin from `module.builtinModules`, which omits
 * `sqlite` on Node < 24 because the module is still flagged experimental there. Vite
 * therefore strips the `node:` prefix, tries to resolve `sqlite` from disk, and the
 * test run dies before it starts.
 *
 * `createRequire` is a runtime call, so Vite never sees the specifier and hands the
 * import straight to Node. Application code keeps a plain static `import { DatabaseSync }
 * from 'node:sqlite'`; only the test runner is aliased here (see vitest.config.ts).
 *
 * Delete this file, its alias, and the tsconfig entry once the toolchain's minimum
 * Node version is 24.
 */
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';

const require_ = createRequire(import.meta.url);
const sqlite = require_('node:sqlite') as typeof NodeSqlite;

export const { DatabaseSync } = sqlite;
export default sqlite;
