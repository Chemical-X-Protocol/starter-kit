import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { openIndexDb } from './search-db.js';
import { listTasks } from './team/team-db-tasks.js';
import { handleAudit, handleGetRefactorPrompt } from './mcp/tools-audit.js';
import { runAudit } from './commands/cmd-audit.js';

const BAD_SOURCE = [
  'export const parse = (raw) => {',
  '  let value;',
  '  try { value = JSON.parse(raw); } catch {}',
  '  if (value && value.a && value.b && value.c) return value;',
  '  return null;',
  '};',
  ''
].join('\n');

const makeProject = () => {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-triage-')));
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'triage-fixture' }));
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.writeFileSync(path.join(cwd, 'src', 'bad.js'), BAD_SOURCE);
  return cwd;
};

const commitAll = (cwd) => {
  execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd });
};

const taskCount = (cwd) => listTasks(openIndexDb(cwd)).length;

test('mcp audit: creates no tasks unless triage is requested', () => {
  const cwd = makeProject();
  try {
    const summary = handleAudit({ path: 'src' }, cwd);
    const hazardTotal = summary.hazards.critical + summary.hazards.highMedium + summary.hazards.low;
    assert.ok(hazardTotal > 0, 'fixture must produce violations');
    assert.strictEqual(taskCount(cwd), 0);
    handleAudit({ path: 'src', triage: true }, cwd);
    assert.ok(taskCount(cwd) > 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

const auditTaskCount = async (args, { needsViolations = true, commit = false } = {}) => {
  const cwd = makeProject();
  if (commit) commitAll(cwd);
  const original = process.cwd();
  const originalWrite = process.stdout.write;
  try {
    process.chdir(cwd);
    process.stdout.write = () => true;
    const report = await runAudit(undefined, false, ['--json', '--dir=src', ...args], () => ({}));
    process.stdout.write = originalWrite;
    if (needsViolations) assert.ok(report.totalViolations > 0, 'fixture must produce violations');
    return { count: taskCount(cwd), report };
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(original);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
};

test('cli audit: a plain audit leaves agent_tasks unchanged (triage is opt-in, #5480)', async () => {
  const { count } = await auditTaskCount([]);
  assert.strictEqual(count, 0);
});

test('cli audit: --triage reports the rules that have tasks', async () => {
  const { count, report } = await auditTaskCount(['--triage']);
  assert.ok(count > 0);
  assert.ok(Array.isArray(report.taskRules), 'report carries the rules that have tasks');
});

test('cli audit: --triage stays accepted and still triages', async () => {
  const { count } = await auditTaskCount(['--triage']);
  assert.ok(count > 0);
});

test('cli audit: --no-triage creates no tasks', async () => {
  const { count } = await auditTaskCount(['--no-triage']);
  assert.strictEqual(count, 0);
});

test('cli audit: --fast is partial and creates no tasks', async () => {
  const { count } = await auditTaskCount(['--fast'], { needsViolations: false });
  assert.strictEqual(count, 0);
});

test('cli audit: --no-index skips the sync and so skips triage', async () => {
  const { count } = await auditTaskCount(['--no-index']);
  assert.strictEqual(count, 0);
});

test('cli audit: --git on a clean tree widens to a full scan but still creates no tasks', async () => {
  const { count } = await auditTaskCount(['--git'], { commit: true });
  assert.strictEqual(count, 0);
});

test('cli audit: --changed on a clean tree creates no tasks', async () => {
  const { count } = await auditTaskCount(['--changed'], { commit: true });
  assert.strictEqual(count, 0);
});

test('cli audit: --triage with a partial scope prints a skip notice', async () => {
  const notes = [];
  const originalErr = process.stderr.write;
  process.stderr.write = (chunk) => {
    notes.push(String(chunk));
    return true;
  };
  try {
    await auditTaskCount(['--fast', '--triage'], { needsViolations: false });
  } finally {
    process.stderr.write = originalErr;
  }
  assert.ok(notes.some((n) => n.includes('triage skipped')));
});

test('mcp refactor prompt: carries Action lines from the stored backlog', () => {
  const cwd = makeProject();
  try {
    handleAudit({ path: 'src', triage: true }, cwd);
    const { prompt } = handleGetRefactorPrompt({ dir: 'src' }, cwd);
    assert.match(prompt, /Action:\s+chemx team task list --rule=/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
