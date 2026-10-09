import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createIsolatedHome } from './spec-isolated-home.js';
import {
  resolveConfigDir,
  resolveConfigPaths,
  readLicenseKey,
  storeLicenseKey,
  migrateLegacyConfig,
  loadOrCreateDeviceId,
  writePrivateFile
} from './license-config.js';

const isPosix = process.platform !== 'win32';
const modeOf = (target) => fs.statSync(target).mode & 0o777;
const freshEnv = (extra = {}) => {
  const { home, xdg } = createIsolatedHome();
  return { HOME: home, XDG_CONFIG_HOME: xdg, ...extra };
};

test('config dir: uses $XDG_CONFIG_HOME/chemx', () => {
  assert.strictEqual(resolveConfigDir({ HOME: '/h', XDG_CONFIG_HOME: '/xdg' }), path.join('/xdg', 'chemx'));
});

test('config dir: defaults to ~/.config/chemx and ignores a relative XDG_CONFIG_HOME', () => {
  assert.strictEqual(resolveConfigDir({ HOME: '/h' }), path.join('/h', '.config', 'chemx'));
  assert.strictEqual(resolveConfigDir({ HOME: '/h', XDG_CONFIG_HOME: 'rel/dir' }), path.join('/h', '.config', 'chemx'));
});

test('storeLicenseKey: writes config.json with mode 0600 inside a 0700 dir', { skip: !isPosix }, () => {
  const env = freshEnv();
  const result = storeLicenseKey('CX-AAAA-BBBB-CCCC', env);
  const { dir, configFile } = resolveConfigPaths(env);
  assert.strictEqual(result.saved, true);
  assert.strictEqual(result.path, configFile);
  assert.strictEqual(modeOf(configFile), 0o600);
  assert.strictEqual(modeOf(dir), 0o700);
  assert.strictEqual(readLicenseKey(env), 'CX-AAAA-BBBB-CCCC');
});

test('writePrivateFile: tightens a pre-existing world-readable dir to 0700', { skip: !isPosix }, () => {
  const env = freshEnv();
  const { dir, configFile } = resolveConfigPaths(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  fs.chmodSync(dir, 0o755);
  writePrivateFile(configFile, '{}');
  assert.strictEqual(modeOf(dir), 0o700);
});

test('CHEMX_LICENSE_KEY: is read first and never persisted to disk', () => {
  const env = freshEnv({ CHEMX_LICENSE_KEY: 'cx-env-key-0001' });
  assert.strictEqual(readLicenseKey(env), 'cx-env-key-0001');
  const result = storeLicenseKey('CX-ENV-KEY-0001', env);
  assert.strictEqual(result.saved, false);
  assert.strictEqual(fs.existsSync(resolveConfigPaths(env).configFile), false);
});

test('migration: moves ~/.chemical-x into the XDG dir with 0600 files and removes the old copy', { skip: !isPosix }, () => {
  const env = freshEnv();
  const legacyDir = path.join(env.HOME, '.chemical-x');
  fs.mkdirSync(legacyDir, { mode: 0o755 });
  fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify({ licenseKey: 'CX-OLD-0000-0000' }), { mode: 0o644 });
  fs.writeFileSync(path.join(legacyDir, 'device_id'), 'cli_legacy123_1700000000000', { mode: 0o644 });

  assert.strictEqual(readLicenseKey(env), 'CX-OLD-0000-0000');
  const { configFile, deviceFile } = resolveConfigPaths(env);
  assert.strictEqual(modeOf(configFile), 0o600);
  assert.strictEqual(modeOf(deviceFile), 0o600);
  assert.strictEqual(fs.existsSync(legacyDir), false, 'legacy dir must be removed');
});

test('migration: keeps newer XDG values and leaves unknown legacy files in place', () => {
  const env = freshEnv();
  storeLicenseKey('CX-NEW-1111-1111', env);
  const legacyDir = path.join(env.HOME, '.chemical-x');
  fs.mkdirSync(legacyDir);
  fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify({ licenseKey: 'CX-OLD-0000-0000' }));
  fs.writeFileSync(path.join(legacyDir, 'notes.txt'), 'user data');

  const outcome = migrateLegacyConfig(env);
  assert.deepStrictEqual(outcome.migrated, []);
  assert.strictEqual(readLicenseKey(env), 'CX-NEW-1111-1111');
  assert.strictEqual(fs.existsSync(path.join(legacyDir, 'config.json')), false);
  assert.strictEqual(fs.existsSync(path.join(legacyDir, 'notes.txt')), true);
});

test('device id: new ids come from crypto.randomUUID', () => {
  const env = freshEnv();
  const id = loadOrCreateDeviceId(env);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.strictEqual(loadOrCreateDeviceId(env), id, 'id is stable across calls');
});

test('device id: an existing legacy id is kept', () => {
  const env = freshEnv();
  const legacyDir = path.join(env.HOME, '.chemical-x');
  fs.mkdirSync(legacyDir);
  fs.writeFileSync(path.join(legacyDir, 'device_id'), 'cli_keepme_1700000000000');
  assert.strictEqual(loadOrCreateDeviceId(env), 'cli_keepme_1700000000000');
});
