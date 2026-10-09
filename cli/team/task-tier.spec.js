/**
 * Task tier defaults (friction task #1528): planning and epic tasks stay untiered;
 * only an explicit --tier or a code --target implies one. Also covers --reason parsing,
 * which `task update --status=blocked` relies on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamCli } from './team-commands.js';
import { resolveTaskTier } from './task-tier.js';
import { handleChemxTeamTask } from '../mcp/tools-team-tasks.js';

const makeProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-task-tier-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test('tier: resolveTaskTier only infers a tier from code targets', () => {
  assert.equal(resolveTaskTier(undefined, undefined), '');
  assert.equal(resolveTaskTier('', 'docs/plan.md'), '');
  assert.equal(resolveTaskTier(undefined, 'src/components/molecules/m-card.vue'), 'molecule');
  assert.equal(resolveTaskTier(undefined, 'src/components/atoms/AtomButton.vue'), 'atom');
  assert.equal(resolveTaskTier('organism', 'docs/plan.md'), 'organism', 'explicit wins');
});

test('tier: CLI task add without --tier leaves planning tasks untiered', (t) => {
  const root = makeProject(t);
  const epic = runTeamCli(['task', 'add', 'Plan the release'], false, root);
  assert.equal(epic.tier, '');
  const component = runTeamCli(['task', 'add', 'Split card', '--target=src/molecules/m-card.vue'], false, root);
  assert.equal(component.tier, 'molecule');
  const explicit = runTeamCli(['task', 'add', 'Atom work', '--tier=atom'], false, root);
  assert.equal(explicit.tier, 'atom');
});

test('tier: MCP task add follows the same rule', async (t) => {
  const root = makeProject(t);
  const task = await handleChemxTeamTask({ action: 'add', title: 'Write the plan' }, root);
  assert.equal(task.tier, '');
});

test('flags: task update --reason is recorded as the blocked reason', (t) => {
  const root = makeProject(t);
  const task = runTeamCli(['task', 'add', 'Blocked thing'], false, root);
  const updated = runTeamCli(['task', 'update', String(task.id), '--status=blocked', '--as=@t', '--reason=waiting on G6 transactions'], false, root);
  assert.equal(updated.status, 'blocked');
  assert.equal(updated.blocked_reason, 'waiting on G6 transactions');
});
