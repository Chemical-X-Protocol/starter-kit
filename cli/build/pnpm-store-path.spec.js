// NODE_PATH for pnpm layouts (task #6754): jest resolves a snapshot serializer or transform that the
// config names from the project root; pnpm keeps such packages only in node_modules/.pnpm/node_modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pnpmStoreDir, storeOnlyModules, storeNodePath, withPnpmStorePath } from './pnpm-store-path.js';

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};

const writePackage = (dir, main = 'module.exports = {};\n') => {
  writeJson(path.join(dir, 'package.json'), { name: path.basename(dir), main: 'index.js' });
  fs.writeFileSync(path.join(dir, 'index.js'), main);
};

// A pnpm-looking project: `store` packages live in node_modules/.pnpm/node_modules, `linked` ones are also
// linked at node_modules/<name>. `config` is the jest.config.json content.
const withPnpmProject = async ({ config = null, store = [], linked = [], files = {} }, body) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-pnpm-'));
  try {
    writeJson(path.join(root, 'package.json'), { name: 'app' });
    if (config) writeJson(path.join(root, 'jest.config.json'), config);
    for (const name of store) writePackage(path.join(pnpmStoreDir(root), name));
    for (const name of linked) writePackage(path.join(root, 'node_modules', name));
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), content);
    }
    return await body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('storeOnlyModules: a serializer and a transform the config names that only the pnpm store holds', async () => {
  const config = { snapshotSerializers: ['fake-serializer'], transform: { '^.+\\.vue$': 'fake-transform', '^.+\\.js$': '<rootDir>/tests/x.js' } };
  await withPnpmProject({ config, store: ['fake-serializer', 'fake-transform'] }, (root) => {
    assert.deepEqual(storeOnlyModules(root).names, ['fake-serializer', 'fake-transform']);
  });
});

test('storeOnlyModules: a module that also resolves from the project root is not store-only', async () => {
  const config = { snapshotSerializers: ['fake-serializer', 'linked-one'] };
  await withPnpmProject({ config, store: ['fake-serializer', 'linked-one'], linked: ['linked-one'] }, (root) => {
    assert.deepEqual(storeOnlyModules(root).names, ['fake-serializer']);
  });
});

test('storeOnlyModules: names the preset brings are read too (a JS preset, as @vue/cli-plugin-unit-jest has)', async () => {
  const preset = "module.exports = { snapshotSerializers: ['preset-serializer'], transform: { '^.+\\\\.vue$': ['preset-transform', {}] } };\n";
  await withPnpmProject({
    config: { preset: 'fake-preset' },
    store: ['preset-serializer', 'preset-transform'],
    files: { 'node_modules/fake-preset/package.json': '{"name":"fake-preset"}', 'node_modules/fake-preset/jest-preset.js': preset }
  }, (root) => {
    assert.deepEqual(storeOnlyModules(root).names, ['preset-serializer', 'preset-transform']);
  });
});

test('storeOnlyModules: reads the jest key of package.json and a CommonJS jest.config.js', async () => {
  await withPnpmProject({ store: ['from-pkg'], files: { 'package.json': JSON.stringify({ jest: { snapshotSerializers: ['from-pkg'] } }) } }, (root) => {
    assert.deepEqual(storeOnlyModules(root).names, ['from-pkg']);
  });
  await withPnpmProject({ store: ['from-js'], files: { 'jest.config.js': "module.exports = { snapshotSerializers: ['from-js'] };\n" } }, (root) => {
    assert.deepEqual(storeOnlyModules(root).names, ['from-js']);
  });
});

test('storeOnlyModules: nothing without a pnpm store, without a jest config, or when the config is unreadable', async () => {
  await withPnpmProject({ config: { snapshotSerializers: ['missing-everywhere'] } }, (root) => {
    assert.deepEqual(storeOnlyModules(root).names, []);
  });
  await withPnpmProject({ store: ['fake-serializer'] }, (root) => {
    assert.deepEqual(storeOnlyModules(root).names, []);
  });
  await withPnpmProject({ store: ['x'], files: { 'jest.config.js': "throw new Error('boom');\n" } }, (root) => {
    const found = storeOnlyModules(root);
    assert.deepEqual(found.names, []);
    assert.match(found.error, /boom/);
  });
});

test('storeNodePath: the store becomes NODE_PATH, an existing NODE_PATH stays after it', async () => {
  await withPnpmProject({ config: { snapshotSerializers: ['fake-serializer'] }, store: ['fake-serializer'] }, (root) => {
    const found = storeNodePath(root, {});
    assert.equal(found.NODE_PATH, pnpmStoreDir(root));
    assert.deepEqual(found.names, ['fake-serializer']);
    assert.equal(storeNodePath(root, { NODE_PATH: '/elsewhere' }).NODE_PATH, `${pnpmStoreDir(root)}${path.delimiter}/elsewhere`);
  });
});

test('storeNodePath: null when the store is already on NODE_PATH or nothing needs it', async () => {
  await withPnpmProject({ config: { snapshotSerializers: ['fake-serializer'] }, store: ['fake-serializer'] }, (root) => {
    assert.equal(storeNodePath(root, { NODE_PATH: pnpmStoreDir(root) }), null);
  });
  await withPnpmProject({ config: { snapshotSerializers: ['linked-one'] }, store: ['linked-one'], linked: ['linked-one'] }, (root) => {
    assert.equal(storeNodePath(root, {}), null);
  });
});

test('withPnpmStorePath: returns the env with NODE_PATH set, or the same env when there is nothing to add', async () => {
  await withPnpmProject({ config: { snapshotSerializers: ['fake-serializer'] }, store: ['fake-serializer'] }, (root) => {
    const env = { PATH: '/bin' };
    assert.equal(withPnpmStorePath(env, root).NODE_PATH, pnpmStoreDir(root));
    assert.equal(env.NODE_PATH, undefined, 'the input env is not changed');
  });
  const plain = { PATH: '/bin' };
  assert.equal(withPnpmStorePath(plain, os.tmpdir()), plain);
});
