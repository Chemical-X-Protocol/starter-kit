import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openIndexDb } from './search-db.js';
import { listTasks } from './team/team-db-tasks.js';
import { handleAudit } from './mcp/tools-audit.js';
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

const taskCount = (cwd) => listTasks(openIndexDb(cwd)).length;

test('mcp audit: creates no tasks unless triage is requested', () => {
  const cwd = makeProject();
  try {
    const report = handleAudit({ path: 'src' }, cwd);
    assert.ok(report.totalViolations > 0, 'fixture must produce violations');
    assert.strictEqual(taskCount(cwd), 0);
    handleAudit({ path: 'src', triage: true }, cwd);
    assert.ok(taskCount(cwd) > 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('cli audit: --json creates no tasks without --triage', async () => {
  const cwd = makeProject();
  const original = process.cwd();
  const originalWrite = process.stdout.write;
  try {
    process.chdir(cwd);
    process.stdout.write = () => true;
    const report = await runAudit(undefined, false, ['--json', '--dir=src'], () => ({}));
    process.stdout.write = originalWrite;
    assert.ok(report.totalViolations > 0, 'fixture must produce violations');
    assert.strictEqual(taskCount(cwd), 0);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(original);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
