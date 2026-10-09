import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildPreToolContext, decidePreTool, toPreToolOutput } from './claude-pre-tool.js';
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

const NATIVE_TOOLS = ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'NotebookEdit'];
const native = (tool, file = '/repo/src/a.ts') => ({ tool_name: tool, tool_input: { file_path: file, notebook_path: file, pattern: 'src/**' } });

test('native file tools follow nativeFileTools: block denies, warn allows with a pointer, allow is silent', () => {
  for (const tool of NATIVE_TOOLS) {
    const blocked = decidePreTool(native(tool), { ...CONTEXT, mode: 'block' });
    assert.equal(blocked.decision, 'deny', tool);
    assert.match(toPreToolOutput(blocked).hookSpecificOutput.permissionDecisionReason, /chemx (read|patch|write|f) /, tool);
    const warned = toPreToolOutput(decidePreTool(native(tool), { ...CONTEXT, mode: 'warn' }));
    assert.deepEqual(Object.keys(warned.hookSpecificOutput).sort(), ['additionalContext', 'hookEventName'], `${tool}: warn never sets permissionDecision`);
    assert.equal(toPreToolOutput(decidePreTool(native(tool), { ...CONTEXT, mode: 'allow' })), null, tool);
  }
});

test('block mode leaves paths outside the root, .claude/ and images alone', () => {
  const block = { ...CONTEXT, mode: 'block' };
  for (const file of ['/tmp/scratch/a.ts', '/repo/.claude/settings.json', '/repo/assets/logo.png']) {
    for (const tool of ['Read', 'Edit', 'Write']) assert.equal(decidePreTool(native(tool, file), block).decision, 'allow', `${tool} ${file}`);
  }
});

test('Grep keeps CHEMX_GUARD_SEARCH and otherwise follows the policy', () => {
  const grep = { tool_name: 'Grep', tool_input: { pattern: 'x' } };
  assert.equal(decidePreTool(grep, { ...CONTEXT, mode: 'allow', enforceSearch: true }).rule, 'native-grep');
  assert.equal(decidePreTool(grep, { ...CONTEXT, mode: 'block' }).decision, 'deny');
  assert.equal(decidePreTool({ tool_name: 'Grep', tool_input: { pattern: 'x', path: '/tmp' } }, { ...CONTEXT, mode: 'block' }).decision, 'allow');
});

const lockedProject = (expiresAt = Date.now() + 60_000) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-native-lock-'));
  fs.mkdirSync(path.join(root, '.chemx'));
  const db = new DatabaseSync(path.join(root, '.chemx', 'index.db'));
  db.exec('CREATE TABLE file_leases (file_path TEXT PRIMARY KEY, locked_by TEXT, acquired_at INTEGER, expires_at INTEGER, purpose TEXT, pid INTEGER DEFAULT 0)');
  db.prepare('INSERT INTO file_leases VALUES (?, ?, ?, ?, ?, 0)').run('src/a.ts', '@holder', Date.now(), expiresAt, '#2009');
  db.close();
  return root;
};

test('native edits are denied while another handle holds a live chemx lock; the holder and Read pass', () => {
  const root = lockedProject();
  const file = path.join(root, 'src', 'a.ts');
  const context = (agentId) => ({ cwd: root, root, enforceSearch: false, mode: 'allow', agentId });
  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
    const denied = decidePreTool(native(tool, file), context('@other'));
    assert.deepEqual([denied.decision, denied.rule], ['deny', 'native-edit-lock'], tool);
    assert.match(denied.reason, /src\/a\.ts is locked by @holder \(#2009\)/);
    assert.equal(decidePreTool(native(tool, file), context('@holder')).decision, 'allow', `${tool} by the holder`);
  }
  assert.equal(decidePreTool(native('Read', file), context('@other')).decision, 'allow');
  assert.equal(decidePreTool(native('Edit', file), context(null)).decision, 'allow', 'no identity: fail open');
  assert.equal(decidePreTool(native('Edit', file), { ...context('@other'), mode: 'warn' }).rule, 'native-edit-lock');
  fs.rmSync(root, { recursive: true, force: true });
});

test('expired leases and lookup errors do not block', () => {
  const root = lockedProject(Date.now() - 1000);
  const file = path.join(root, 'src', 'a.ts');
  assert.equal(decidePreTool(native('Edit', file), { cwd: root, root, mode: 'allow', agentId: '@other' }).decision, 'allow');
  const throwing = () => { throw new Error('db gone'); };
  assert.equal(decidePreTool(native('Edit', file), { cwd: root, root, mode: 'allow', agentId: '@other', findLease: throwing }).decision, 'allow');
  fs.rmSync(root, { recursive: true, force: true });
});

test('context: identity from CHEMX_AGENT_ID, else @claude-<session8>; mode from env', () => {
  const env = { CLAUDE_PROJECT_DIR: '/nonexistent-root', CHEMX_NATIVE_FILE_TOOLS: 'block' };
  assert.equal(buildPreToolContext({ session_id: 'abcdef1234567' }, env).agentId, '@claude-abcdef12');
  assert.equal(buildPreToolContext({ session_id: 'abcdef1234567' }, { ...env, CHEMX_AGENT_ID: '@me' }).agentId, '@me');
  assert.equal(buildPreToolContext({}, env).agentId, null);
  assert.equal(buildPreToolContext({}, env).mode, 'block');
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
