import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '@oc/core';

describe('loadConfig', () => {
  it('applies documented defaults when the environment is empty', () => {
    const cfg = loadConfig({});
    expect(cfg.OLLAMA_HOST).toBe('http://127.0.0.1:11434');
    expect(cfg.QUARTER_WINDOW_DAYS).toBe(90);
    expect(cfg.CRON_TIMEZONE).toBe('Asia/Jerusalem');
    // AD-18: context window is right-sized to our ~150-token inputs, not left at the default
    expect(cfg.OLLAMA_NUM_CTX).toBe(1024);
  });

  it('parses comma-separated lists', () => {
    expect(loadConfig({ ALERT_CHANNELS: 'console, file ,slack' }).ALERT_CHANNELS).toEqual([
      'console',
      'file',
      'slack',
    ]);
  });

  it('coerces numeric strings', () => {
    expect(loadConfig({ MAX_ITEMS_PER_COMPANY: '10' }).MAX_ITEMS_PER_COMPANY).toBe(10);
  });

  it('fails fast and names the offending variable', () => {
    expect(() => loadConfig({ OLLAMA_HOST: 'not-a-url' })).toThrow(ConfigError);
    try {
      loadConfig({ OLLAMA_HOST: 'not-a-url' });
    } catch (e) {
      expect((e as Error).message).toContain('OLLAMA_HOST');
    }
  });

  it('returns a frozen object so config cannot drift at runtime', () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });
});
