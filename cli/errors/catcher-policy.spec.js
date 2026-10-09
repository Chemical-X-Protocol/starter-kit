import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveCatcherPolicy } from './policy.js';
import { saveIssueArtifact, MAX_ISSUE_REPORTS } from './storage.js';

const CLI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(CI|GITHUB_ACTIONS|GH_TOKEN|GITHUB_TOKEN|CHEMX_.*|AGENT|CLAUDECODE)$/.test(key)));

const tmpProject = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-catcher-policy-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"fixture","scripts":{"build":"false"}}');
  return dir;
};

test('catcher policy: non-interactive runs save nothing and show no issue URL', () => {
  const policy = resolveCatcherPolicy({}, {}, false);
  assert.strictEqual(policy.shouldSaveReport, false);
  assert.strictEqual(policy.shouldShowIssueUrl, false);
});

test('catcher policy: CI with a token never auto-posts without explicit opt-in', () => {
  const ciEnv = { CI: 'true', GITHUB_ACTIONS: 'true', GH_TOKEN: 'ghp_x' };
  assert.strictEqual(resolveCatcherPolicy({}, ciEnv, false).shouldAutoPost, false);
  assert.strictEqual(resolveCatcherPolicy({ autoPost: true }, ciEnv, false).shouldAutoPost, true);
  assert.strictEqual(resolveCatcherPolicy({}, { ...ciEnv, CHEMX_AUTO_POST_ISSUES: 'true' }, false).shouldAutoPost, true);
});

test('catcher policy: an interactive human gets the report and the issue URL', () => {
  const policy = resolveCatcherPolicy({}, {}, true);
  assert.strictEqual(policy.shouldSaveReport, true);
  assert.strictEqual(policy.shouldShowIssueUrl, true);
});

test('catcher: piped crash prints one line, no URL, writes no .chemx/issues', () => {
  const dir = tmpProject();
  try {
    const script = `import { handleError } from ${JSON.stringify(path.join(CLI_DIR, 'errors', 'index.js'))};
      await handleError(new Error('boom'), { cwd: process.cwd(), repo: 'o/r' });`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dir, env: CLEAN_ENV, encoding: 'utf-8' });
    assert.strictEqual(run.stderr.trim(), 'chemx failed: boom');
    assert.strictEqual(fs.existsSync(path.join(dir, '.chemx', 'issues')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('catcher: the issues directory keeps only the newest reports', () => {
  const dir = tmpProject();
  try {
    for (let i = 0; i < MAX_ISSUE_REPORTS + 5; i++) saveIssueArtifact(dir, { body: `report ${i}` });
    const reports = fs.readdirSync(path.join(dir, '.chemx', 'issues')).filter((n) => n.startsWith('issue-'));
    assert.ok(reports.length <= MAX_ISSUE_REPORTS, `kept ${reports.length}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('build: a failing user command prints no GitHub issue URL and writes no report', () => {
  const dir = tmpProject();
  try {
    const run = spawnSync(process.execPath, [path.join(CLI_DIR, 'index.js'), 'build', '--', 'false'],
      { cwd: dir, env: { ...CLEAN_ENV, NO_COLOR: '1' }, encoding: 'utf-8', timeout: 60000 });
    assert.notStrictEqual(run.status, 0);
    const output = `${run.stdout}${run.stderr}`;
    assert.ok(!output.includes('github.com'), 'no prefilled issue URL');
    assert.strictEqual(fs.existsSync(path.join(dir, '.chemx', 'issues')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
