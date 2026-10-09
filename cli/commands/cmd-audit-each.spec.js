import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.CHEMX_TEST = '1';

import { parseEachArgs, listSubmodulePaths, summarizeAudit, runPool, runAuditEachCommand } from './cmd-audit-each.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

const withRepo = async (files, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-each-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  try {
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const GITMODULES = '[submodule "a"]\n\tpath = pkg/a\n\turl = ./a\n[submodule "b"]\n\tpath = pkg/b\n\turl = ./b\n[submodule "gone"]\n\tpath = pkg/missing\n\turl = ./gone\n';

const summary = (overrides = {}) => ({
  scope: 'pkg/a', files: 3, loc: 40, health: { score: 90, grade: 'A' }, aiSlop: { score: 100, grade: 'A+' },
  hazards: { critical: 1, highMedium: 2, low: 0 }, gate: { passing: true }, coverage: { astPct: 100 }, ...overrides
});

test('parseEachArgs: reads the kind, concurrency and json', () => {
  assert.deepStrictEqual(parseEachArgs(['--each=submodules']), { kind: 'submodules', concurrency: 1, isJson: false });
  assert.deepStrictEqual(parseEachArgs(['--each=workspaces', '--concurrency=3', '--json']), { kind: 'workspaces', concurrency: 3, isJson: true });
  assert.strictEqual(parseEachArgs(['--each']).kind, 'submodules', 'bare --each means submodules');
  assert.strictEqual(parseEachArgs(['--each', '--concurrency=0']).concurrency, 1);
});

test('listSubmodulePaths: paths from .gitmodules that exist on disk, in file order', async () => {
  await withRepo({ '.gitmodules': GITMODULES, 'pkg/a/x.js': '', 'pkg/b/y.js': '' }, (root) => {
    assert.deepStrictEqual(listSubmodulePaths(root), ['pkg/a', 'pkg/b']);
  });
  await withRepo({ 'x.js': '' }, (root) => assert.deepStrictEqual(listSubmodulePaths(root), []));
});

test('summarizeAudit: one row from the audit --json summary, with no-code and error cases', () => {
  assert.deepStrictEqual(summarizeAudit('pkg/a', { json: summary(), seconds: 1.234, exitCode: 0 }), {
    scope: 'pkg/a', files: 3, loc: 40, healthScore: 90, grade: 'A', aiSlopScore: 100,
    critical: 1, highMedium: 2, low: 0, gatePassing: true, seconds: 1.2, note: null
  });
  const empty = summarizeAudit('docs', { json: summary({ files: 0 }), seconds: 0.5, exitCode: 0 });
  assert.strictEqual(empty.note, 'no auditable files');
  assert.strictEqual(empty.healthScore, null, 'no score for a package with nothing to grade');
  assert.strictEqual(empty.gatePassing, null);
  const broken = summarizeAudit('pkg/x', { json: null, seconds: 0.1, exitCode: 2, stderr: 'boom\nlast line' });
  assert.strictEqual(broken.note, 'audit failed (exit 2): last line');
});

test('runPool: runs every target, at most `concurrency` at once, results in target order', async () => {
  let running = 0;
  let peak = 0;
  const work = async (target) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return target.toUpperCase();
  };
  assert.deepStrictEqual(await runPool(['a', 'b', 'c', 'd', 'e'], work, 2), ['A', 'B', 'C', 'D', 'E']);
  assert.strictEqual(peak, 2);
});

test('runAuditEachCommand: table, json, and exit 1 when any gate fails', async () => {
  await withRepo({ '.gitmodules': GITMODULES, 'pkg/a/x.js': '', 'pkg/b/y.js': '' }, async (root) => {
    const fake = async (target) => ({ json: summary({ scope: target, gate: { passing: target === 'pkg/a' } }), seconds: 1, exitCode: target === 'pkg/a' ? 0 : 1 });
    const out = [];
    const result = await runAuditEachCommand(['--each=submodules'], { cwd: root, auditOne: fake, write: (s) => out.push(s), writeError: () => {} });
    assert.strictEqual(result.code, 1);
    const text = out.join('');
    assert.match(text, /pkg\/a .*pass/);
    assert.match(text, /pkg\/b .*fail/);
    assert.match(text, /2 audited, 1 passing, 1 failing/);

    const jsonOut = [];
    await runAuditEachCommand(['--each', '--json'], { cwd: root, auditOne: fake, write: (s) => jsonOut.push(s), writeError: () => {} });
    assert.deepStrictEqual(JSON.parse(jsonOut.join('')).map((r) => r.scope), ['pkg/a', 'pkg/b']);
  });
});

test('runAuditEachCommand: unknown kind exits 2; no targets says so and exits 0', async () => {
  await withRepo({ 'x.js': '' }, async (root) => {
    const err = [];
    const bad = await runAuditEachCommand(['--each=planets'], { cwd: root, write: () => {}, writeError: (s) => err.push(s) });
    assert.strictEqual(bad.code, 2);
    assert.match(err.join(''), /submodules, workspaces/);
    const out = [];
    const none = await runAuditEachCommand(['--each=submodules'], { cwd: root, write: (s) => out.push(s), writeError: () => {} });
    assert.strictEqual(none.code, 0);
    assert.match(out.join(''), /No submodules found/);
  });
});

test('chemx audit --each=submodules audits each submodule into its own scoped history entry', async () => {
  await withRepo({ '.gitmodules': GITMODULES, 'pkg/a/x.js': 'export const a = () => 1;\n', 'pkg/b/y.js': 'export const b = () => 2;\n' }, (root) => {
    const res = spawnSync(process.execPath, [CLI, 'audit', '--each=submodules', '--json'], {
      cwd: root, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1', CHEMX_PROJECT_ROOT: '' }
    });
    const rows = JSON.parse(res.stdout);
    assert.deepStrictEqual(rows.map((r) => [r.scope, r.files, r.gatePassing]), [['pkg/a', 1, true], ['pkg/b', 1, true]]);
    assert.strictEqual(res.status, 0);
    const history = JSON.parse(fs.readFileSync(path.join(root, '.chemx', 'history.json'), 'utf-8'));
    assert.deepStrictEqual(history.map((s) => s.scope), ['pkg/a', 'pkg/b']);
  });
});
