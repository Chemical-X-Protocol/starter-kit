// Ported from 711151d: the audit exposes the profile molecule limit it measured against.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runAudit } from '../audit.js';
import { createSnapshotFromReport } from './history.js';
import { loadProjectConfig } from '../config/index.js';

const buildMoleculeSource = (lineCount) => Array.from({ length: lineCount }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';

const withMoleculeProject = (molecules, rcContent, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-molecule-limit-'));
  try {
    const moleculeDir = path.join(root, 'src', 'molecules');
    fs.mkdirSync(moleculeDir, { recursive: true });
    for (const [name, lineCount] of Object.entries(molecules)) {
      fs.writeFileSync(path.join(moleculeDir, name), buildMoleculeSource(lineCount));
    }
    if (rcContent !== null) fs.writeFileSync(path.join(root, '.chemxrc'), rcContent);
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

describe('runAudit molecule line limit', () => {
  it('exposes 250 under pragmatic and counts a 180-line molecule compliant', () => {
    withMoleculeProject({ 'm-a.ts': 180, 'm-b.ts': 80 }, null, (root) => {
      const report = runAudit('src', { cwd: root, fast: true });
      assert.equal(report.metrics.moleculeLineLimit, 250);
      assert.equal(report.metrics.moleculeCount, 2);
      assert.equal(report.metrics.moleculeCompliantPct, 100);
      assert.equal(createSnapshotFromReport(report).metrics.moleculeLineLimit, 250);
    });
  });

  it('exposes 100 under atomic-strict and counts a 180-line molecule over budget', () => {
    withMoleculeProject({ 'm-a.ts': 180, 'm-b.ts': 80 }, '{"profile":"atomic-strict"}', (root) => {
      const report = runAudit('src', { cwd: root, fast: true });
      assert.equal(report.metrics.moleculeLineLimit, 100);
      assert.equal(report.metrics.moleculeCompliantPct, 50);
    });
  });

  it('honors a --profile flag carried in options.config', () => {
    withMoleculeProject({ 'm-a.ts': 180, 'm-b.ts': 80 }, null, (root) => {
      const config = loadProjectConfig(root, ['--profile=atomic-strict']);
      const report = runAudit('src', { cwd: root, fast: true, config });
      assert.equal(report.metrics.moleculeLineLimit, 100);
      assert.equal(report.metrics.moleculeCompliantPct, 50);
    });
  });
});
