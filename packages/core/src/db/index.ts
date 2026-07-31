/**
 * SQLite connection + migrations (AD-04).
 *
 * Uses `node:sqlite`, built into the Node runtime. This replaced `better-sqlite3`
 * (see the v0.7.0 changelog): that package is a native addon, so on a machine without
 * Visual Studio C++ Build Tools `npm install` fails at node-gyp. A take-home whose
 * install step can fail on the reviewer's machine is a take-home that does not get run.
 * `node:sqlite` needs no compiler, no prebuilt binary and no third-party dependency.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageError } from '../errors.js';

export type Db = DatabaseSync;

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));
export const SCHEMA_VERSION = 1;

export interface OpenOptions {
  /** ':memory:' gives each test its own isolated database. */
  path: string;
  readonly?: boolean;
}

export function openDatabase({ path, readonly = false }: OpenOptions): Db {
  try {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    const db = new DatabaseSync(path, { readOnly: readonly, enableForeignKeyConstraints: true });
    if (!readonly && path !== ':memory:') {
      // WAL keeps the daily job's writes from blocking the dashboard's reads.
      db.exec('PRAGMA journal_mode = WAL');
    }
    db.exec('PRAGMA busy_timeout = 5000');
    return db;
  } catch (cause) {
    throw new StorageError(`Could not open database at ${path}`, { cause, context: { path } });
  }
}

/** Idempotent. Safe to call on every boot. */
export function migrate(db: Db): number {
  try {
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    const applied = db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(SCHEMA_VERSION) as { version: number } | undefined;
    if (!applied) {
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        SCHEMA_VERSION,
        new Date().toISOString(),
      );
    }
    return SCHEMA_VERSION;
  } catch (cause) {
    throw new StorageError('Migration failed', { cause });
  }
}

/** Opens and migrates in one step - the only entry point application code should need. */
export function initDatabase(path: string): Db {
  const db = openDatabase({ path });
  migrate(db);
  return db;
}

let savepointCounter = 0;

/**
 * Runs `fn` atomically.
 *
 * `node:sqlite` has no `db.transaction()` helper, so this is implemented with
 * SAVEPOINTs rather than BEGIN/COMMIT: savepoints nest safely, which matters because
 * a repository method that manages its own atomicity may still be called from inside
 * a larger transaction.
 */
export function withTransaction<T>(db: Db, fn: () => T): T {
  const name = `sp_${++savepointCounter}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    try {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
    } catch {
      /* the outer failure is the one worth reporting */
    }
    throw error;
  }
}

/**
 * `node:sqlite` types every column as `SQLOutputValue`, so a row is
 * `Record<string, SQLOutputValue>` and will not narrow to a domain shape directly.
 * These two helpers are the single, documented place that assertion happens - the
 * row interfaces next to each query are the contract, and the schema enforces it.
 */
export const rowsAs = <T>(rows: readonly unknown[]): T[] => rows as T[];
export const rowAs = <T>(row: unknown): T | undefined => (row ?? undefined) as T | undefined;

/** `node:sqlite` reports counters as number | bigint depending on magnitude. */
export const changesOf = (result: { changes: number | bigint }): number => Number(result.changes);
