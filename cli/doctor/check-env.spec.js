// Doctor jest layout check: a pnpm install keeps some packages only under node_modules/.pnpm/node_modules,
// where jest finds a bare snapshotSerializers or transform name only when NODE_PATH points there.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkJestLayout } from './check-env.js';

const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const tempDir = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); created.push(dir); return dir; };
const writeFile = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const installHoisted = (root, name) => writeFile(path.join(root, 'node_modules', name, 'package.json'), '{}');
const installPnpmOnly = (root, name) => writeFile(path.join(root, 'node_modules', '.pnpm', 'node_modules', name, 'package.json'), '{}');
const PRESET = '@vue/cli-plugin-unit-jest/presets/typescript-and-babel';

// The shape of a vue-cli app: the config names a preset, the preset names the serializer and requires its parent preset.
const makeVueCliApp = ({ serializerHoisted = false } = {}) => {
  const root = tempDir('chemx-jest-layout-');
  const presets = path.join(root, 'node_modules', '@vue', 'cli-plugin-unit-jest', 'presets');
  writeFile(path.join(presets, 'typescript-and-babel', 'jest-preset.js'), "const base = require('../typescript/jest-preset')\nmodule.exports = base\n");
  writeFile(path.join(presets, 'typescript', 'jest-preset.js'), "const base = require('../default/jest-preset')\nmodule.exports = base\n");
  writeFile(path.join(presets, 'default', 'jest-preset.js'), "module.exports = {\n  snapshotSerializers: [\n    'jest-serializer-vue'\n  ],\n}\n");
  writeFile(path.join(root, 'jest.config.json'), JSON.stringify({ preset: PRESET, transform: { '^.+\\.vue$': '<rootDir>/tests/vue-transform.js', '^.+\\.ts$': 'ts-jest' } }));
  installHoisted(root, 'ts-jest');
  if (serializerHoisted) installHoisted(root, 'jest-serializer-vue');
  else installPnpmOnly(root, 'jest-serializer-vue');
  return root;
};

test('flags a serializer that resolves only under .pnpm/node_modules, names the NODE_PATH fix and that chemx test applies it', () => {
  const root = makeVueCliApp();
  const result = checkJestLayout({ projectRoot: root, nodePath: '' });
  assert.deepEqual([result.id, result.status, result.fixable], ['jest-deps', 'inconclusive', false]);
  const pnpmDir = path.join(root, 'node_modules', '.pnpm', 'node_modules');
  assert.match(result.summary, /jest-serializer-vue \(snapshotSerializers of the preset\) resolves only under node_modules\/\.pnpm\/node_modules/);
  assert.ok(result.summary.includes(`raw jest run needs NODE_PATH=${pnpmDir}`), result.summary);
  assert.match(result.summary, /chemx test puts it on NODE_PATH/);
});

test('a NODE_PATH that already covers .pnpm/node_modules passes, as does a fully hoisted install', () => {
  const root = makeVueCliApp();
  const pnpmDir = path.join(root, 'node_modules', '.pnpm', 'node_modules');
  const covered = checkJestLayout({ projectRoot: root, nodePath: ['/elsewhere', pnpmDir].join(path.delimiter) });
  assert.equal(covered.status, 'pass');
  assert.match(covered.summary, /NODE_PATH covers/);
  const hoisted = makeVueCliApp({ serializerHoisted: true });
  fs.mkdirSync(path.join(hoisted, 'node_modules', '.pnpm', 'node_modules'), { recursive: true });
  const result = checkJestLayout({ projectRoot: hoisted, nodePath: '' });
  assert.equal(result.status, 'pass');
  assert.match(result.summary, /resolve from node_modules \(\d+ checked\)/);
});

test('reads direct snapshotSerializers and bare transform names too, from jest.config.json or package.json', () => {
  const root = tempDir('chemx-jest-direct-');
  installPnpmOnly(root, 'jest-serializer-vue');
  installPnpmOnly(root, '@vue/vue3-jest');
  installHoisted(root, 'babel-jest');
  writeFile(path.join(root, 'package.json'), JSON.stringify({ jest: { snapshotSerializers: ['jest-serializer-vue'], transform: { '^.+\\.vue$': '@vue/vue3-jest', '^.+\\.js$': ['babel-jest', {}] } } }));
  const result = checkJestLayout({ projectRoot: root, nodePath: '' });
  assert.equal(result.status, 'inconclusive');
  assert.match(result.summary, /jest-serializer-vue \(snapshotSerializers\), @vue\/vue3-jest \(transform\)/);
  assert.doesNotMatch(result.summary, /babel-jest/);
});

test('reads preset and serializers out of a jest.config.js without running it', () => {
  const root = tempDir('chemx-jest-js-');
  installPnpmOnly(root, 'jest-serializer-vue');
  writeFile(path.join(root, 'jest.config.js'), "module.exports = {\n  snapshotSerializers: ['jest-serializer-vue'],\n  transform: { '^.+\\\\.vue$': '<rootDir>/t.js' },\n}\n");
  assert.equal(checkJestLayout({ projectRoot: root, nodePath: '' }).status, 'inconclusive');
});

test('not applicable (null): no pnpm layout, no jest config, or nothing bare to resolve', () => {
  const npmRoot = tempDir('chemx-jest-npm-');
  writeFile(path.join(npmRoot, 'jest.config.json'), JSON.stringify({ snapshotSerializers: ['jest-serializer-vue'] }));
  assert.equal(checkJestLayout({ projectRoot: npmRoot, nodePath: '' }), null);
  const noConfig = tempDir('chemx-jest-none-');
  fs.mkdirSync(path.join(noConfig, 'node_modules', '.pnpm', 'node_modules'), { recursive: true });
  assert.equal(checkJestLayout({ projectRoot: noConfig, nodePath: '' }), null);
  writeFile(path.join(noConfig, 'jest.config.json'), JSON.stringify({ transform: { '^.+\\.vue$': '<rootDir>/t.js' } }));
  assert.equal(checkJestLayout({ projectRoot: noConfig, nodePath: '' }), null);
});
