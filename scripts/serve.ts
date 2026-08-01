/** Dashboard server (P6.1, P6.8). `npm run serve` - one command, API plus built SPA. */
import { fileURLToPath } from 'node:url';
import { childLogger, getConfig, newRunId } from '@oc/core';
import { createApiFromPath } from '@oc/api';

const cfg = getConfig();
const log = childLogger({ runId: newRunId(), stage: 'api' });
const webDist = fileURLToPath(new URL('../apps/web/dist', import.meta.url));

const app = createApiFromPath(cfg.DB_PATH, {
  windowDays: cfg.QUARTER_WINDOW_DAYS,
  logger: log,
  webDist,
});

app.listen(cfg.API_PORT, () => {
  log.info(
    { port: cfg.API_PORT, db: cfg.DB_PATH, windowDays: cfg.QUARTER_WINDOW_DAYS },
    'API listening',
  );
  console.error(
    `\n  dashboard  http://localhost:${cfg.API_PORT}\n  api        http://localhost:${cfg.API_PORT}/api/companies\n`,
  );
});
