import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findEslintConfig, resolveLintScope, fallbackNote, LINT_FALLBACK } from './lint-scope.js';

const PKG = (extra = {}) => JSON.stringify({ name: 'fixture', private: true, ...extra });

const withTree = (files, fn) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lint-scope-')));
  try {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('lint-scope: findEslintConfig sees a flat config, a legacy config and a package.json eslintConfig', () => {
  withTree({ 'flat/eslint.config.js': '', 'legacy/.eslintrc.json': '{}', 'inline/package.json': PKG({ eslintConfig: { root: true } }), 'none/package.json': PKG() }, (root) => {
    assert.deepEqual(findEslintConfig(path.join(root, 'flat')), { file: path.join(root, 'flat', 'eslint.config.js'), flat: true });
    assert.deepEqual(findEslintConfig(path.join(root, 'legacy')), { file: path.join(root, 'legacy', '.eslintrc.json'), flat: false });
    assert.deepEqual(findEslintConfig(path.join(root, 'inline')), { file: path.join(root, 'inline', 'package.json'), flat: false });
    assert.equal(findEslintConfig(path.join(root, 'none')), null);
  });
});

test('lint-scope: findEslintConfig looks in the ancestors, like ESLint', () => {
  withTree({ 'eslint.config.mjs': '', 'pkg/a/b/x.js': '' }, (root) => {
    assert.equal(findEslintConfig(path.join(root, 'pkg', 'a', 'b'))?.file, path.join(root, 'eslint.config.mjs'));
  });
});

test('lint-scope: a package without any ESLint config falls back to check', () => {
  withTree({ 'package.json': PKG() }, (root) => {
    assert.deepEqual(resolveLintScope(root), { root, fallback: LINT_FALLBACK.NO_ESLINT_CONFIG });
  });
});

test('lint-scope: a package with a config, a lint script or a custom command keeps ESLint (or its own runner)', () => {
  withTree({ 'with/package.json': PKG(), 'with/eslint.config.js': '', 'script/package.json': PKG({ scripts: { lint: 'biome check .' } }), 'bare/package.json': PKG() }, (root) => {
    assert.equal(resolveLintScope(path.join(root, 'with')).fallback, null);
    assert.equal(resolveLintScope(path.join(root, 'script')).fallback, null);
    assert.equal(resolveLintScope(path.join(root, 'bare'), { customCmd: 'eslint --no-eslintrc .' }).fallback, null);
  });
});

test('lint-scope: a directory inside a package lints from the package root', () => {
  withTree({ 'package.json': PKG(), 'src/deep/x.js': '' }, (root) => {
    assert.equal(resolveLintScope(path.join(root, 'src', 'deep')).root, root);
  });
});

test('lint-scope: a directory with no package.json anywhere is its own root and falls back', () => {
  withTree({ 'plugin/plugin.php': '<?php\n' }, (root) => {
    const plugin = path.join(root, 'plugin');
    assert.deepEqual(resolveLintScope(plugin), { root: plugin, fallback: LINT_FALLBACK.NO_PACKAGE_JSON });
  });
});

test('lint-scope: below a workspace root, a directory outside every package is its own root (a WordPress plugin dir)', () => {
  const files = { 'package.json': PKG(), 'eslint.config.js': '', 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n", 'apps/web/package.json': PKG({ name: 'web' }), 'wp-content/plugins/card/card.php': '<?php\n' };
  withTree(files, (root) => {
    const plugin = path.join(root, 'wp-content', 'plugins', 'card');
    assert.deepEqual(resolveLintScope(plugin), { root: plugin, fallback: LINT_FALLBACK.NO_PACKAGE_JSON });
    assert.equal(resolveLintScope(root).root, root, 'the workspace root stays the root when started there');
    assert.equal(resolveLintScope(path.join(root, 'apps', 'web')).root, path.join(root, 'apps', 'web'));
  });
});

test('lint-scope: the one-line note names the root, the file count and the reason', () => {
  assert.equal(fallbackNote('/r', 3, LINT_FALLBACK.NO_ESLINT_CONFIG), 'no ESLint config in /r; ran chemx check on 3 files instead');
  assert.equal(fallbackNote('/r', 1, LINT_FALLBACK.NO_ESLINT_CONFIG), 'no ESLint config in /r; ran chemx check on 1 file instead');
  assert.equal(fallbackNote('/r', 0, LINT_FALLBACK.NO_PACKAGE_JSON), 'no ESLint config in /r (no package.json); ran chemx check on 0 files instead');
});
