// ESLint for the kit itself, so `chemx lint` works here and in CI (K12, #6757). ESLint 9 flat config.
//
// What it is for: bugs (a name used but never defined, a duplicate key, unreachable code) plus the
// AGENTS.md rules a linter can state: no nested ternaries (3.D), no silent catch (a catch needs a
// body, even a comment saying why: 1.H), no `var`. What it is not for: the rules only chemx can see
// (named booleans 3.A, keyed dispatch over switch 3.E, the 250 line budget). `chemx lint <paths>` folds
// those micro-checks into the same pass; `chemx audit` scores the project.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // Fixtures hold broken or foreign code on purpose; blueprints and library pieces are templates.
    ignores: ['node_modules/**', 'scratch/**', 'coverage/**', '**/fixtures/**', 'blueprints/**', 'library/**/*.tpl.*', 'cli/generator-templates/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-nested-ternary': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-unused-vars': ['warn', { args: 'after-used', ignoreRestSiblings: true, caughtErrors: 'none' }],
      'no-constant-condition': ['error', { checkLoops: false }],
      // Style rules the kit deliberately breaks: ANSI strippers match \x1b, regexes keep defensive
      // escapes, and Boolean(x) is how a named boolean is made (3.A).
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-regex-spaces': 'off',
      'no-extra-boolean-cast': 'off'
    }
  },
  {
    // The fuzz harness feeds sparse arrays to the code under test on purpose.
    files: ['cli/forge/fuzz/**'],
    rules: { 'no-sparse-arrays': 'off' }
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } }
  }
];
