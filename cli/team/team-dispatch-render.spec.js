/**
 * Dispatch renderers (#2005): JSON plan, Claude Code Workflow script (meta literal on line 1,
 * body runs under stubbed agent/pipeline), headless claude -p script (sh -n clean), summary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { planDispatchBatches } from './team-dispatch-batches.js';
import { routeModel } from './team-dispatch.js';
import {
  buildAgentPrompt,
  renderDispatchHeadless,
  renderDispatchJson,
  renderDispatchSummary,
  renderDispatchWorkflow,
  shellQuote,
  summarizeSkipped
} from './team-dispatch-render.js';

// Load a generated Workflow script as a module: the meta line stays an export, the body
// becomes an async default export taking the Workflow hooks. Parse errors fail the import.
const loadWorkflowModule = async (t, script) => {
  const [metaLine, ...body] = script.split('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-dispatch-wf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'workflow.mjs');
  const source = [metaLine, 'export default async (agent, pipeline, phase, log, args) => {', ...body, '};'].join('\n');
  fs.writeFileSync(file, source);
  return { metaLine, module: await import(pathToFileURL(file).href) };
};

const makePlan = () => {
  const tasks = [
    { id: 11, title: "Fix the user's `x-btn` usage", description: '', target_path: 'src/a.vue', priority: 1, needs: 'light', rule_id: '' },
    { id: 12, title: 'Split monolith', description: 'see cli/b.js:40', target_path: 'cli/b.js', priority: 2, needs: 'deep', rule_id: '' },
    { id: 13, title: 'Locked work', description: '', target_path: 'cli/c.js', priority: 2, needs: 'standard', rule_id: '' }
  ];
  const leaseCheck = (file) => (file === 'cli/c.js' ? { lockedBy: '@peer', expiresAt: 1, purpose: '' } : null);
  const planned = planDispatchBatches(tasks, { scope: '2006', leaseCheck });
  return {
    root: "/work/it's root",
    scope: '2006',
    frictionParent: 2006,
    routingSource: 'defaults',
    batches: planned.batches.map((batch) => ({ ...batch, ...routeModel(batch.needs) })),
    skipped: planned.skipped,
    totals: { selected: 3, dispatched: 2, skipped: 1, agents: 2 }
  };
};

test('buildAgentPrompt: identity, owned files and the claim/lock/chemx-only/done loop', () => {
  const plan = makePlan();
  const prompt = buildAgentPrompt(plan.batches[0], plan);
  const handle = plan.batches[0].handle;
  assert.equal(handle, '@dispatch-2006-1');
  for (const expected of [
    `CHEMX_AGENT_ID=${handle}`,
    `chemx team task claim <id> --as=${handle}`,
    `chemx team lock acquire <file> --as=${handle} --purpose="#<id>"`,
    'chemx patch',
    `chemx team task comment <id>`,
    `"Friction: <what>" --parent=2006 --needs=light`,
    'chemx check <file>',
    `chemx team task done <id> --target=<file> --as=${handle}`,
    `chemx team lock release <file> --as=${handle}`,
    'You own only these files: src/a.vue.',
    '- #11 [light]'
  ]) assert.ok(prompt.includes(expected), `prompt includes ${expected}`);
  assert.ok(prompt.length < 2000, 'prompt stays compact');
});

test('renderDispatchJson: parses and carries each batch prompt and the skipped list', () => {
  const parsed = JSON.parse(renderDispatchJson(makePlan()));
  assert.equal(parsed.batches.length, 2);
  assert.ok(parsed.batches.every((batch) => batch.prompt.includes(batch.handle)));
  assert.deepEqual(parsed.skipped.map((entry) => [entry.id, entry.reason]), [[13, 'locked']]);
});

test('renderDispatchWorkflow: meta literal on line 1 and a body that pipelines one agent per batch', async (t) => {
  const script = renderDispatchWorkflow(makePlan());
  const { metaLine, module } = await loadWorkflowModule(t, script);
  assert.ok(metaLine.startsWith('export const meta = {'));
  assert.equal(module.meta.name, 'chemx-dispatch-2006');
  assert.deepEqual(module.meta.phases.map((phase) => phase.title), ['Dispatch']);
  const calls = [];
  const hooks = {
    agent: async (prompt, opts) => {
      calls.push({ prompt, opts });
      return `${opts.label} ok`;
    },
    pipeline: async (items, stage) => Promise.all(items.map((item, index) => stage(item, item, index))),
    phase: () => {},
    log: () => {}
  };
  const result = await module.default(hooks.agent, hooks.pipeline, hooks.phase, hooks.log, undefined);
  assert.deepEqual(calls.map((call) => [call.opts.label, call.opts.model, call.opts.effort, call.opts.phase]), [
    ['@dispatch-2006-1', 'sonnet', 'low', 'Dispatch'],
    ['@dispatch-2006-2', 'opus', 'high', 'Dispatch']
  ]);
  assert.deepEqual(result, [
    { handle: '@dispatch-2006-1', taskIds: [11], result: '@dispatch-2006-1 ok' },
    { handle: '@dispatch-2006-2', taskIds: [12], result: '@dispatch-2006-2 ok' }
  ]);
  assert.ok(script.includes('// skipped: #13 locked (cli/c.js held by @peer)'));
});

test('renderDispatchHeadless: one background claude -p per batch with its model, valid sh', () => {
  const script = renderDispatchHeadless(makePlan());
  const runs = script.split('\n').filter((line) => line.startsWith('CHEMX_AGENT_ID='));
  assert.equal(runs.length, 2);
  assert.ok(runs[0].startsWith("CHEMX_AGENT_ID='@dispatch-2006-1' claude --model 'sonnet' -p '"));
  assert.ok(runs[1].startsWith("CHEMX_AGENT_ID='@dispatch-2006-2' claude --model 'opus' -p '"));
  assert.ok(script.includes(`cd ${shellQuote("/work/it's root")} || exit 1`));
  assert.ok(script.trimEnd().endsWith('wait'));
  const syntax = spawnSync('sh', ['-n'], { input: script, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('shellQuote: survives single quotes', () => {
  const quoted = shellQuote("it's");
  const echoed = spawnSync('sh', ['-c', `printf %s ${quoted}`], { encoding: 'utf8' });
  assert.equal(echoed.stdout, "it's");
});

test('renderDispatchSummary: header, one line per batch, skipped tasks', () => {
  const lines = renderDispatchSummary(makePlan()).split('\n');
  assert.ok(lines[0].includes('2 agent(s), 2 task(s), 1 skipped (routing: defaults)'));
  assert.ok(lines[1].includes('@dispatch-2006-1 sonnet/low [light] #11 :: src/a.vue'));
  assert.ok(lines[3].includes('skipped #13 locked (cli/c.js held by @peer)'));
});

test('summarizeSkipped: locked tasks one per line, other reasons counted with an id preview', () => {
  const many = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, reason: 'no_files' }));
  const lines = summarizeSkipped([{ id: 50, reason: 'locked', lease: { file: 'a.js', lockedBy: '@x' } }, ...many]);
  assert.deepEqual(lines, ['#50 locked (a.js held by @x)', 'no_files x10: #1 #2 #3 #4 #5 #6 #7 #8 +2']);
  assert.deepEqual(summarizeSkipped(), []);
});
