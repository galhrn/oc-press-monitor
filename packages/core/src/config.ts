/**
 * Environment configuration.
 *
 * Parsed and validated exactly once, at startup, against a zod schema. An invalid
 * environment fails the process immediately with a readable report rather than
 * surfacing as `undefined` three layers deep at 2am.
 *
 * Every variable here is documented in .env.example and in project_context.md section 9.
 */
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { ConfigError } from './errors.js';

loadDotenv();

const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((s) =>
      s
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
    );

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // --- storage ---
  DB_PATH: z.string().default('./data/press.sqlite'),

  // --- Ollama (AD-17, AD-18) ---
  OLLAMA_HOST: z.string().url().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('llama3.2:3b'),
  OLLAMA_ARBITER_MODEL: z.string().optional(),
  OLLAMA_CONCURRENCY: z.coerce.number().int().positive().max(32).default(3),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(1024),
  OLLAMA_NUM_PREDICT: z.coerce.number().int().positive().default(96),
  OLLAMA_KEEP_ALIVE: z.string().default('30m'),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  // --- collection ---
  NEWS_PROVIDERS: csv('gdelt,googlenews'),
  QUARTER_WINDOW_DAYS: z.coerce.number().int().positive().default(90),
  MAX_ITEMS_PER_COMPANY: z.coerce.number().int().positive().default(25),

  // --- alerting (AD-13) ---
  ALERT_CHANNELS: csv('console,file'),
  ALERT_FILE_PATH: z.string().default('./data/alerts.log.json'),
  ALERT_LOOKBACK_HOURS: z.coerce.number().int().positive().default(48),

  // --- scheduling (AD-12) ---
  CRON_SCHEDULE: z.string().default('0 8 * * *'),
  CRON_TIMEZONE: z.string().default('Asia/Jerusalem'),

  // --- api ---
  API_PORT: z.coerce.number().int().positive().default(3000),
});

export type AppConfig = Readonly<z.infer<typeof ConfigSchema>>;

let cached: AppConfig | undefined;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(source);
  if (!parsed.success) {
    const report = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${report}`, {
      context: { issues: parsed.error.issues.length },
    });
  }
  return Object.freeze(parsed.data);
}

/** Process-wide singleton. Use `loadConfig()` directly in tests to stay isolated. */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test seam - clears the memoised config. */
export function resetConfig(): void {
  cached = undefined;
}
