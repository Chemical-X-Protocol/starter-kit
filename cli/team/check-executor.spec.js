import test from 'node:test';
import assert from 'node:assert/strict';
import { currentRequestSignal } from '../request-context.js';
import { collectFaults, createCheckExecutor, toCheckResult } from './check-executor.js';

const workspaceReport = {
  status: 'fail',
  scope: 'workspace',
  packages: [
    { package: 'app', dir: 'apps/app', status: 'fail', errorCount: 2, errors: [{ file: 'src/a.ts', line: 4, code: 'TS2322', message: 'bad type' }, { file: 'src/b.ts', line: 9, code: 'TS1005', message: 'expected ;' }] },
    { package: 'lib', dir: '.', status: 'pass', errorCount: 0, errors: [] },
    { package: 'web', dir: 'apps/web', status: 'fail', failed: 1, failures: [{ name: 'renders the card', details: ['expected 1', 'received 2'] }] }
  ]
};

test('executor: a workspace report descends into its packages, prefixing each fault path with the package dir', () => {
  const faults = collectFaults(workspaceReport);
  assert.deepEqual(faults.map((fault) => fault.file), ['apps/app/src/a.ts', 'apps/app/src/b.ts', 'renders the card']);
  assert.equal(faults[0].message, 'bad type');
});

test('executor: a failed test keeps its name as the location and its details as the message', () => {
  const [fault] = collectFaults({ status: 'fail', failures: [{ name: 'adds up', details: ['expected 1', 'received 2'] }] });
  assert.equal(fault.file, 'adds up');
  assert.equal(fault.message, 'expected 1 received 2');
});

test('executor: the workspace result counts every package fault and names the first reason a package gives', () => {
  const report = { ...workspaceReport, packages: [...workspaceReport.packages, { package: 'api', dir: 'apps/api', status: 'fail', executionError: 'no node_modules' }] };
  const result = toCheckResult(report, Date.now());
  assert.equal(result.status, 'fail');
  assert.equal(result.errorCount, 3);
  assert.equal(result.faults.length, 3);
  assert.equal(result.summaryLine, 'api: no node_modules');
});

test('executor: nested verify sections inside workspace packages are collected too', () => {
  const report = { status: 'fail', packages: [{ package: 'p', dir: 'pkg', status: 'fail', typecheck: { errors: [{ file: 'x.ts', message: 'm' }] }, tests: { failures: [{ name: 't', details: ['d'] }] } }] };
  assert.deepEqual(collectFaults(report).map((fault) => fault.file), ['pkg/x.ts', 't']);
});

test('executor: the job signal is installed as the request signal the audits kill their process tree on', async () => {
  const controller = new AbortController();
  let seen = null;
  const executor = createCheckExecutor({ test: async () => { seen = currentRequestSignal(); return { status: 'pass' }; } });
  await executor({ kind: 'test', cwd: '/repo' }, { signal: controller.signal });
  assert.equal(seen, controller.signal);
});
