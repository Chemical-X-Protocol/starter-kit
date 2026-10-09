import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runAudit } from '../commands/cmd-audit.js';
import { handleAudit } from '../mcp/tools-audit.js';

const BAD_SOURCE = 'export const p = (r) => { let v; try { v = JSON.parse(r); } catch {} if (v && v.a && v.b && v.c) return v; return null; };\n';
const SUMMARY_KEYS = ['project', 'scope', 'files', 'loc', 'tokens', 'health', 'aiSlop', 'hazards', 'cost', 'gate', 'coverage'];

const makeProject = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-summary-')));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'summary-fixture' }));
  fs.mkdirSync(path.join(root, 'src'));
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, 'src', `f${i}.js`), BAD_SOURCE.replace('p =', `p${i} =`));
  return root;
};

const captureCliJson = async (root, args) => {
  const original = process.cwd();
  const originalWrite = process.stdout.write;
  let out = '';
  try {
    process.chdir(root);
    process.stdout.write = (chunk) => { out += chunk; return true; };
    await runAudit(undefined, false, [...args, '--json'], () => ({}));
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(original);
  }
  return out;
};

test('audit --json prints the banner summary, not the full report', async () => {
  const root = makeProject();
  try {
    const out = await captureCliJson(root, ['--dir=src']);
    const summary = JSON.parse(out);
    assert.deepStrictEqual(Object.keys(summary), SUMMARY_KEYS);
    assert.strictEqual(summary.files, 5);
    assert.strictEqual(summary.scope, 'src');
    assert.ok(summary.hazards.critical + summary.hazards.highMedium + summary.hazards.low > 0);
    assert.strictEqual(typeof summary.gate.passing, 'boolean');
    assert.ok(out.length < 1000, `summary is ${out.length} bytes`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('audit --json --full keeps the complete report', async () => {
  const root = makeProject();
  try {
    const full = JSON.parse(await captureCliJson(root, ['--dir=src', '--full']));
    assert.ok(Array.isArray(full.violations));
    assert.ok(full.violations.length > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mcp audit returns the same summary by default and the full report on request', () => {
  const root = makeProject();
  try {
    const summary = handleAudit({ path: 'src' }, root);
    assert.deepStrictEqual(Object.keys(summary), SUMMARY_KEYS);
    const full = handleAudit({ path: 'src', full: true }, root);
    assert.ok(Array.isArray(full.violations));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('audit --json --full survives a pipe when larger than 64 KB', async () => {
  const { spawnSync } = await import('node:child_process');
  const root = makeProject();
  try {
    for (let i = 5; i < 200; i++) fs.writeFileSync(path.join(root, 'src', `f${i}.js`), BAD_SOURCE.replace('p =', `p${i} =`));
    const cli = path.resolve(import.meta.dirname, '..', 'index.js');
    const res = spawnSync(process.execPath, [cli, 'audit', '--json', '--full', '--dir=src'], { cwd: root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    assert.ok(res.stdout.length > 65536, `fixture too small: ${res.stdout.length} bytes`);
    assert.doesNotThrow(() => JSON.parse(res.stdout));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('audit --json gate reflects explicit grade thresholds, matching the exit code', async () => {
  const root = makeProject();
  try {
    const summary = JSON.parse(await captureCliJson(root, ['--dir=src', '--min-grade=A+']));
    const isBelowMinimum = summary.health.grade !== 'A+';
    assert.ok(isBelowMinimum, 'fixture must grade below A+');
    assert.strictEqual(summary.gate.passing, false);
    assert.strictEqual(summary.gate.basis, 'threshold');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
