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
