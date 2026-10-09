import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runAudit } from '../audit.js';
import { writeAuditStatus, readAuditStatus } from './status-file.js';
import { createSnapshotFromReport, findChemxDir } from './history.js';
import { execFileSync } from 'node:child_process';
import { RULESET_VERSION } from './rule-revisions.js';

const withProject = (files, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-status-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const FILES = {
  'src/a.vue': '<template>\n  <p>{{ msg }}</p>\n</template>\n<script setup lang="ts">\nconst msg = "hi"\n</script>\n',
  'src/b.py': 'def run():\n    return 1\n',
  'src/c.ts': 'export const c = (\n'
};

test('audit reports a coverage block that marks text-only and unparsed files as partial', () => {
  withProject(FILES, (root) => {
    const report = runAudit('src', { cwd: root });
    assert.equal(report.coverage.files, 3);
    assert.equal(report.coverage.astParsed, 1);
    assert.equal(report.coverage.textOnly, 1);
    assert.equal(report.coverage.parseErrors, 1);
    assert.equal(report.coverage.sfc.templatesParsed, 1);
    assert.equal(report.coverage.isPartial, true);
    assert.deepEqual([...report.coverage.partialFiles].sort(), ['src/b.py', 'src/c.ts']);
    assert.equal(report.ruleset, RULESET_VERSION);
  });
});

test('.chemx/status.json keeps one entry per scope', () => {
  withProject(FILES, (root) => {
    const report = runAudit('src', { cwd: root });
    report.gate = { isPassing: true, basis: 'ratchet', regressions: [], adopted: [{ rule: 'X' }] };
    writeAuditStatus(root, { scope: 'src', report });
    writeAuditStatus(root, { scope: 'cli', report });
    const status = readAuditStatus(root);
    assert.deepEqual(Object.keys(status.scopes).sort(), ['cli', 'src']);
    assert.equal(status.latestScope, 'cli');
    assert.deepEqual(status.scopes.src.gate.adopted, ['X']);
    assert.equal(status.scopes.src.coverage.isPartial, true);
  });
});

test('history snapshots carry scope, ruleset and score model', () => {
  withProject(FILES, (root) => {
    const report = runAudit('src', { cwd: root });
    report.scope = 'src';
    const snapshot = createSnapshotFromReport(report);
    assert.equal(snapshot.scope, 'src');
    assert.equal(snapshot.ruleset, RULESET_VERSION);
    assert.equal(snapshot.scoreModel, 2);
  });
});

test('status.json lands beside audit history and never leaves an untracked .chemx/ in the project', () => {
  withProject(FILES, (root) => {
    const report = runAudit('src', { cwd: root });
    report.gate = { isPassing: true, basis: 'ratchet', regressions: [], adopted: [] };
    writeAuditStatus(root, { scope: 'src', report });
    assert.ok(fs.existsSync(path.join(findChemxDir(root), 'status.json')));
    const untracked = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf-8' });
    assert.doesNotMatch(untracked, /\.chemx\//, untracked);
  });
});
