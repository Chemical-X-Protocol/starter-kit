/**
 * chemx team route (#2027): per-tier routing from dispatch v2's routeStages, unknown ids and tasks
 * without needs, JSON output, config routing, the task show line and the session brief. In-memory
 * fixture db for routing; the brief test uses a temp project with its own temp db.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIndexDb } from '../search-schema.js';
import { createTask, claimTask } from './team-db-tasks.js';
import { makeFixtureDb } from './team-dispatch-v2-fixture.js';
import { buildRoutes, buildLabelFor, formatRoutes, handleRouteCommand } from './team-route.js';
import { formatTaskBriefLines } from './task-detail-sections.js';
import { collectTeamBrief, formatTeamBrief } from './team-brief.js';

delete process.env.CHEMX_PROJECT_ROOT;

const label = (route) => `${route.model}/${route.effort}`;

test('route: each tier gets its build, review and repair route, and the mechanical light task builds on haiku', () => {
  const { routes } = buildRoutes(makeFixtureDb(), [1, 2, 3, 4]);
  const byTask = Object.fromEntries(routes.map((route) => [route.task, route]));
  assert.deepEqual([byTask[2].build, byTask[2].review, byTask[2].repair].map(label), ['sonnet/low', 'sonnet/low', 'sonnet/low']);
  assert.deepEqual([byTask[3].build, byTask[3].review, byTask[3].repair].map(label), ['sonnet/medium', 'sonnet/medium', 'sonnet/low']);
  assert.deepEqual([byTask[4].build, byTask[4].review, byTask[4].repair].map(label), ['opus/high', 'opus/high', 'sonnet/low']);
  assert.equal(label(byTask[1].build), 'haiku/low');
  assert.match(byTask[4].why, /needs=deep.*built-in defaults.*repair uses the light entry/);
  assert.match(byTask[1].why, /mechanical/);
});

test('route: configured modelRouting wins and the why says so', () => {
  const routing = { deep: { model: 'opus', effort: 'xhigh' }, light: 'haiku' };
  const { routes } = buildRoutes(makeFixtureDb(), [2, 4], { routing });
  assert.equal(label(routes[0].build), 'haiku/low');
  assert.equal(label(routes[1].build), 'opus/xhigh');
  assert.match(routes[1].why, /modelRouting in \.chemx\/config\.json/);
});

test('route: unknown ids and tasks without needs say so', () => {
  const db = makeFixtureDb();
  db.prepare('UPDATE agent_tasks SET needs = NULL WHERE id = 3').run();
  const result = buildRoutes(db, [3, 424242]);
  assert.equal(result.routes[0].needs, null);
  assert.match(result.routes[0].why, /no needs tier/);
  assert.deepEqual(result.unknown, [424242]);
  const text = formatRoutes(result);
  assert.match(text, /#3 no needs tier set/);
  assert.match(text, /#424242 not found/);
});

test('route command: ids with or without #, --json, and missing ids', (t) => {
  const written = [];
  t.mock.method(process.stdout, 'write', (chunk) => { written.push(String(chunk)); return true; });
  t.mock.method(process.stderr, 'write', () => true);
  const db = makeFixtureDb();
  const out = handleRouteCommand(db, ['#4', '2'], {}, true, os.tmpdir());
  assert.deepEqual(out.routes.map((route) => route.task), [4, 2]);
  assert.match(written.join(''), /#4 deep: build opus\/high \| review opus\/high \| repair sonnet\/low/);
  written.length = 0;
  handleRouteCommand(db, ['4'], { isJson: true }, true, os.tmpdir());
  assert.equal(JSON.parse(written.join('')).routes[0].build.model, 'opus');
  assert.equal(handleRouteCommand(db, [], {}, true, os.tmpdir()).error, 'task ids required');
});

test('task show: the Needs line carries the routed build model, and only then', () => {
  const task = { id: 4, title: 'Split', needs: 'deep' };
  const withRoute = formatTaskBriefLines(task, [], buildLabelFor(task)).join('\n');
  assert.match(withRoute, /Needs:\x1b\[0m deep \(build opus\/high\)/);
  assert.equal(buildLabelFor({ id: 9, needs: null }), null);
  assert.doesNotMatch(formatTaskBriefLines({ id: 9, needs: null }, [], null).join('\n'), /build/);
});

test('brief: a claim with a needs tier lists its routed build model', (t) => {
  const original = process.cwd();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-route-brief-')));
  process.chdir(root);
  t.after(() => {
    process.chdir(original);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const db = openIndexDb(root, { fresh: true });
  const deep = createTask(db, { title: 'Design it', needs: 'deep' });
  const plain = createTask(db, { title: 'No tier' });
  claimTask(db, deep.id, '@me');
  claimTask(db, plain.id, '@me');
  const line = formatTeamBrief(collectTeamBrief({ root, agentId: '@me' })).split('\n')[0];
  assert.match(line, new RegExp(`#${deep.id} opus/high`));
  assert.match(line, new RegExp(`#${plain.id}(,|\\))`));
});

test('route: a task with no needs takes its audit rule tier, as dispatch does', () => {
  const db = makeFixtureDb();
  db.prepare("UPDATE agent_tasks SET needs = NULL, rule_id = 'VIEW_MONOLITH' WHERE id = 3").run();
  const { routes } = buildRoutes(db, [3]);
  assert.equal(routes[0].needs, 'deep');
  assert.equal(routes[0].needsSource, 'rule');
  assert.equal(label(routes[0].build), 'opus/high');
  assert.match(routes[0].why, /audit rule/);
  assert.equal(buildLabelFor({ id: 3, needs: null, rule_id: 'VIEW_MONOLITH' }), 'opus/high');
});
