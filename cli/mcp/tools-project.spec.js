import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { initTeamSchema } from '../team/team-schema.js';
import { handleChemxProject } from './tools-project.js';
import { handleChemx } from './tools.js';

test('mcp-tools: handleChemxProject lifecycle operations', async () => {
  const session = await handleChemxProject({
    subAction: 'init',
    goal: 'Test project through MCP gateway',
    budgetLimit: 1.0,
    maxTurns: 5
  });

  assert.ok(session);
  assert.equal(session.goal_description, 'Test project through MCP gateway');

  const chatRes = await handleChemxProject({
    subAction: 'chat',
    message: 'Focus on atom decomposition first'
  });
  assert.ok(chatRes);
  assert.equal(chatRes.message, 'Focus on atom decomposition first');

  const stepRes = await handleChemxProject({
    subAction: 'step'
  });
  assert.ok(stepRes);
  assert.equal(stepRes.status, 'ok');
  assert.equal(stepRes.turn, 1);

  const statusRes = await handleChemxProject({
    subAction: 'status'
  });
  assert.ok(statusRes.session);
  assert.equal(statusRes.session.current_turn, 1);
});

test('mcp-tools: master tool chemx command parser routes project', async () => {
  const initRes = await handleChemx({
    command: 'project init "Master Gateway Initiative"'
  });
  assert.ok(initRes);
  assert.equal(initRes.title, 'Master Gateway Initiative');

  const statusRes = await handleChemx({
    command: 'project status'
  });
  assert.ok(statusRes.session);
});
