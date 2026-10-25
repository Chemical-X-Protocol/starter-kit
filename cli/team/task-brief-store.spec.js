/**
 * Task briefs (K14, #6759): `team brief <id> --file <path> | --stdin | --clear` stores a long design text apart
 * from the description; `task show` prints its length, `task show --full` and `team brief <id>` print it,
 * and the MCP task tool exposes the same. (cli/team/team-brief.js is the SessionStart card, not this.)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runTeamCli } from './team-commands.js';
import { openTeamContext } from './coordination-db.js';
import { queryFeed } from './team-db-feed.js';
import { checkBriefText, summarizeBrief, MAX_BRIEF_CHARS } from './task-brief-store.js';
import { handleChemxTeamTask } from '../mcp/tools-team-tasks.js';
import { stripAnsi } from '../terminal.js';

delete process.env.CHEMX_PROJECT_ROOT;

const CLI = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'index.js');
const BRIEF = `# Contract\n\n${'One lease call takes many paths. '.repeat(40)}\n\n- a refusal names the path\n`;

const makeBoard = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-brief-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  runTeamCli(['task', 'add', 'Needs a brief', '--desc=short ask'], false, root);
  return { root, db: openTeamContext(root).db };
};

const cli = (root, args) => {
  const streams = [process.stdout, process.stderr];
  const originals = streams.map((stream) => stream.write);
  let output = '';
  for (const stream of streams) stream.write = (chunk) => { output += String(chunk); return true; };
  try {
    runTeamCli(args, true, root);
  } finally {
    streams.forEach((stream, index) => { stream.write = originals[index]; });
  }
  const exitCode = process.exitCode ?? 0;
  process.exitCode = 0;
  return { text: stripAnsi(output), exitCode };
};

const spawnCli = (root, args, input) => spawnSync(process.execPath, [CLI, ...args], {
  cwd: root, input, encoding: 'utf8', env: { ...process.env, CHEMX_PROJECT_ROOT: '', NO_COLOR: '1' }
});

test('checkBriefText: end-trimmed text passes; empty and over-long text is refused', () => {
  assert.deepEqual(checkBriefText('text  \n\n'), { text: 'text' });
  assert.match(checkBriefText('   \n').error, /empty/);
  assert.match(checkBriefText('x'.repeat(MAX_BRIEF_CHARS + 1)).error, /limit is 200,000/);
  assert.deepEqual(summarizeBrief({ id: 1, brief: 'abc' }), { id: 1, briefChars: 3 });
  assert.deepEqual(summarizeBrief({ id: 1, brief: 'abc' }, { full: true }), { id: 1, brief: 'abc', briefChars: 3 });
});

test('team brief <id> --file stores the brief; the description and the id stay as they were', (t) => {
  const { root, db } = makeBoard(t);
  fs.writeFileSync(path.join(root, 'brief.md'), BRIEF);
  const set = cli(root, ['brief', '1', '--file', 'brief.md', '--as=@gm']);
  assert.equal(set.exitCode, 0, set.text);
  assert.match(set.text, new RegExp(`^#1: brief set \\(${BRIEF.trimEnd().length.toLocaleString('en-US').replace(/,/g, ',')} chars\\)`));
  const row = db.prepare('SELECT description, brief FROM agent_tasks WHERE id = 1').get();
  assert.equal(row.description, 'short ask');
  assert.equal(row.brief, BRIEF.trimEnd());
  const note = queryFeed(db, { task_id: 1 }).find((event) => /^Brief set on #1/.test(event.message));
  assert.equal(note.author_id, '@gm');
  const same = cli(root, ['task', 'brief', '1', '--file=brief.md']);
  assert.equal(same.exitCode, 0, 'task brief is the same command as team brief');
});

test('team brief <id> --stdin reads standard input through the real CLI, and chemx task is an alias of chemx team task', (t) => {
  const { root, db } = makeBoard(t);
  const set = spawnCli(root, ['team', 'brief', '1', '--stdin', '--as=@gm'], BRIEF);
  assert.equal(set.status, 0, set.stderr);
  assert.equal(db.prepare('SELECT brief FROM agent_tasks WHERE id = 1').get().brief, BRIEF.trimEnd());
  const read = spawnCli(root, ['task', 'brief', '1']);
  assert.equal(read.stdout, `${BRIEF.trimEnd()}\n`);
});

test('team brief <id> with no source prints the brief; a task with none says so; --clear removes it', (t) => {
  const { root, db } = makeBoard(t);
  const none = cli(root, ['brief', '1']);
  assert.equal(none.exitCode, 1);
  assert.match(none.text, /Task #1 has no brief/);
  db.prepare('UPDATE agent_tasks SET brief = ? WHERE id = 1').run('stored text');
  assert.equal(cli(root, ['brief', '1']).text, 'stored text\n');
  const json = JSON.parse(cli(root, ['brief', '1', '--json']).text);
  assert.deepEqual([json.task_id, json.chars, json.brief], [1, 11, 'stored text']);
  const cleared = cli(root, ['brief', '1', '--clear', '--as=@gm']);
  assert.match(cleared.text, /^#1: brief cleared/);
  assert.equal(db.prepare('SELECT brief FROM agent_tasks WHERE id = 1').get().brief, '');
});

test('team brief refuses an empty file, a missing file, both sources and an unknown task, and writes nothing', (t) => {
  const { root, db } = makeBoard(t);
  fs.writeFileSync(path.join(root, 'empty.md'), '  \n');
  const cases = [
    [['brief', '1', '--file', 'empty.md'], /the brief is empty/],
    [['brief', '1', '--file', 'missing.md'], /cannot read missing\.md/],
    [['brief', '1', '--file', 'empty.md', '--clear'], /not several/],
    [['brief', '99', '--file', 'empty.md'], /Task #99 not found/]
  ];
  for (const [args, pattern] of cases) {
    const out = cli(root, args);
    assert.equal(out.exitCode, 1, args.join(' '));
    assert.match(out.text, pattern);
  }
  assert.equal(db.prepare('SELECT brief FROM agent_tasks WHERE id = 1').get().brief, '');
});

test('task show prints the brief length, not the brief; --full prints it; --brief and --json carry the length', (t) => {
  const { root, db } = makeBoard(t);
  db.prepare('UPDATE agent_tasks SET brief = ? WHERE id = 1').run(BRIEF.trimEnd());
  const chars = BRIEF.trimEnd().length;
  const card = cli(root, ['task', 'show', '1']).text;
  assert.match(card, new RegExp(`Brief:\\s+${chars.toLocaleString('en-US')} chars \\(task show 1 --full prints it\\)`));
  assert.doesNotMatch(card, /One lease call takes many paths/);
  const full = cli(root, ['task', 'show', '1', '--full']).text;
  assert.match(full, /Brief \(.* chars\):/);
  assert.match(full, /One lease call takes many paths\./);
  assert.match(full, /- a refusal names the path/, 'line breaks of the brief are kept');
  const brief = cli(root, ['task', 'show', '1', '--brief']).text;
  assert.match(brief, new RegExp(`brief stored \\(${chars.toLocaleString('en-US')} chars\\)`));
  const json = JSON.parse(cli(root, ['task', 'show', '1', '--json']).text);
  assert.equal(json.task.briefChars, chars);
  assert.equal(json.task.brief, undefined, 'the JSON card does not carry the text unless --full');
  const jsonFull = JSON.parse(cli(root, ['task', 'show', '1', '--json', '--full']).text);
  assert.equal(jsonFull.task.brief, BRIEF.trimEnd());
});

test('the MCP task tool sets, reads and clears a brief, and show hides it unless full', async (t) => {
  const { root, db } = makeBoard(t);
  fs.writeFileSync(path.join(root, 'b.md'), BRIEF);
  const set = await handleChemxTeamTask({ action: 'brief', taskId: 1, briefFile: 'b.md', agentId: '@gm' }, root);
  assert.equal(set.chars, BRIEF.trimEnd().length);
  assert.match(set.ack, /^#1: brief set/);
  const hidden = await handleChemxTeamTask({ action: 'show', taskId: 1 }, root);
  assert.equal(hidden.task.brief, undefined);
  assert.equal(hidden.task.briefChars, BRIEF.trimEnd().length);
  const shown = await handleChemxTeamTask({ action: 'show', taskId: 1, full: true }, root);
  assert.equal(shown.task.brief, BRIEF.trimEnd());
  assert.equal((await handleChemxTeamTask({ action: 'brief', taskId: 1 }, root)).brief, BRIEF.trimEnd());
  const inline = await handleChemxTeamTask({ action: 'brief', taskId: 1, briefText: 'inline brief' }, root);
  assert.equal(inline.chars, 12);
  assert.match((await handleChemxTeamTask({ action: 'brief', taskId: 1, briefText: ' ' }, root)).error, /empty/);
  assert.equal((await handleChemxTeamTask({ action: 'brief', taskId: 1, clear: true }, root)).action, 'cleared');
  assert.equal(db.prepare('SELECT brief FROM agent_tasks WHERE id = 1').get().brief, '');
  const created = await handleChemxTeamTask({ action: 'create', title: 'With brief', description: 'd', briefText: 'made with it', kind: 'epic' }, root);
  assert.equal(db.prepare('SELECT brief, description, kind FROM agent_tasks WHERE id = ?').get(created.id).brief, 'made with it');
});
