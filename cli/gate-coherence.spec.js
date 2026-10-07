import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runProjectVerify } from './verify.js';
import { runAudit } from './commands/cmd-audit.js';
import { RATCHET_FILE } from './audit/ratchet.js';

const BAD_SOURCE = 'export const p = (r) => { let v; try { v = JSON.parse(r); } catch {} if (v && v.a && v.b && v.c) return v; return null; };\n';

const makeProject = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-coherence-')));
  const scripts = { test: 'node -e ""', typecheck: 'node -e ""' };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'coherence-fixture', scripts }));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), BAD_SOURCE);
  fs.writeFileSync(path.join(root, 'src', 'b.js'), BAD_SOURCE.replace('p =', 'q ='));
  return root;
};

const inProject = async (fn) => {
  const root = makeProject();
  const original = process.cwd();
  const originalWrite = process.stdout.write;
  try {
    process.chdir(root);
    await fn(root, async (args) => {
      process.stdout.write = () => true;
      try {
        return await runAudit(undefined, false, [...args, '--json'], () => ({}));
      } finally {
        process.stdout.write = originalWrite;
      }
    });
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(original);
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const verifyIn = (root, args) => runProjectVerify([...args, '--json'], false, { cwd: root, print: false });

const auditSide = (report) => ({ score: report.health.score, grade: report.health.grade, count: report.totalViolations, passing: report.gate.isPassing });
const verifySide = (summary) => ({ score: summary.audit.score, grade: summary.audit.grade, count: summary.audit.violationsCount, passing: summary.audit.passing });

test('gate coherence: verify and audit agree on grade, count, and verdict for the same scope', async () => {
  await inProject(async (root, audit) => {
    const report = await audit(['--dir=src']);
    const summary = await verifyIn(root, ['--dir=src']);
    assert.ok(report.totalViolations > 0, 'fixture must produce violations');
    assert.deepStrictEqual(verifySide(summary), auditSide(report));
  });
});

test('gate coherence: after --rebaseline both pass; one added violation fails both', async () => {
  await inProject(async (root, audit) => {
    await audit(['--dir=src', '--rebaseline']);
    assert.ok(fs.existsSync(path.join(root, RATCHET_FILE)));
    assert.strictEqual((await audit(['--dir=src'])).gate.isPassing, true);
    assert.strictEqual((await verifyIn(root, ['--dir=src'])).audit.passing, true);

    fs.writeFileSync(path.join(root, 'src', 'c.js'), BAD_SOURCE.replace('p =', 'z ='));
    const report = await audit(['--dir=src']);
    const summary = await verifyIn(root, ['--dir=src']);
    assert.strictEqual(report.gate.isPassing, false);
    assert.strictEqual(summary.audit.passing, false);
    assert.strictEqual(summary.audit.basis, 'ratchet');
  });
});

test('gate coherence: ratchet recorded for another scope falls back to severity in both', async () => {
  await inProject(async (root, audit) => {
    await audit(['--dir=src', '--rebaseline']);
    fs.mkdirSync(path.join(root, 'lib'));
    fs.writeFileSync(path.join(root, 'lib', 'd.js'), 'export const d = 1;\n');
    const report = await audit(['--dir=lib']);
    const summary = await verifyIn(root, ['--dir=lib']);
    assert.strictEqual(report.gate.basis, 'severity');
    assert.strictEqual(summary.audit.basis, 'severity');
    assert.ok(summary.audit.note.includes('"src"'));
  });
});

test('gate coherence: --rebaseline refuses partial scans', async () => {
  await inProject(async (root, audit) => {
    const result = await audit(['--dir=src', '--rebaseline', '--git']);
    assert.strictEqual(result.success, false);
    assert.strictEqual(fs.existsSync(path.join(root, RATCHET_FILE)), false);
  });
});
