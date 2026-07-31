/** Applies the schema to the configured database. Idempotent. */
import { getConfig, getLogger, initDatabase, SCHEMA_VERSION } from '@oc/core';

const cfg = getConfig();
const db = initDatabase(cfg.DB_PATH);
db.close();
getLogger().info({ path: cfg.DB_PATH, version: SCHEMA_VERSION }, 'schema applied');
