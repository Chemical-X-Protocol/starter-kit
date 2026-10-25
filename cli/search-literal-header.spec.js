/**
 * The `chemx q -g` header names at most 5 scoped paths and counts the rest (#6773): a shell-expanded
 * glob (q -g foo cli/*.js) used to print every file, 498 names in the header, on each call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describeScopePaths, HEADER_PATH_CAP } from './search-literal-view.js';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(CLI_DIR, '..');
const names = (count) => Array.from({ length: count }, (_, i) => `cli/f${i}.js`);

test('the cap is 5', () => {
  assert.equal(HEADER_PATH_CAP, 5);
});

test('up to the cap every path is listed, comma-joined as before', () => {
  assert.equal(describeScopePaths(['.']), '.');
  assert.equal(describeScopePaths(names(5)), names(5).join(','));
});

test('past the cap the first five are listed and the rest counted', () => {
  assert.equal(describeScopePaths(names(6)), `${names(5).join(',')} (+1 more)`);
  assert.equal(describeScopePaths(names(498)), `${names(5).join(',')} (+493 more)`);
});

test('the printed header of a many-path q -g stays short; the JSON scope keeps every path', () => {
  const files = ['search-literal.js', 'search-literal-view.js', 'search-literal-files.js', 'search-commands.js', 'search-commands-literal.js', 'search-root.js', 'search-scope-check.js']
    .map((name) => `cli/${name}`);
  const text = spawnSync(process.execPath, [path.join(CLI_DIR, 'index.js'), 'q', '-g', 'resolveSearchScope', ...files], { cwd: KIT_ROOT, encoding: 'utf-8' });
  const header = text.stdout.split('\n').find((line) => line.includes('searched '));
  assert.match(header, /in cli\/search-commands-literal\.js,.* \(\+2 more\) under /);
  assert.ok(!header.includes('cli/search-scope-check.js'), header);
  const json = spawnSync(process.execPath, [path.join(CLI_DIR, 'index.js'), 'q', '-g', 'resolveSearchScope', ...files, '--json'], { cwd: KIT_ROOT, encoding: 'utf-8' });
  assert.equal(JSON.parse(json.stdout).scope.split(',').length, 7);
});
