import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleChemxProject } from './tools-project.js';
import { handleChemx } from './tools.js';
import { resolveAgentId } from '../team/agent-identity.js';

// findChemxDir honours CHEMX_PROJECT_ROOT before the cwd; drop it so the temp project is the db.
delete process.env.CHEMX_PROJECT_ROOT;

// Each test gets its own throwaway project so project sessions and triage never touch a real .chemx/index.db.
const makeTempProject = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-project-tool-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test('mcp-tools: handleChemxProject lifecycle operations', async (t) => {
  const cwd = makeTempProject(t);
  const session = await handleChemxProject({
    subAction: 'init',
    goal: 'Test project through MCP gateway',
    budgetLimit: 1.0,
    maxTurns: 5
  }, cwd);

  assert.ok(session);
  assert.equal(session.goal_description, 'Test project through MCP gateway');

  const chatRes = await handleChemxProject({
    subAction: 'chat',
    message: 'Focus on atom decomposition first'
  }, cwd);
  assert.ok(chatRes);
  assert.equal(chatRes.message, 'Focus on atom decomposition first');

  const stepRes = await handleChemxProject({
    subAction: 'step'
  }, cwd);
  assert.ok(stepRes);
  assert.equal(stepRes.status, 'ok');
  assert.equal(stepRes.turn, 1);
  // The task goes to the caller's own identity, never a hardcoded persona such as '@coder'.
  const caller = resolveAgentId();
  assert.equal(stepRes.agent, caller);
  assert.ok(stepRes.task, 'step claims the queued goal task');
  assert.equal(stepRes.task.status, 'in_progress');
  assert.equal(stepRes.task.assigned_agent_id, caller);

  // A second step must not "verify" the in-progress task by marking it done unchecked.
  const secondStep = await handleChemxProject({ subAction: 'step' }, cwd);
  assert.equal(secondStep.status, 'ok');
  assert.equal(secondStep.task, null);
  assert.match(secondStep.action, /^awaiting_1_active_task/);

  const statusRes = await handleChemxProject({
    subAction: 'status'
  }, cwd);
  assert.ok(statusRes.session);
  assert.equal(statusRes.session.current_turn, 2);
  assert.equal(statusRes.activeTasks.length, 1, 'the claimed task stays in progress');
});

test('mcp-tools: master tool chemx command parser routes project', async (t) => {
  const projectRoot = makeTempProject(t);
  const initRes = await handleChemx({
    command: 'project init "Master Gateway Initiative"',
    projectRoot
  });
  assert.ok(initRes);
  assert.equal(initRes.title, 'Master Gateway Initiative');

  const statusRes = await handleChemx({
    command: 'project status',
    projectRoot
  });
  assert.ok(statusRes.session);
});
