// Which worker lane a `chemx test` takes is decided by what the caller asked for, not by the targets
// test lanes or a custom command end up with: a run that names nothing is the suite (heavy, a ticket),
// a run that names a spec is light, in a project with test-lanes.json too.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTestAudit } from './test-audit.js';
import { SLOT_OWNER_ENV } from './test-slots.js';
import { STATUS } from './result-status.js';
import { ENV } from './job-line-spec-helpers.js';

// Each spec records the tickets in the slot dir while it runs.
const PROBE_SPEC = `import fs from 'node:fs';
import test from 'node:test';
test('probe', () => {
  const tickets = fs.readdirSync(process.env.CHEMX_TEST_SLOTS_DIR).filter((name) => name.startsWith('ticket-'));
  fs.appendFileSync(process.env.PROBE_LOG, JSON.stringify(tickets) + '\\n');
});
`;

// A node --test project with a lanes manifest (every spec in the fast lane) and its own slot dir.
const withLanesProject = (body) => async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-lanes-line-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'p', type: 'module', scripts: { test: 'node --test spec/*.spec.js' } }));
    fs.writeFileSync(path.join(root, 'test-lanes.json'), JSON.stringify({ slow: [], excluded: [] }));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.mkdirSync(path.join(root, 'spec'));
    for (const name of ['a', 'b']) fs.writeFileSync(path.join(root, `spec/${name}.spec.js`), PROBE_SPEC);
    const log = path.join(root, 'probe.log');
    const { [SLOT_OWNER_ENV]: _owner, NODE_TEST_CONTEXT: _context, ...parentEnv } = process.env;
    const env = { ...parentEnv, ...ENV, CHEMX_TEST_SLOTS_DIR: path.join(root, 'slots'), PROBE_LOG: log };
    const seen = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const run = async (args, extra = {}) => {
      fs.rmSync(log, { force: true });
      const report = await runTestAudit(['--json', ...args], false, { cwd: root, print: false, env, onWait: () => {}, ...extra });
      assert.equal(report.status, STATUS.PASS, report.executionError || report.detail);
      return report;
    };
    await body({ run, seen });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('wiring lanes: with test-lanes.json, chemx test naming nothing takes a tests ticket; a named spec stays light', { timeout: 60000 }, withLanesProject(async ({ run, seen }) => {
  const suite = await run([]);
  assert.match(suite.command, /spec\/a\.spec\.js spec\/b\.spec\.js/, 'the lane widened the scope to its specs');
  assert.deepEqual(seen(), [['ticket-1'], ['ticket-1']], 'both specs ran inside the heavy ticket');
  assert.equal(suite.workers, 4, 'the heavy worker count');
  const named = await run(['spec/a.spec.js']);
  assert.deepEqual(seen(), [[]], 'a named spec takes no ticket');
  assert.equal(named.workers, 1);
}));

test('wiring lanes: a custom command with a named target (the MCP chemx_test form) stays light', { timeout: 60000 }, withLanesProject(async ({ run, seen }) => {
  await run([], { command: 'node --test', target: 'spec/a.spec.js' });
  assert.deepEqual(seen(), [[]], 'no ticket for a named target under a custom command');
  await run(['spec/b.spec.js', '--', 'node --test']);
  assert.deepEqual(seen(), [[]], 'nor for the CLI form `chemx test <spec> -- <cmd>`');
}));
