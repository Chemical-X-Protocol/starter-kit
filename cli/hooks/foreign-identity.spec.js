/**
 * A dispatched agent may not act as another handle of its own run (#5740). Pure parsing plus the pre-tool decision; no db.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePreTool } from './claude-pre-tool.js';
import { explicitIdentities, foreignRunIdentities, runOfHandle } from './foreign-identity.js';

const CX = 'chem' + 'x';
const OWN = '@validation-5-4201-repair';
const BUILDER = '@validation-5-4201';
const context = { cwd: '/tmp', root: '/tmp', enforceSearch: false, dispatchHandle: OWN };
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const release = (flag) => CX + ' team lock release f ' + flag;
const verifyAs = (id) => 'export CHEMX_AGENT_ID=' + id + '; ' + CX + ' verify';

test('runOfHandle: builder and repair handles share a run; others do not', () => {
  assert.equal(runOfHandle('@polish-1-5740'), 'polish-1');
  assert.equal(runOfHandle('@polish-1-4607-repair'), 'polish-1');
  assert.equal(runOfHandle('@orchestrator'), null);
});

test('explicitIdentities reads --as=, --as <id>, inline and exported agent ids', () => {
  assert.deepEqual(explicitIdentities(release('--as=@a-1-1')), ['@a-1-1']);
  assert.deepEqual(explicitIdentities(release('--as @a-1-2')), ['@a-1-2']);
  assert.deepEqual(explicitIdentities('CHEMX_AGENT_ID=@a-1-3 ' + CX + ' verify'), ['@a-1-3']);
  assert.deepEqual(explicitIdentities(verifyAs('@a-1-4')), ['@a-1-4']);
  assert.deepEqual(explicitIdentities('echo --as=@a-1-5'), []);
});

test('guard denies a repair acting as the builder and names the sanctioned path', () => {
  const denied = decidePreTool(bash(release('--as=' + BUILDER)), context);
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.rule, 'foreign-identity');
  assert.match(denied.reason, /--with-locks/);
  assert.match(denied.reason, /wait --lock-free/);
  assert.equal(decidePreTool(bash(verifyAs(BUILDER)), context).rule, 'foreign-identity');
});

test('guard allows the agent own handle, a handle outside the run, and a non-dispatched session', () => {
  assert.equal(decidePreTool(bash(release('--as=' + OWN)), context).decision, 'allow');
  assert.deepEqual(foreignRunIdentities(release('--as=@other-9-1'), OWN), []);
  assert.equal(decidePreTool(bash(release('--as=' + BUILDER)), { ...context, dispatchHandle: null }).decision, 'allow');
});
