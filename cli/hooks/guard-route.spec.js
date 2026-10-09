/**
 * Launch routing guard (#2027): Agent and Workflow payload fixtures against injected task rows and
 * routing (no disk, no db). Config resolution uses a temp project.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decidePreTool, toPreToolOutput } from './claude-pre-tool.js';
import { resolveRouteGuardMode, extractLaunches } from './guard-route.js';
import { PRE_TOOL_MATCHER } from './claude-settings-merge.js';

const ROWS = new Map([
  [10, { id: 10, title: 'Rename', description: '', needs: 'light' }],
  [20, { id: 20, title: 'Add flag', description: '', needs: 'standard' }],
  [30, { id: 30, title: 'Split module', description: '', needs: 'deep' }],
  [40, { id: 40, title: 'No tier', description: '', needs: null }]
]);
const context = (extra = {}) => ({ cwd: '/repo', root: '/repo', routing: null, routeGuard: 'warn', lookupRouteTasks: (ids) => new Map(ids.filter((id) => ROWS.has(id)).map((id) => [id, ROWS.get(id)])), ...extra });
const agent = (prompt, model) => ({ tool_name: 'Agent', tool_input: { description: 'work', prompt, subagent_type: 'general-purpose', ...(model ? { model } : {}) } });
const workflow = (script) => ({ tool_name: 'Workflow', tool_input: { script } });
const adviceOf = (payload, ctx = context()) => toPreToolOutput(decidePreTool(payload, ctx))?.hookSpecificOutput;

test('Agent with no model on a deep task warns, naming the task, its tier and the routed model', () => {
  const out = adviceOf(agent('Do the work for #30 now'));
  assert.equal(out.permissionDecision, undefined, 'a warning never sets permissionDecision');
  assert.match(out.additionalContext, /#30 \(deep\) sets no model, so it runs on the session's top model; chemx routes opus\/high/);
  assert.match(out.additionalContext, /advice only/);
});

test('Agent with a heavier model than routed warns; matching or lighter models pass', () => {
  assert.match(adviceOf(agent('task #20', 'opus')).additionalContext, /#20 \(standard\) asks for opus; chemx routes sonnet\/medium/);
  assert.equal(adviceOf(agent('task #20', 'sonnet')), undefined);
  assert.equal(adviceOf(agent('task #30', 'opus')), undefined);
  assert.equal(adviceOf(agent('task #30', 'haiku')), undefined);
  assert.equal(adviceOf(agent('task #30', 'claude-opus-4-1')), undefined);
});

test('Workflow script with opus on a light task warns; sonnet passes; a launch with no model warns', () => {
  const heavy = workflow("const r = await agent(`Rename the helper for #10 (see foo(bar))`, { label: 'x', model: 'opus' })");
  assert.match(adviceOf(heavy).additionalContext, /agent\(\) call in the Workflow script for #10 \(light\) asks for opus; chemx routes sonnet\/low/);
  assert.equal(adviceOf(workflow("await agent('Rename #10', { model: 'sonnet', effort: 'low' })")), undefined);
  assert.match(adviceOf(workflow("await agent('Design #30', { label: 'd' })")).additionalContext, /#30 \(deep\) sets no model/);
});

test('Workflow: each agent() call is judged on its own, and a model chosen at run time is left alone', () => {
  const script = [
    "await agent('good #20', { model: 'sonnet' })",
    "await agent('bad #10', { model: 'opus' })",
    "await agent('dynamic #10', { model: pick(task) })"
  ].join('\n');
  const text = adviceOf(workflow(script)).additionalContext;
  assert.match(text, /#10 \(light\) asks for opus/);
  assert.doesNotMatch(text, /#20/);
  assert.equal((text.match(/#10/g) || []).length, 1);
});

test('Workflow scriptPath is read when there is no inline script', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-route-script-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'run.js'), "await agent('Split #30', { model: 'sonnet' })\n");
  const payload = { tool_name: 'Workflow', tool_input: { scriptPath: 'run.js' } };
  assert.equal(adviceOf(payload, context({ cwd: dir })), undefined, 'a lighter model than routed passes');
  fs.writeFileSync(path.join(dir, 'run.js'), "await agent('Rename #10', { model: 'opus' })\n");
  assert.match(adviceOf(payload, context({ cwd: dir })).additionalContext, /#10/);
  assert.equal(adviceOf({ tool_name: 'Workflow', tool_input: { scriptPath: 'missing.js' } }, context({ cwd: dir })), undefined);
});

test('block mode denies with the same finding', () => {
  const result = decidePreTool(agent('Do #30'), context({ routeGuard: 'block' }));
  assert.equal(result.decision, 'deny');
  assert.equal(result.rule, 'route-guard');
  const out = toPreToolOutput(result).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /routeGuard: block[\s\S]*#30 \(deep\)/);
});

test('launches that name no known task, or a task without a tier, pass silently', () => {
  assert.equal(adviceOf(agent('Fix the bug in the parser')), undefined);
  assert.equal(adviceOf(agent('issue #999999 on GitHub')), undefined);
  assert.equal(adviceOf(agent('task #40 has no tier')), undefined);
  assert.equal(adviceOf(workflow("await agent('no ids here', { model: 'opus' })")), undefined);
  assert.deepEqual(extractLaunches('Read', {}), []);
});

test('a launch naming several tasks is judged against the heaviest routed model', () => {
  assert.equal(adviceOf(agent('tasks #10 and #30', 'opus')), undefined);
  assert.match(adviceOf(agent('tasks #10 and #20', 'opus')).additionalContext, /#20 \(standard\) asks for opus/);
});

test('routeGuard comes from the environment, then .chemxrc, defaulting to warn', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-route-mode-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(resolveRouteGuardMode(dir, {}), 'warn');
  fs.writeFileSync(path.join(dir, '.chemxrc'), JSON.stringify({ routeGuard: 'block' }));
  assert.equal(resolveRouteGuardMode(dir, {}), 'block');
  assert.equal(resolveRouteGuardMode(dir, { CHEMX_ROUTE_GUARD: 'warn' }), 'warn');
  fs.writeFileSync(path.join(dir, '.chemxrc'), JSON.stringify({ routeGuard: 'nonsense' }));
  assert.equal(resolveRouteGuardMode(dir, {}), 'warn');
});

test('the installer matcher covers Agent and Workflow', () => {
  assert.ok(PRE_TOOL_MATCHER.split('|').includes('Agent'));
  assert.ok(PRE_TOOL_MATCHER.split('|').includes('Workflow'));
});
