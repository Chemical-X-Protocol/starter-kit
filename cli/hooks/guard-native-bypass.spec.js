// Native file tools under nativeFileTools=block (each denial names the exact chemx call, free paths stay
// free), .chemxrc nudge promotion, and the bypass log in the coordination db. Temp dirs only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPreToolContext, decidePreTool } from './claude-pre-tool.js';
import { logBypassToDb, BYPASS_EVENT_TYPE } from './bypass-log.js';
import { runHook } from './run-hook.js';
import { openIndexDb } from '../search-db.js';
import { queryFeed } from '../team/team-db-feed.js';
import { takeLeaseWhenFree } from '../edit-locks.js';

delete process.env.CHEMX_PROJECT_ROOT;

const temp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `chemx-${prefix}-`)));
const created = [];
const makeDir = (prefix, { git = false } = {}) => {
  const dir = temp(prefix);
  created.push(dir);
  if (git) fs.mkdirSync(path.join(dir, '.git'));
  return dir;
};
test.after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });

const call = (tool, file, extra = {}) => ({ tool_name: tool, tool_input: { file_path: file, notebook_path: file, ...extra } });
const blockContext = (root, extra = {}) => ({ cwd: root, root, mode: 'block', enforceSearch: true, hasChemxCommand: () => true, nudgePromotion: { all: false, ids: [] }, ...extra });

test('block mode: every native tool on a repo file is denied with the exact chemx call', () => {
  const root = makeDir('native');
  const file = path.join(root, 'src', 'a.ts');
  const context = blockContext(root);
  const expected = {
    Read: /chemx read src\/a\.ts --outline/,
    Edit: /chemx patch src\/a\.ts <<'EOF'/,
    MultiEdit: /chemx patch src\/a\.ts <<'EOF'/,
    NotebookEdit: /chemx patch src\/a\.ts <<'EOF'/,
    Write: /chemx write src\/a\.ts - <<'EOF'.*--overwrite/,
  };
  for (const [tool, pattern] of Object.entries(expected)) {
    const result = decidePreTool(call(tool, file), context);
    assert.equal(result.decision, 'deny', tool);
    assert.match(result.reason, pattern, tool);
  }
  const grep = decidePreTool({ tool_name: 'Grep', tool_input: { pattern: 'needle' } }, context);
  assert.match(grep.reason, /chemx q -g "needle" -l/);
  const glob = decidePreTool({ tool_name: 'Glob', tool_input: { pattern: 'src/**/*.ts' } }, context);
  assert.match(glob.reason, /chemx f "src\/\*\*\/\*\.ts"/);
});

test('block mode leaves free paths alone: other dirs, ~/.claude, images, PDFs, .claude/, node_modules, scratch', () => {
  const root = makeDir('free');
  const elsewhere = makeDir('plain');
  const scratch = path.join(root, '.pad');
  const context = blockContext(root, { scratchDir: scratch });
  const free = [
    path.join(elsewhere, 'notes.md'), path.join(os.homedir(), '.claude', 'projects', 'x', 'memory', 'm.md'),
    path.join(root, 'assets', 'logo.png'), path.join(root, 'docs', 'spec.pdf'), path.join(root, '.claude', 'settings.json'),
    path.join(root, 'node_modules', 'pkg', 'index.js'), path.join(scratch, 'draft.ts'),
  ];
  for (const file of free) {
    for (const tool of ['Read', 'Edit', 'Write']) assert.equal(decidePreTool(call(tool, file), context).decision, 'allow', `${tool} ${file}`);
  }
  assert.equal(decidePreTool({ tool_name: 'Grep', tool_input: { pattern: 'x', path: elsewhere } }, context).decision, 'allow');
  assert.equal(decidePreTool({ tool_name: 'Glob', tool_input: { pattern: '*.md', path: elsewhere } }, context).decision, 'allow');
});

test('block mode also covers a different git repo than the session root', () => {
  const root = makeDir('session');
  const other = makeDir('other', { git: true });
  const result = decidePreTool(call('Edit', path.join(other, 'src', 'b.ts')), blockContext(root));
  assert.equal(result.decision, 'deny');
  assert.match(result.reason, new RegExp(`chemx patch ${path.join(other, 'src', 'b.ts').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
});

test('.chemxrc nativeFileTools=block becomes the hook mode; the default stays warn', () => {
  const root = makeDir('mode');
  const env = { CLAUDE_PROJECT_DIR: root };
  assert.equal(buildPreToolContext({ cwd: root }, env).mode, 'warn');
  fs.writeFileSync(path.join(root, '.chemxrc'), JSON.stringify({ nativeFileTools: 'block' }));
  assert.equal(buildPreToolContext({ cwd: root }, env).mode, 'block');
  assert.equal(buildPreToolContext({ cwd: root }, { ...env, CHEMX_NATIVE_FILE_TOOLS: 'allow' }).mode, 'allow', 'the environment wins');
});

test('.chemxrc promotes nudges: all, by rule id, overridden by the environment, ignored when unreadable', () => {
  const root = makeDir('nudge');
  const env = { CLAUDE_PROJECT_DIR: root };
  const promotion = (extraEnv = {}) => buildPreToolContext({ cwd: root }, { ...env, ...extraEnv }).nudgePromotion;
  assert.deepEqual(promotion(), { all: false, ids: [] });
  fs.writeFileSync(path.join(root, '.chemxrc'), JSON.stringify({ guardNudges: 'block' }));
  assert.deepEqual(promotion(), { all: true, ids: [] });
  assert.deepEqual(promotion({ CHEMX_GUARD_NUDGES: 'nudge' }), { all: false, ids: [] });
  fs.writeFileSync(path.join(root, '.chemxrc'), JSON.stringify({ guardNudgeBlock: ['nudge-wait', 7] }));
  assert.deepEqual(promotion(), { all: false, ids: ['nudge-wait'] });
  assert.deepEqual(promotion({ CHEMX_GUARD_NUDGES: 'block' }), { all: true, ids: [] });
  fs.writeFileSync(path.join(root, '.chemxrc'), '{not json');
  assert.deepEqual(promotion(), { all: false, ids: [] });
});

// A project root with its own initialised .chemx/index.db (so lookups never walk up to a stray db).
const makeDbRoot = (prefix) => {
  const root = makeDir(prefix);
  fs.mkdirSync(path.join(root, '.chemx'));
  openIndexDb(root);
  return root;
};

const feedOf = (root) => {
  const db = openIndexDb(root);
  return queryFeed(db, { event_type: BYPASS_EVENT_TYPE });
};

test('logBypassToDb writes command, reason, handle and time into the feed', async () => {
  const root = makeDbRoot('bypass-db');
  const before = Date.now();
  const ok = await logBypassToDb({ root, handle: '@spec-agent', reason: 'patch cannot match', rule: 'shell-sed-in-place', command: "sed -i 's/a/b/' src/a.ts", session: 's1' });
  assert.equal(ok, true);
  const [row] = feedOf(root);
  assert.equal(row.author_id, '@spec-agent');
  assert.equal(row.event_type, 'guard-bypass');
  assert.ok(row.timestamp >= before);
  assert.match(row.message, /bypass shell-sed-in-place: patch cannot match \| sed -i/);
  assert.deepEqual([row.metadata.rule, row.metadata.reason, row.metadata.session], ['shell-sed-in-place', 'patch cannot match', 's1']);
});

test('logBypassToDb fails open: no db file (none is created), a root that is a file, or a locked db', async () => {
  const root = makeDir('bypass-bad');
  fs.mkdirSync(path.join(root, '.chemx'));
  const fields = { handle: '@t', reason: 'r', rule: 'x', command: 'c' };
  assert.equal(await logBypassToDb({ root, ...fields }), false);
  assert.equal(fs.existsSync(path.join(root, '.chemx', 'index.db')), false, 'never creates a db');
  const notADirectory = path.join(root, 'file.txt');
  fs.writeFileSync(notADirectory, 'x');
  assert.equal(await logBypassToDb({ root: notADirectory, ...fields }), false);
  const locked = makeDbRoot('bypass-locked');
  const holder = openIndexDb(locked);
  holder.exec('BEGIN EXCLUSIVE');
  const started = Date.now();
  assert.equal(await logBypassToDb({ root: locked, ...fields }), false);
  assert.ok(Date.now() - started < 3000, 'waits well under the hook timeout');
  holder.exec('ROLLBACK');
});

test('the hook logs a bypass that overrode a rule, and nothing for idle bypasses, denials or nudges', async () => {
  const root = makeDbRoot('bypass-hook');
  const env = { CLAUDE_PROJECT_DIR: root, CHEMX_FRICTION_LOG: path.join(root, 'friction.jsonl'), CHEMX_AGENT_ID: '@hook-agent', CHEMX_GUARD_SEARCH: '' };
  const run = (command) => runHook('claude-pre-tool', JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: root, session_id: 's9' }), env);
  await run('ls /tmp # chemx-bypass: nothing was blocked');
  await run('pnpm vitest run');
  await run('git status');
  assert.deepEqual(feedOf(root), []);
  const result = await run('pnpm vitest run # chemx-bypass: kitchen config');
  assert.equal(result.output, null);
  const [row] = feedOf(root);
  assert.deepEqual([row.author_id, row.metadata.rule, row.metadata.reason, row.metadata.session], ['@hook-agent', 'raw-test-runner', 'kitchen config', 's9']);
});

// #6748: a subagent that leased a file as its own handle may edit it natively; nobody else may.
const SESSION = '3f9a1c7e-55b2-4d1e-9c0a-0d6b2e8f4a11';
const transcriptOf = (agentId) => `/p/proj/${SESSION}/subagents/agent-${agentId}.jsonl`;
const subagentPayload = (root, agentId, tool, input, session = SESSION) => ({ tool_name: tool, session_id: session, agent_id: agentId, transcript_path: transcriptOf(agentId), cwd: root, tool_input: input });
const mainPayload = (root, tool, input) => ({ tool_name: tool, session_id: SESSION, transcript_path: `/p/proj/${SESSION}.jsonl`, cwd: root, tool_input: input });
const hookEnv = (root) => ({ CLAUDE_PROJECT_DIR: root, CHEMX_NATIVE_FILE_TOOLS: 'allow', CHEMX_FRICTION_LOG: path.join(root, 'friction.jsonl'), CHEMX_GUARD_SEARCH: '' });
const runPayload = (root, payload) => runHook('claude-pre-tool', JSON.stringify(payload), hookEnv(root));
const reasonOf = (result) => result.output?.hookSpecificOutput?.permissionDecisionReason ?? null;
const declareCommand = 'export CHEMX_AGENT_ID=@sonnet-g3; chemx team lock acquire src/a.ts --as=@sonnet-g3';

const declaredRowCount = (root) => {
  const db = openIndexDb(root);
  const hasTable = db.prepare("SELECT 1 AS one FROM sqlite_master WHERE name = 'session_agent_handles'").get();
  return hasTable ? db.prepare('SELECT COUNT(*) AS n FROM session_agent_handles').get().n : 0;
};

const leasedProject = (handle) => {
  const root = makeDbRoot('declared');
  fs.mkdirSync(path.join(root, 'src'));
  const file = path.join(root, 'src', 'a.ts');
  fs.writeFileSync(file, 'export const a = 1;\n');
  assert.equal(takeLeaseWhenFree(root, file, handle, {}).taken, true);
  const edit = { file_path: file, old_string: 'a', new_string: 'b' };
  return { root, edit };
};

test('a subagent that declared its handle in a chemx call may edit the file it leased; before that its edit is refused', async () => {
  const { root, edit } = leasedProject('@sonnet-g3');
  const before = await runPayload(root, subagentPayload(root, 'a1b2', 'Edit', edit));
  assert.match(reasonOf(before), /src\/a\.ts is locked by @sonnet-g3/);
  assert.equal((await runPayload(root, subagentPayload(root, 'a1b2', 'Bash', { command: declareCommand }))).output, null, 'the declaring call itself is allowed');
  for (const tool of ['Edit', 'Write', 'MultiEdit']) {
    assert.equal((await runPayload(root, subagentPayload(root, 'a1b2', tool, edit))).output, null, `${tool} after the declaration`);
  }
});

test('a declaration is for that agent only: a sibling subagent, the orchestrator and another session are still refused', async () => {
  const { root, edit } = leasedProject('@sonnet-g3');
  await runPayload(root, subagentPayload(root, 'a1b2', 'Bash', { command: declareCommand }));
  const sibling = await runPayload(root, subagentPayload(root, 'c3d4', 'Edit', edit));
  assert.match(reasonOf(sibling), /locked by @sonnet-g3.*You are acting as @claude-3f9a1c7e\./s);
  assert.match(reasonOf(sibling), /chemx team lock release src\/a\.ts --as=@sonnet-g3/);
  assert.match(reasonOf(await runPayload(root, mainPayload(root, 'Edit', edit))), /locked by @sonnet-g3/);
  const otherSession = await runPayload(root, subagentPayload(root, 'a1b2', 'Edit', edit, '9e8d7c6b-0000-4000-8000-000000000000'));
  assert.match(reasonOf(otherSession), /locked by @sonnet-g3.*You are acting as @claude-9e8d7c6b\./s);
});

test('a subagent that declared a handle no longer counts as the orchestrator session handle', async () => {
  const { root, edit } = leasedProject('@claude-3f9a1c7e');
  assert.equal((await runPayload(root, subagentPayload(root, 'a1b2', 'Edit', edit))).output, null, 'undeclared: it inherits the session handle, as before');
  await runPayload(root, subagentPayload(root, 'a1b2', 'Bash', { command: 'chemx team lock acquire src/b.ts --as=@sonnet-g3' }));
  assert.match(reasonOf(await runPayload(root, subagentPayload(root, 'a1b2', 'Edit', edit))), /locked by @claude-3f9a1c7e.*You are acting as @sonnet-g3\./s);
  assert.equal((await runPayload(root, mainPayload(root, 'Edit', edit))).output, null, 'the orchestrator keeps its own lease');
});

test('the main thread keeps its session handle next to the handle it declared', async () => {
  const { root, edit } = leasedProject('@fable-gatekeeper');
  assert.match(reasonOf(await runPayload(root, mainPayload(root, 'Edit', edit))), /locked by @fable-gatekeeper/);
  await runPayload(root, mainPayload(root, 'Bash', { command: 'chemx team lock acquire src/a.ts --as=@fable-gatekeeper' }));
  assert.equal((await runPayload(root, mainPayload(root, 'Edit', edit))).output, null);
  const sessionLeased = leasedProject('@claude-3f9a1c7e');
  await runPayload(sessionLeased.root, mainPayload(sessionLeased.root, 'Bash', { command: 'chemx team lock acquire src/b.ts --as=@fable-gatekeeper' }));
  assert.equal((await runPayload(sessionLeased.root, mainPayload(sessionLeased.root, 'Edit', sessionLeased.edit))).output, null);
});

test('a denied chemx call declares nothing, and a call that names no identity declares nothing', async () => {
  const { root, edit } = leasedProject('@sonnet-g3');
  const inherited = await runPayload(root, subagentPayload(root, 'a1b2', 'Bash', { command: 'chemx team lock acquire src/a.ts --as=@claude-3f9a1c7e' }));
  assert.equal(inherited.output.hookSpecificOutput.permissionDecision, 'deny');
  await runPayload(root, subagentPayload(root, 'a1b2', 'Bash', { command: 'chemx team lock acquire src/a.ts' }));
  assert.equal(declaredRowCount(root), 0);
  assert.match(reasonOf(await runPayload(root, subagentPayload(root, 'a1b2', 'Edit', edit))), /locked by @sonnet-g3/);
});
