import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ensurePackageScripts, buildInstallerProjectConfig, saveInstallerProjectConfig } from './installer.js';

test('installer: ensurePackageScripts adds minimal "chemx": "chemx" when missing', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-installer-scripts-add');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      name: 'consumer-app',
      scripts: {
        dev: 'vite',
        build: 'vite build'
      }
    }, null, 2),
    'utf-8'
  );

  const res = ensurePackageScripts(tmpDir);
  assert.strictEqual(res, true);

  const updatedPkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf-8'));
  assert.strictEqual(updatedPkg.scripts.chemx, 'chemx');
  assert.strictEqual(updatedPkg.scripts.dev, 'vite');
  assert.strictEqual(updatedPkg.scripts.build, 'vite build');
  // Ensure we didn't add unnecessary extra scripts that muddle consumer package.json
  assert.strictEqual(updatedPkg.scripts.verify, undefined);
  assert.strictEqual(updatedPkg.scripts.q, undefined);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('installer: ensurePackageScripts does not overwrite existing chemx script', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-installer-scripts-keep');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      name: 'consumer-app',
      scripts: {
        chemx: 'node ./custom-chemx.js'
      }
    }, null, 2),
    'utf-8'
  );

  const res = ensurePackageScripts(tmpDir);
  assert.strictEqual(res, true);

  const updatedPkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf-8'));
  assert.strictEqual(updatedPkg.scripts.chemx, 'node ./custom-chemx.js');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('installer: ensurePackageScripts returns false gracefully if package.json does not exist', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-installer-no-pkg');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const res = ensurePackageScripts(tmpDir);
  assert.strictEqual(res, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('installer: buildInstallerProjectConfig saves grade, score and file budget without a molecule pin', () => {
  const config = buildInstallerProjectConfig({ minGrade: 'B', minScore: 80 });
  assert.deepStrictEqual(config, { minGrade: 'B', minScore: 80, maxLineCount: 500 });
});

test('installer: re-installing merges .chemx/config.json and drops the legacy molecule pin', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/test-installer-config-merge');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpDir, '.chemx'), { recursive: true });
  const legacy = { framework: 'vue', pillars: { molecularLineBudgets: true }, minGrade: 'A', maxLineCount: 500, maxMoleculeLineCount: 100 };
  fs.writeFileSync(path.join(tmpDir, '.chemx', 'config.json'), JSON.stringify(legacy), 'utf-8');

  const opts = { minGrade: 'B', minScore: 80 };
  assert.strictEqual(saveInstallerProjectConfig(tmpDir, opts), true);

  const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, '.chemx', 'config.json'), 'utf-8'));
  assert.deepStrictEqual(saved, {
    framework: 'vue',
    pillars: { molecularLineBudgets: true },
    minGrade: 'B',
    minScore: 80,
    maxLineCount: 500
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

const withSavedConfig = (name, content, run) => {
  const tmpDir = path.resolve(process.cwd(), `scratch/${name}`);
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpDir, '.chemx'), { recursive: true });
  const configPath = path.join(tmpDir, '.chemx', 'config.json');
  fs.writeFileSync(configPath, content, 'utf-8');
  try {
    run(tmpDir, configPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

test('installer: re-installing keeps profile and pillars from a commented .chemx/config.json', () => {
  const commented = '// team\n{"profile":"atomic-strict","pillars":{"a":true}}';
  withSavedConfig('test-installer-config-commented', commented, (tmpDir, configPath) => {
    const { result } = captureStdout(() => saveInstallerProjectConfig(tmpDir, { minGrade: 'B', minScore: 80 }));
    assert.strictEqual(result, true);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.deepStrictEqual(saved, {
      profile: 'atomic-strict',
      pillars: { a: true },
      minGrade: 'B',
      minScore: 80,
      maxLineCount: 500
    });
  });
});

test('installer: an unparsable .chemx/config.json is kept as it is and the installer warns', () => {
  const broken = '{"profile":"atomic-strict",,"pillars":{"a":true}}';
  withSavedConfig('test-installer-config-broken', broken, (tmpDir, configPath) => {
    const { result, output } = captureStdout(() => saveInstallerProjectConfig(tmpDir, { minGrade: 'B', minScore: 80 }));
    assert.strictEqual(result, false);
    assert.strictEqual(fs.readFileSync(configPath, 'utf-8'), broken);
    assert.match(output, /\.chemx\/config\.json/);
    assert.match(output, /does not parse as a JSON object/);
  });
});
