import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'coverage/**', '**/*.d.ts'] },
  js.configs.recommended,

  // Type-aware linting for TypeScript sources only.
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'always'],
    },
  },

  // Tooling written in plain JS is linted, but not type-aware: it is outside tsconfig by design.
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: nodeGlobals },
    rules: { 'no-console': 'off' },
  },

  // CLI entry points and tests print to stdout on purpose.
  { files: ['scripts/**/*.ts', 'packages/**/test/**/*.ts'], rules: { 'no-console': 'off' } },
);
