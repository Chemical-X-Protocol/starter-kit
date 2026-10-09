import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decidePreTool } from './claude-pre-tool.js';
import { RUNNER_RULES, SEARCH_RULES } from './guard-rules.js';
import { ALL_BASH_CASES } from './guard-cases.js';

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'entry.js');
const CONTEXT = { cwd: '/repo', root: '/repo', enforceSearch: false };
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

for (const [command, expected] of ALL_BASH_CASES) {
  test(`guard ${expected}: ${JSON.stringify(command).slice(0, 90)}`, () => {
    assert.equal(decidePreTool(bash(command), CONTEXT).decision, expected);
  });
}

test('native Read, Edit, Write and Glob are never denied, even with search enforced', () => {
  for (const tool of ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'NotebookEdit']) {
    const result = decidePreTool({ tool_name: tool, tool_input: { file_path: '/repo/src/a.ts' } }, { ...CONTEXT, enforceSearch: true });
    assert.equal(result.decision, 'allow', tool);
  }
});

test('Grep and recursive shell search are allowed until CHEMX_GUARD_SEARCH=1', () => {
  assert.equal(decidePreTool({ tool_name: 'Grep', tool_input: { pattern: 'x' } }, CONTEXT).decision, 'allow');
  const enforced = { ...CONTEXT, enforceSearch: true };
  assert.equal(decidePreTool({ tool_name: 'Grep', tool_input: { pattern: 'x' } }, enforced).decision, 'deny');
  assert.equal(decidePreTool(bash('grep -rn x src'), enforced).decision, 'deny');
  assert.equal(decidePreTool(bash('rg foo'), enforced).decision, 'deny');
  assert.equal(decidePreTool(bash('grep -n foo src/a.js'), enforced).decision, 'allow');
});

test('every suggestion the guard prints is itself allowed (#1673)', () => {
  for (const rule of [...RUNNER_RULES, ...SEARCH_RULES]) {
    const suggestion = rule.use.replace('<build command>', 'npm run build').split(/\s{2}|\(| \| /)[0].replace(/<[^>]+>/g, 'x').replace(/\[[^\]]*\]/g, '').trim();
    const result = decidePreTool(bash(suggestion), { ...CONTEXT, enforceSearch: true });
    assert.equal(result.decision, 'allow', `${rule.id}: ${suggestion}`);
  }
});

test('bypass comment allows and reports the reason and the rule it skipped', () => {
  const result = decidePreTool(bash('pnpm vitest run # chemx-bypass: kitchen config'), CONTEXT);
  assert.deepEqual([result.decision, result.bypassReason, result.rule], ['allow', 'kitchen config', 'raw-test-runner']);
  const quoted = decidePreTool(bash('pnpm vitest run "# chemx-bypass: not a comment"'), CONTEXT);
  assert.equal(quoted.decision, 'deny', 'a bypass inside quotes is prose, not a shell comment');
});

test('deny reason names the segment and the chemx replacement', () => {
  const result = decidePreTool(bash('cd x && git log -3'), CONTEXT);
  assert.match(result.reason, /`git log -3`/);
  assert.match(result.reason, /chemx log/);
});

test('entry.js end to end: deny JSON on stdout, friction logged for deny and bypass, fail open on bad input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-guard-'));
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, CHEMX_FRICTION_LOG: path.join(dir, 'friction.jsonl'), CHEMX_GUARD_SEARCH: '' };
  const run = (input) => spawnSync(process.execPath, [ENTRY, 'claude-pre-tool'], { input, env, encoding: 'utf-8' });
  const denied = run(JSON.stringify({ ...bash('pnpm vitest run'), cwd: dir, session_id: 's1' }));
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const bypassed = run(JSON.stringify({ ...bash('pnpm vitest # chemx-bypass: why'), cwd: dir }));
  assert.equal(bypassed.stdout, '');
  const malformed = run('{not json');
  assert.deepEqual([malformed.status, malformed.stdout], [0, '']);
  const entries = fs.readFileSync(path.join(dir, 'friction.jsonl'), 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(entries.map((entry) => [entry.kind, entry.rule]), [['guard-deny', 'raw-test-runner'], ['bypass', 'raw-test-runner']]);
  assert.equal(entries[1].reason, 'why');
  fs.rmSync(dir, { recursive: true, force: true });
});
