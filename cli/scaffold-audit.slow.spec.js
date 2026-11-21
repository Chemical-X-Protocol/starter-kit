// A fresh scaffold of every framework passes its own audit (S1: Svelte TS once failed to parse).
// Slow lane: each row spawns create.js and then the audit CLI.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });

// The coverage bucket that holds each framework's component files (.tsx counts as typescript).
const COMPONENT_LANGUAGE = { react: 'typescript', vue: 'vue', svelte: 'svelte' };

const runNode = (args, cwd) => spawnSync(process.execPath, args, {
  cwd, encoding: 'utf-8', input: '', timeout: 60000, env: { ...process.env, NO_COLOR: '1' }
});

const scaffold = (framework) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `chemx-scaffold-audit-${framework}-`));
  created.push(base);
  const targetDir = path.join(base, `${framework}-app`);
  const run = runNode([path.join(CLI_DIR, 'create.js'), targetDir, `--framework=${framework}`, '--yes', '--skip-install'], base);
  assert.equal(run.status, 0, `create.js --framework=${framework} failed:\n${run.stdout}\n${run.stderr}`);
  return targetDir;
};

const auditReport = (projectDir) => {
  const run = runNode([path.join(CLI_DIR, 'index.js'), 'audit', '--json', '--full', '--non-interactive'], projectDir);
  assert.equal(run.status, 0, `audit failed:\n${run.stderr}`);
  return JSON.parse(run.stdout);
};

describe('fresh scaffolds pass their own audit', () => {
  for (const framework of Object.keys(COMPONENT_LANGUAGE)) {
    it(`${framework}: no CRITICAL finding and no SYNTAX_PARSE_ERROR`, () => {
      const report = auditReport(scaffold(framework));
      const components = report.coverage.byLanguage[COMPONENT_LANGUAGE[framework]];
      assert.ok(components?.files > 0, `the ${framework} components were audited`);
      assert.equal(components.ast, components.files, `every ${framework} component parsed to an AST`);
      assert.equal(report.coverage.parseErrors, 0);
      const blocking = report.violations.filter((v) => v.severity === 'CRITICAL' || v.rule === 'SYNTAX_PARSE_ERROR');
      assert.deepEqual(blocking.map((v) => `${v.rule}@${v.filePath}:${v.line}`), []);
      assert.equal(report.gate.isPassing, true);
    });
  }
});
