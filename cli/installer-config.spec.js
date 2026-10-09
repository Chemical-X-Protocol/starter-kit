// Ported from 3bd3f39 (installer merge), 7f9fcba (commented or unparsable config) and
// 4cc1188 (blank config): re-installing never throws away .chemx/config.json settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildInstallerProjectConfig, saveInstallerProjectConfig, readExistingProjectConfig } from './installer.js';

const captureStdout = (fn) => {
  const originalWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += String(chunk);
    return true;
  };
  try {
    return { result: fn(), output: captured };
  } finally {
    process.stdout.write = originalWrite;
  }
};

const withSavedConfig = (content, run) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-installer-config-'));
  const configPath = path.join(tmpDir, '.chemx', 'config.json');
  if (content !== null) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, content, 'utf-8');
  }
  try {
    run(tmpDir, configPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

const OPTS = { minGrade: 'B', minScore: 80 };
const readSaved = (configPath) => JSON.parse(fs.readFileSync(configPath, 'utf-8'));

test('buildInstallerProjectConfig writes grade and score and no line budgets', () => {
  assert.deepEqual(buildInstallerProjectConfig(OPTS), { minGrade: 'B', minScore: 80 });
  assert.deepEqual(buildInstallerProjectConfig(OPTS, { maxLineCount: 500, maxMoleculeLineCount: 100, profile: 'loose' }), { profile: 'loose', minGrade: 'B', minScore: 80 });
});

test('re-installing keeps pillars and framework and drops the legacy line-budget keys', () => {
  const legacy = { framework: 'vue', pillars: { molecularLineBudgets: true }, minGrade: 'A', maxLineCount: 500, maxMoleculeLineCount: 100 };
  withSavedConfig(JSON.stringify(legacy), (tmpDir, configPath) => {
    const { result } = captureStdout(() => saveInstallerProjectConfig(tmpDir, OPTS));
    assert.equal(result, true);
    assert.deepEqual(readSaved(configPath), { framework: 'vue', pillars: { molecularLineBudgets: true }, minGrade: 'B', minScore: 80 });
  });
});

test('re-installing keeps profile and pillars from a plain and from a commented config', () => {
  for (const content of ['{"profile":"atomic-strict","pillars":{"a":true}}', '// team\n{"profile":"atomic-strict","pillars":{"a":true}}']) {
    withSavedConfig(content, (tmpDir, configPath) => {
      const { result } = captureStdout(() => saveInstallerProjectConfig(tmpDir, OPTS));
      assert.equal(result, true);
      assert.deepEqual(readSaved(configPath), { profile: 'atomic-strict', pillars: { a: true }, minGrade: 'B', minScore: 80 });
    });
  }
});

test('an unparsable config is kept byte for byte and the installer warns', () => {
  const broken = '{"profile":"atomic-strict",,"pillars":{"a":true}}';
  withSavedConfig(broken, (tmpDir, configPath) => {
    const { result, output } = captureStdout(() => saveInstallerProjectConfig(tmpDir, OPTS));
    assert.equal(result, false);
    assert.equal(fs.readFileSync(configPath, 'utf-8'), broken);
    assert.match(output, /Kept \.chemx\/config\.json unchanged/);
  });
});

test('a missing, empty or whitespace-only config gets grade and score saved', () => {
  for (const content of [null, '', '  \n\t\n']) {
    withSavedConfig(content, (tmpDir, configPath) => {
      const { result } = captureStdout(() => saveInstallerProjectConfig(tmpDir, OPTS));
      assert.equal(result, true, JSON.stringify(content));
      assert.deepEqual(readSaved(configPath), { minGrade: 'B', minScore: 80 });
    });
  }
});

test('readExistingProjectConfig: {} for missing or blank, the object, or null for a non-object', () => {
  withSavedConfig(null, (tmpDir) => assert.deepEqual(readExistingProjectConfig(tmpDir), {}));
  withSavedConfig(' \n', (tmpDir) => assert.deepEqual(readExistingProjectConfig(tmpDir), {}));
  withSavedConfig('{"a":1} // note', (tmpDir) => assert.deepEqual(readExistingProjectConfig(tmpDir), { a: 1 }));
  withSavedConfig('[1]', (tmpDir) => assert.equal(readExistingProjectConfig(tmpDir), null));
  withSavedConfig('{nope', (tmpDir) => assert.equal(readExistingProjectConfig(tmpDir), null));
});
