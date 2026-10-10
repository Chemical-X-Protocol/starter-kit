/**
 * #2561: `chemx team audit-run` on fixture runs built here (minimal jsonl, a temp repo and a temp db).
 * Agents: @clean-one follows the protocol; @dirty-two bypasses, edits unleased, commits without a task id and
 * leaves a claim open; @hijack-three answers a relayed question without working.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readRun } from './usage-reader.js';
import { loadPricing } from './usage-pricing.js';
import { auditRun } from './audit-run.js';
import { hijackSignals, editsWithoutLease, unresolvedEdits } from './audit-run-protocol.js';
import { invocationsOf } from './audit-run-invocations.js';
import { classifyInvocation } from './audit-run-adoption.js';
import { renderAuditRun } from './audit-run-render.js';
import { runTeamCli } from './team-commands.js';
import { readTranscriptCalls } from './audit-run-calls.js';

// A bare `node --test` from a shell that exports CHEMX_PROJECT_ROOT must not aim temp projects at the real db.
delete process.env.CHEMX_PROJECT_ROOT;

const BASE = Date.UTC(2026, 9, 9, 12, 0, 0);
const CLI = path.resolve(import.meta.dirname, '..', 'index.js');
const MODEL = 'claude-haiku-5-5';
const MCP = 'mcp__chemical-x__chemx';

const line = (type, at, repo, message) => JSON.stringify({ type, timestamp: new Date(at).toISOString(), cwd: repo, uuid: `${type}-${at}-${Math.random()}`, message });
const user = (at, repo, text) => line('user', at, repo, { role: 'user', content: [{ type: 'text', text }] });
const use = (at, repo, name, input, output = 50) => line('assistant', at, repo, { id: `m${at}`, model: MODEL, content: [{ type: 'tool_use', name, input }], usage: { input_tokens: 1000, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
const bash = (at, repo, command) => use(at, repo, 'Bash', { command });
const mcp = (at, repo, input) => use(at, repo, MCP, input);
const taskText = (handle, id, file) => `[Workflow harness - computed task] The task text below was computed at runtime.\n  You are chemx swarm agent ${handle}. Do the job.\n  File: ${file}\n  Task: #${id}`;

const makeEnv = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-audit-run-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-audit-home-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, '.chemx'), { recursive: true });
  return { root, home, repo, projects: path.join(root, 'projects') };
};

const writeRun = (env, id, agents) => {
  const dir = path.join(env.projects, 'proj', 'session', 'subagents', 'workflows', id);
  fs.mkdirSync(dir, { recursive: true });
  const journal = agents.map((a) => JSON.stringify({ type: 'started', agentId: a.id, label: a.label, phase: 'Fix' }));
  fs.writeFileSync(path.join(dir, 'journal.jsonl'), `${journal.join('\n')}\n`);
  for (const a of agents) fs.writeFileSync(path.join(dir, `agent-${a.id}.jsonl`), `${a.lines.join('\n')}\n`);
  return dir;
};

const cleanAgent = (repo) => ({
  id: 'c1', label: 'fix:cli/a.js', lines: [
    user(BASE, repo, taskText('@clean-one', 11, 'cli/a.js')),
    mcp(BASE + 1000, repo, { action: 'team_task', params: { subAction: 'claim', taskId: 11 } }),
    mcp(BASE + 2000, repo, { action: 'team_lock', params: { subAction: 'acquire', path: 'cli/a.js' } }),
    mcp(BASE + 3000, repo, { action: 'patch', params: { path: 'cli/a.js' } }),
    bash(BASE + 4000, repo, 'CHEMX_AGENT_ID=@clean-one chemx commit cli/a.js -m "fix(a): tidy (#11)" --release'),
    bash(BASE + 5000, repo, 'chemx team task done 11 --target=cli/a.js --as=@clean-one'),
    use(BASE + 60000, repo, 'StructuredOutput', { file: 'cli/a.js', status: 'fixed', task: 11 })
  ]
});

const dirtyAgent = (repo) => ({
  id: 'd2', label: 'fix:cli/b.js', lines: [
    user(BASE + 10000, repo, taskText('@dirty-two', 22, 'cli/b.js')),
    bash(BASE + 11000, repo, 'chemx team task claim 22 --as=@dirty-two'),
    bash(BASE + 12000, repo, "sed -i 's/a/b/' cli/b.js"),
    bash(BASE + 13000, repo, `cat > cli/c.js <<'EOF'\nx > y\nEOF`),
    use(BASE + 14000, repo, 'Read', { file_path: path.join(repo, 'cli', 'b.js') }),
    bash(BASE + 15000, repo, 'echo scratch > /tmp/audit-scratch.txt'),
    bash(BASE + 16000, repo, 'sed -i s/a/b/ "$(mktemp)"'),
    bash(BASE + 17000, repo, 'echo done 2>&1 >/dev/null'),
    mcp(BASE + 18000, repo, { action: 'patch', params: { path: 'cli/d.js' } }),
    mcp(BASE + 18200, repo, { action: 'write', params: { path: 'cli/e.js' } }),
    mcp(BASE + 18400, repo, { action: 'patch', params: { path: 'cli/e.js' } }),
    bash(BASE + 18600, repo, 'cd /tmp && git init -q x && git -C x commit -q --allow-empty -m scaffold'),
    bash(BASE + 19000, repo, 'git status'),
    bash(BASE + 20000, repo, 'grep -rn foo cli'),
    bash(BASE + 21000, repo, "node -e 'console.log(1)'"),
    bash(BASE + 22000, repo, 'git commit -q -m "no task here"'),
    use(BASE + 70000, repo, 'StructuredOutput', { file: 'cli/b.js', status: 'fixed' })
  ]
});

const hijackAgent = (repo) => ({
  id: 'h3', label: 'fix:cli/h.js', lines: [
    user(BASE + 5000, repo, taskText('@hijack-three', 33, 'cli/h.js')),
    line('assistant', BASE + 6000, repo, { id: 'mh', model: MODEL, content: [{ type: 'text', text: 'Sure, the answer to your question is 42.' }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  ]
});

const audit = (env, id, db = null) => auditRun(readRun(id, env.projects), { db, home: env.home, pricing: loadPricing(env.root) });

const makeDb = (t, env) => {
  const db = new DatabaseSync(path.join(env.root, 'audit.db'));
  t.after(() => db.close());
  db.exec(`CREATE TABLE agent_feed (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, author_id TEXT NOT NULL, recipient_id TEXT, thread_id INTEGER, task_id INTEGER, file_path TEXT, event_type TEXT NOT NULL DEFAULT 'broadcast', message TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', read_at INTEGER);
    CREATE TABLE file_lock_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, agent_id TEXT NOT NULL, requested_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'waiting', priority INTEGER NOT NULL DEFAULT 2, purpose TEXT NOT NULL DEFAULT '', pid INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE lease_edit_marks (file_path TEXT PRIMARY KEY, locked_by TEXT NOT NULL, edited_at INTEGER NOT NULL);
    CREATE TABLE agent_tasks (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'queued');`);
  return db;
};

const feed = (db, row) => db.prepare('INSERT INTO agent_feed (timestamp, author_id, recipient_id, file_path, event_type, message, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(row.at, row.author, row.recipient ?? null, row.file ?? null, row.type, row.message ?? row.type, JSON.stringify(row.meta ?? {}));

test('clean run: following the protocol reports nothing and is ok', (t) => {
  const env = makeEnv(t);
  writeRun(env, 'wf_clean', [cleanAgent(env.repo)]);
  const report = audit(env, 'wf_clean');
  assert.deepEqual(report.violations, []);
  assert.equal(report.ok, true);
  assert.equal(report.leases.available, false, 'no db: the lease sections say they were not checked');
  assert.equal(report.adoption.share, 1);
  assert.equal(report.cost.perAgent[0].steps, 5, 'five work calls; the final StructuredOutput is overhead');
  assert.match(renderAuditRun(report), /not checked/);
});

test('bypasses: repo writes count, scratch writes and /dev/null do not', (t) => {
  const env = makeEnv(t);
  writeRun(env, 'wf_dirty', [cleanAgent(env.repo), dirtyAgent(env.repo), hijackAgent(env.repo)]);
  const { bypasses } = audit(env, 'wf_dirty');
  const hows = bypasses.shell.map((b) => `${b.how} ${path.relative(env.repo, b.target)}`).sort();
  assert.deepEqual(hows, ['redirect > cli/c.js', 'sed -i cli/b.js']);
  assert.equal(bypasses.shell[0].handle, '@dirty-two');
  assert.equal(bypasses.shell[0].label, 'fix:cli/b.js');
  assert.deepEqual(bypasses.native.map((b) => `${b.how} ${path.relative(env.repo, b.target)}`), ['Read cli/b.js']);
  for (const b of [...bypasses.shell, ...bypasses.native]) assert.ok(b.at > 0 && b.command.length > 0, 'each finding carries time and command');
});

test('protocol: unleased edits, commits without a task id, unclosed claims', (t) => {
  const env = makeEnv(t);
  writeRun(env, 'wf_dirty', [cleanAgent(env.repo), dirtyAgent(env.repo), hijackAgent(env.repo)]);
  const { protocol } = audit(env, 'wf_dirty');
  assert.deepEqual(protocol.unleasedEdits.map((e) => `${e.handle} ${e.file}`), ['@dirty-two cli/d.js'], 'cli/e.js was created by the agent itself');
  assert.deepEqual(protocol.uncommitted.map((c) => c.handle), ['@dirty-two'], 'a commit in a /tmp scratch repo is not a task commit');
  assert.deepEqual(protocol.unclosedClaims.map((c) => `${c.handle} #${c.task}`), ['@dirty-two #22']);
});

test('a lease the db shows the agent took covers its edit', (t) => {
  const env = makeEnv(t);
  writeRun(env, 'wf_dirty', [dirtyAgent(env.repo)]);
  const db = makeDb(t, env);
  feed(db, { at: BASE + 17500, author: '@dirty-two', file: 'cli/d.js', type: 'lock_acquired' });
  db.prepare("INSERT INTO agent_tasks (id, status) VALUES (22, 'done')").run();
  const { protocol } = audit(env, 'wf_dirty', db);
  assert.deepEqual(protocol.unleasedEdits, []);
  assert.deepEqual(protocol.unclosedClaims, [], 'the db says task 22 is already done');
});

test('adoption: share, covered natives and gaps are counted by command', (t) => {
  const env = makeEnv(t);
  writeRun(env, 'wf_dirty', [dirtyAgent(env.repo)]);
  const { adoption } = audit(env, 'wf_dirty');
  const names = (rows) => rows.map((r) => r.command);
  assert.ok(names(adoption.coveredByCommand).includes('git status'));
  assert.ok(names(adoption.coveredByCommand).includes('grep'));
  assert.ok(names(adoption.coveredByCommand).includes('git commit'));
  assert.ok(names(adoption.gapsByCommand).includes('node -e'));
  assert.ok(adoption.scratch >= 2, 'the /tmp and mktemp commands are scratch, outside the share');
  assert.equal(adoption.share, adoption.chemx / (adoption.chemx + adoption.covered + adoption.gap));
});

test('hijack: a zero-step agent whose result ignores its task is likely, not the clean one', (t) => {
  const env = makeEnv(t);
  writeRun(env, 'wf_dirty', [cleanAgent(env.repo), dirtyAgent(env.repo), hijackAgent(env.repo)]);
  const report = audit(env, 'wf_dirty');
  assert.deepEqual(report.hijacks.map((h) => `${h.level} ${h.handle}`), ['likely @hijack-three']);
  assert.ok(report.hijacks[0].signals.includes('zero-steps'));
  assert.ok(report.violations.some((v) => v.includes('hijack')));
});

test('db: a lapse under an active holder, an abandoned lease, a starved waiter and a guard-bypass event', (t) => {
  const env = makeEnv(t);
  writeRun(env, 'wf_dirty', [cleanAgent(env.repo), dirtyAgent(env.repo)]);
  const db = makeDb(t, env);
  const expired = (file, holder, expiresAt) => feed(db, { at: expiresAt + 1000, author: '@system', file, type: 'lock_expired', meta: { holder, expires_at: expiresAt, acquired_at: BASE, purpose: '#11' } });
  expired('cli/a.js', '@clean-one', BASE + 30000);
  expired('cli/z.js', '@clean-one', BASE + 120000);
  expired('cli/b.js', '@clean-one', BASE + 40000);
  db.prepare('INSERT INTO lease_edit_marks (file_path, locked_by, edited_at) VALUES (?, ?, ?)').run('cli/a.js', '@clean-one', BASE + 31000);
  feed(db, { at: BASE + 5000, author: '@clean-one', file: 'cli/q.js', type: 'lock_acquired' });
  db.prepare("INSERT INTO file_lock_queue (file_path, agent_id, requested_at, status) VALUES ('cli/q.js', '@dirty-two', ?, 'waiting')").run(BASE + 20000);
  feed(db, { at: BASE + 40000, author: '@dirty-two', type: 'guard-bypass', meta: { rule: 'shell-write', reason: 'binary patch', command: 'sed -i x' } });
  const report = audit(env, 'wf_dirty', db);
  assert.equal(report.leases.available, true);
  assert.deepEqual(report.leases.lapsed.map((l) => `${l.handle} ${l.file} ${l.editedAfterLapse}`), ['@clean-one cli/a.js true']);
  assert.deepEqual(report.leases.abandoned.map((l) => l.file), ['cli/z.js']);
  assert.deepEqual(report.leases.benign.map((l) => l.file), ['cli/b.js']);
  assert.ok(!report.violations.some((v) => v.startsWith('2 x lease')));
  assert.equal(report.leases.waiters.starved.length, 1);
  assert.equal(report.leases.waiters.starved[0].holder, '@clean-one');
  assert.equal(report.leases.waiters.starved[0].granted, false);
  assert.deepEqual(report.bypasses.guard.map((g) => `${g.handle} ${g.rule} ${g.reason}`), ['@dirty-two shell-write binary patch']);
  assert.ok(report.violations.some((v) => v.includes('lease lapsed')));
  const text = renderAuditRun(report);
  assert.match(text, /VIOLATED/);
  assert.match(text, /binary patch/);
});

test('db: guard-crash events group into windows and show as enforcement gaps', (t) => {
  const env = makeEnv(t);
  writeRun(env, 'wf_crash', [cleanAgent(env.repo)]);
  const db = makeDb(t, env);
  const crash = (at, author, error) => feed(db, { at, author, type: 'guard-crash', message: `guard-crash claude-pre-tool: ${error}`, meta: { hook: 'claude-pre-tool', error } });
  crash(BASE + 1000, '@claude', 'SyntaxError one');
  crash(BASE + 61000, '@clean-one', 'SyntaxError one');
  crash(BASE + 600000, '@claude', 'ENOENT two');
  const report = audit(env, 'wf_crash', db);
  assert.deepEqual(report.bypasses.crashes.map((c) => `${c.count} ${c.errors.join('|')}`), ['2 SyntaxError one', '1 ENOENT two']);
  assert.ok(report.violations.some((v) => v.includes('guard-crash')));
  assert.match(renderAuditRun(report), /guard-crash windows[^\n]*: 2/);
  assert.deepEqual(audit(env, 'wf_crash').bypasses.crashes, []);
});

test('cli: a violated run exits 1 unless --no-fail; --strict is accepted; --json parses', (t) => {
  const env = makeEnv(t);
  const dirty = writeRun(env, 'wf_dirty', [dirtyAgent(env.repo)]);
  const clean = writeRun(env, 'wf_clean', [cleanAgent(env.repo)]);
  const run = (dir, ...flags) => spawnSync(process.execPath, [CLI, 'team', 'audit-run', `--run=${dir}`, ...flags], { cwd: env.root, encoding: 'utf8', env: { ...process.env, CHEMX_PROJECT_ROOT: '', HOME: env.home } });
  const dirtyStrict = run(dirty, '--strict');
  assert.equal(dirtyStrict.status, 1, dirtyStrict.stderr);
  assert.match(dirtyStrict.stdout, /VIOLATED/);
  assert.equal(run(dirty).status, 1, 'a finding fails by default');
  assert.equal(run(dirty, '--no-fail').status, 0, '--no-fail reports only');
  assert.equal(run(clean, '--strict').status, 0);
  const json = JSON.parse(run(dirty, '--json').stdout);
  assert.equal(json.ok, false);
  assert.equal(run('wf_nope_missing', '--strict').status, 1);
});

const hijackOf = (finalOutput) => hijackSignals({
  taskText: 'You are @rev-one.\n  Target files: cli/test-audit.js\n  TASK #2597', finalOutput, finalText: '', workCalls: 4, cost: 1, medianCost: 1
});

test('hijack: a result naming only the target basename, or a filled schema result, is on-task', () => {
  assert.equal(hijackOf({ note: 'reviewed test-audit.js, nothing wrong' }).level, null);
  assert.equal(hijackOf({ commits: ['abc'], evidence: 'ok' }).level, null, 'schema-shaped, names nothing');
  assert.equal(hijackOf({ note: 'the weather is fine' }).level, 'possible', 'unrelated and not schema-shaped');
  assert.equal(hijackOf({ commits: [], evidence: '' }).level, 'possible', 'empty schema keys do not count');
});

test('adoption: stdin pipe filters with flag values are plumbing, file reads are not', () => {
  const inv = (argv, isPiped) => ({ kind: 'shell', argv, isPiped, isScratch: false });
  const bucket = (argv, isPiped) => classifyInvocation(inv(argv, isPiped)).bucket;
  assert.equal(bucket(['head', '-n', '5'], true), 'neutral');
  assert.equal(bucket(['tail', '-n', '20'], true), 'neutral');
  assert.equal(bucket(['sed', '-n', '1,5p'], true), 'neutral');
  assert.equal(bucket(['grep', '-A', '3', 'foo'], true), 'neutral');
  assert.equal(bucket(['grep', '-n', 'foo', 'file.js'], true), 'covered');
  assert.equal(bucket(['head', '-n', '5', 'file.js'], true), 'covered');
  assert.equal(bucket(['head', '-n', '5'], false), 'covered', 'not piped: still a native read');
});

test('api: runTeamCli returns the report and an error for a missing run', (t) => {
  const env = makeEnv(t);
  const dir = writeRun(env, 'wf_clean', [cleanAgent(env.repo)]);
  const report = runTeamCli(['audit-run', `--run=${dir}`, '--json'], false, env.root);
  assert.equal(report.ok, true);
  assert.match(runTeamCli(['audit-run', '--run=/nonexistent/run'], false, env.root).error, /Run not found/);
  assert.match(runTeamCli(['audit-run'], false, env.root).error, /--run is required/);
});

// #4543: leases and edits are compared as resolved paths, not as written.
const KIT = '/r/apps/chemical-x/starter-kit';
const callsOf = (...commands) => commands.flatMap((command, i) => invocationsOf({ name: 'Bash', at: BASE + i * 1000, cwd: KIT, input: { command } }));

test('4543: a lease taken root-relative covers a patch written relative to the kit dir', () => {
  const invs = callsOf('chemx patch cli/commands-schema-edit.js --target=a --replacement=b');
  const taken = [{ file: 'apps/chemical-x/starter-kit/cli/commands-schema-edit.js', at: BASE }];
  assert.deepEqual(editsWithoutLease(invs, taken), []);
  assert.equal(editsWithoutLease(invs, []).length, 1, 'without the lease it is still a gap');
});

test('4543: cd and simple variables are replayed before comparing', () => {
  const invs = callsOf(
    'cd /r && chemx patch apps/chemical-x/starter-kit/cli/a.js --target=a --replacement=b',
    'K=cli/team; chemx patch $K/b.js --target=a --replacement=b',
    'cd cli && F="c.js" && chemx patch ${F} --target=a --replacement=b'
  );
  const taken = ['cli/a.js', 'cli/team/b.js', 'cli/c.js'].map((f) => ({ file: `apps/chemical-x/starter-kit/${f}`, at: BASE }));
  assert.deepEqual(editsWithoutLease(invs, taken), []);
});

test('4543: an unresolvable path is reported as unresolved, never as unleased', () => {
  const invs = callsOf('chemx patch $UNSET/x.js --target=a --replacement=b', 'cd - && chemx patch y.js --target=a --replacement=b');
  assert.deepEqual(editsWithoutLease(invs, []), []);
  assert.deepEqual(unresolvedEdits(invs).map((e) => e.file), ['$UNSET/x.js', 'y.js']);
});

test('4543: a lapsed lease edited afterwards counts, though the agent wrote a kit-relative path', (t) => {
  const env = makeEnv(t);
  const sub = path.join(env.repo, 'sub');
  const agent = { id: 'l4', label: 'fix:sub/cli/a.js', lines: [
    user(BASE, sub, taskText('@lapse-four', 44, 'cli/a.js')),
    bash(BASE + 31000, sub, 'chemx patch cli/a.js --target=a --replacement=b'),
    use(BASE + 60000, sub, 'StructuredOutput', { status: 'fixed' })
  ] };
  writeRun(env, 'wf_lapse', [agent]);
  const db = makeDb(t, env);
  feed(db, { at: BASE + 30500, author: '@system', file: 'sub/cli/a.js', type: 'lock_expired', meta: { holder: '@lapse-four', expires_at: BASE + 30000, acquired_at: BASE, purpose: '#44' } });
  const report = audit(env, 'wf_lapse', db);
  assert.deepEqual(report.leases.lapsed.map((l) => `${l.handle} ${l.file} ${l.editedAfterLapse}`), ['@lapse-four sub/cli/a.js true']);
});

test('4543: an edit before the lease expired is not a lapse', (t) => {
  const env = makeEnv(t);
  const sub = path.join(env.repo, 'sub');
  const agent = { id: 'l5', label: 'fix:sub/cli/a.js', lines: [
    user(BASE, sub, taskText('@lapse-five', 45, 'cli/a.js')),
    bash(BASE + 10000, sub, 'chemx patch cli/a.js --target=a --replacement=b'),
    use(BASE + 60000, sub, 'StructuredOutput', { status: 'fixed' })
  ] };
  writeRun(env, 'wf_nolapse', [agent]);
  const db = makeDb(t, env);
  feed(db, { at: BASE + 30500, author: '@system', file: 'sub/cli/a.js', type: 'lock_expired', meta: { holder: '@lapse-five', expires_at: BASE + 30000, acquired_at: BASE, purpose: '#45' } });
  assert.deepEqual(audit(env, 'wf_nolapse', db).leases.lapsed, []);
});

test('4543: the path chemx printed (Patched <path>) wins over an unresolvable spelling', () => {
  const entry = (type, message) => JSON.stringify({ type, timestamp: new Date(BASE).toISOString(), cwd: KIT, message });
  const text = [
    entry('assistant', { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'chemx patch $F --target=a --replacement=b' } }] }),
    entry('user', { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '✔ Patched cli/team/x.js (1 block)' }] })
  ].join('\n');
  const invs = readTranscriptCalls(text).calls.flatMap(invocationsOf);
  assert.deepEqual(unresolvedEdits(invs), []);
  const taken = [{ file: 'apps/chemical-x/starter-kit/cli/team/x.js', at: BASE }];
  assert.deepEqual(editsWithoutLease(invs, taken), []);
  assert.equal(editsWithoutLease(invs, []).length, 1);
});

test('4543: a lease on another file does not cover the edit', () => {
  const invs = callsOf('chemx patch cli/a.js --target=a --replacement=b');
  const taken = [{ file: 'apps/chemical-x/starter-kit/cli/other.js', at: BASE }];
  assert.deepEqual(editsWithoutLease(invs, taken).map((e) => e.file), ['cli/a.js']);
});
