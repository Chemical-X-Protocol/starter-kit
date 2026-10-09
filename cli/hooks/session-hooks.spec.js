import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runPostEdit, formatHazards } from './claude-post-edit.js';
import { parseChangedRanges, scopeViolations } from './post-edit-scope.js';
import { helperHintsFor } from './xatoms-hints.js';
import { buildSessionCard, runSessionStart, CARD_CHAR_BUDGET } from './session-start.js';
import { buildStatusline, runStatusline } from './statusline.js';

const created = [];
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });
const tempProject = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-session-')); created.push(dir); return dir; };
const HAZARDOUS = 'export const poll = (fn) => {\n  setInterval(fn, 1000);\n};\n';
const CATALOG = { helpers: [{ name: 'every', summary: 'setInterval with teardown.', fixes: ['TIMER_DISCIPLINE'], imports: { core: { from: '@chemx/x-atoms/core' }, vue: { from: '@chemx/x-atoms/vue' } } }] };

test('post-edit: hazards in an edited repo source file come back as additionalContext with x-atoms hints', async () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'poll.js'), HAZARDOUS);
  const catalogFile = path.join(root, 'catalog.json');
  fs.writeFileSync(catalogFile, JSON.stringify(CATALOG));
  const env = { CLAUDE_PROJECT_DIR: root, CHEMX_XATOMS_CATALOG: catalogFile };
  const output = await runPostEdit({ tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src', 'poll.js') }, cwd: root }, env);
  assert.equal(output.hookSpecificOutput.hookEventName, 'PostToolUse');
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /chemx check src\/poll\.js \(file\): \d+ hazard/);
  assert.match(context, /L2 TIMER_DISCIPLINE/);
  assert.match(context, /x-atoms: every from @chemx\/x-atoms\/core: setInterval with teardown\./);
});

test('post-edit: clean files, non-source files, files outside the repo and other tools produce nothing', async () => {
  const root = tempProject();
  fs.writeFileSync(path.join(root, 'clean.js'), 'export const add = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(root, 'notes.md'), 'setInterval(x)\n');
  const env = { CLAUDE_PROJECT_DIR: root };
  const edit = (file, tool = 'Edit') => runPostEdit({ tool_name: tool, tool_input: { file_path: file }, cwd: root }, env);
  assert.equal(await edit(path.join(root, 'clean.js')), null);
  assert.equal(await edit(path.join(root, 'notes.md')), null);
  assert.equal(await edit(path.join(os.tmpdir(), 'elsewhere.js')), null);
  assert.equal(await edit(path.join(root, 'clean.js'), 'Read'), null);
});

test('post-edit scope: --since keeps only hazards on changed lines; untracked files keep all', () => {
  assert.deepEqual(parseChangedRanges('@@ -1,0 +2,3 @@\n+a\n@@ -9 +12 @@\n@@ -20,2 +22,0 @@'), [[2, 4], [12, 12]]);
  const root = tempProject();
  spawnSync('git', ['init', '-q'], { cwd: root });
  const file = path.join(root, 'a.js');
  fs.writeFileSync(file, 'setInterval(a, 1);\nconst x = 1;\n');
  const violations = [{ line: 1, rule: 'OLD' }, { line: 3, rule: 'NEW' }];
  assert.equal(scopeViolations(violations, { file, cwd: root, since: 'HEAD' }).violations.length, 2, 'untracked: whole file');
  spawnSync('git', ['add', '.'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: root });
  fs.appendFileSync(file, 'setInterval(b, 1);\n');
  const scoped = scopeViolations(violations, { file, cwd: root, since: 'HEAD' });
  assert.deepEqual([scoped.scope, scoped.violations.map((violation) => violation.rule)], ['since HEAD', ['NEW']]);
  assert.equal(scopeViolations(violations, { file, cwd: root }).scope, 'file');
});

test('x-atoms hints pick the framework flavor of the edited file and cap long reports', () => {
  assert.deepEqual(helperHintsFor(CATALOG, 'TIMER_DISCIPLINE', 'src/a.vue'), ['every from @chemx/x-atoms/vue: setInterval with teardown.']);
  assert.deepEqual(helperHintsFor(null, 'TIMER_DISCIPLINE', 'src/a.ts'), []);
  const many = Array.from({ length: 12 }, (_, index) => ({ line: index + 1, rule: 'R', severity: 'LOW', hazard: 'h' }));
  assert.match(formatHazards({ relativePath: 'a.js', scope: 'file', violations: many, catalog: null }), /\.\.\.4 more: chemx check a\.js/);
});

const STATUS = {
  root: '/repo',
  version: '1.2.3',
  audit: { grade: 'B', score: 84, files: 120, ageMinutes: 90 },
  ratchet: { scope: 'cli', rules: 5, ceiling: 125 },
  mcpLaunch: { ok: true, summary: '' },
  servers: { running: 3, stale: 2 },
};

test('session-start card stays under the 300-token budget and states root, version, grade, ratchet and stale servers', () => {
  const card = buildSessionCard(STATUS);
  assert.ok(card.length <= CARD_CHAR_BUDGET && card.length / 4 < 300, `card is ${card.length} chars`);
  for (const fact of ['chemx 1.2.3', 'root /repo', 'B (84/100) over 120 files, 2h ago', 'Ratchet (cli): 5 rules, ceiling 125', 'WARNING: 2 chemx MCP server(s)']) assert.ok(card.includes(fact), fact);
  const minimal = buildSessionCard({ ...STATUS, audit: null, ratchet: null, servers: null, mcpLaunch: { ok: false, summary: 'chemical-x not configured' } });
  assert.match(minimal, /MCP launch: chemical-x not configured\. Run chemx doctor --fix\./);
  assert.doesNotMatch(minimal, /Last audit|Ratchet|WARNING/);
});

test('statusline is one plain line with grade, ratchet and stale-server state', () => {
  const line = buildStatusline(STATUS);
  assert.equal(line, 'chemx 1.2.3 | grade B 84 (2h ago) | ratchet cli<=125 | MCP STALE x2');
  assert.doesNotMatch(line, /\x1b|\n/);
  assert.equal(buildStatusline({ ...STATUS, audit: null, ratchet: null, servers: { running: 1, stale: 0 } }), 'chemx 1.2.3 | grade ? | mcp ok x1');
});

test('session-start and statusline read real project files end to end', async () => {
  const root = tempProject();
  fs.mkdirSync(path.join(root, '.chemx'));
  fs.writeFileSync(path.join(root, '.chemx', 'history.json'), JSON.stringify([{ timestamp: new Date().toISOString(), health: { grade: 'A', score: 92 }, metrics: { scannedFiles: 7 } }]));
  fs.writeFileSync(path.join(root, 'chemx-ratchet.json'), JSON.stringify({ scope: 'src', rules: { A: 2, B: 3 } }));
  const env = { CLAUDE_PROJECT_DIR: root, CHEMX_PROC_ROOT: path.join(root, 'no-proc') };
  const card = (await runSessionStart({}, env)).hookSpecificOutput.additionalContext;
  assert.match(card, /Last audit: A \(92\/100\) over 7 files, 0m ago/);
  assert.match(await runStatusline({}, env), /grade A 92 \(0m ago\) \| ratchet src<=5 \| launch: run chemx doctor$/);
});
