import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // See test/shims/node-sqlite.ts for why this indirection exists.
      // Removable once the toolchain's minimum Node version is 24.
      'node:sqlite': r('./test/shims/node-sqlite.ts'),
      '@oc/core': r('./packages/core/src/index.ts'),
      '@oc/ollama': r('./packages/ollama/src/index.ts'),
      '@oc/registry': r('./packages/registry/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    coverage: { reporter: ['text', 'lcov'], include: ['packages/**/src/**'] },
  },
});
