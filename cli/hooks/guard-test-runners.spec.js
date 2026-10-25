// The guard nudges a raw `node tests/run-tests.mjs` toward `chemx test` (the job line, one file at a time)
// unless .chemxrc lists the runner under test.runners (task #6754).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decidePreTool, toPreToolOutput } from './claude-pre-tool.js';
import { withHarnessRepo } from '../fixtures/project-runner/harness-repo.js';

const contextAt = (dir, root = dir) => ({ cwd: dir, root, enforceSearch: true, hasChemxCommand: () => true, nudgePromotion: { all: false, ids: [] } });
const decide = (command, context) => decidePreTool({ tool_name: 'Bash', tool_input: { command } }, context);
const advice = (command, context) => toPreToolOutput(decide(command, context))?.hookSpecificOutput.additionalContext ?? null;
const rc = (dir, runners) => fs.writeFileSync(path.join(dir, '.chemxrc'), JSON.stringify({ test: { runners } }));

test('node tests/run-tests.mjs in a harness repo is allowed with a nudge toward chemx test', async () => {
  await withHarnessRepo(({ repo }) => {
    const result = decide('node tests/run-tests.mjs', contextAt(repo));
    assert.equal(result.decision, 'allow');
    assert.deepEqual(result.nudged, ['nudge-project-runner']);
    assert.match(advice('node tests/run-tests.mjs', contextAt(repo)), /chemx test/);
    assert.match(advice('node tests/run-tests.mjs', contextAt(repo)), /"runners"/);
  });
});

test('the nudge covers the other spellings of the same call', async () => {
  await withHarnessRepo(({ repo, plugins, tests }) => {
    assert.match(advice('node ./tests/run-tests.mjs', contextAt(repo)), /chemx test/);
    assert.match(advice(`node ${path.join(repo, 'tests', 'run-tests.mjs')}`, contextAt(plugins)), /chemx test/);
    assert.match(advice('cd tests && node run-tests.mjs', contextAt(repo)), /chemx test/);
    assert.match(advice('node run-tests.mjs', contextAt(tests, repo)), /chemx test/);
    assert.match(advice('cd my-plugin && node tests/run-tests.mjs', contextAt(plugins)), /chemx test/);
  });
});

test('test.runners in the repo .chemxrc lists the runner: no nudge', async () => {
  await withHarnessRepo(({ repo }) => {
    rc(repo, ['node tests/run-tests.mjs']);
    assert.equal(advice('node tests/run-tests.mjs', contextAt(repo)), null);
    assert.equal(advice('node ./tests/run-tests.mjs', contextAt(repo)), null);
    assert.equal(decide('node tests/run-tests.mjs', contextAt(repo)).nudged, undefined);
  });
});

test('test.runners in a .chemxrc above the repo lists it relative to that file', async () => {
  await withHarnessRepo(({ repo, plugins }) => {
    rc(plugins, ['node my-plugin/tests/run-tests.mjs']);
    const context = contextAt(plugins);
    assert.equal(advice('node my-plugin/tests/run-tests.mjs', context), null);
    assert.equal(advice('cd my-plugin && node tests/run-tests.mjs', context), null);
  });
});

test('a runner that is not listed still nudges when another one is', async () => {
  await withHarnessRepo(({ repo }) => {
    rc(repo, ['node scripts/other-runner.mjs']);
    assert.match(advice('node tests/run-tests.mjs', contextAt(repo)), /chemx test/);
  });
});

test('a run-tests.mjs that chemx test would not run, or a different script, is not nudged', async () => {
  await withHarnessRepo(({ repo }) => {
    assert.equal(advice('node tests/alpha.test.mjs', contextAt(repo)), null);
    assert.equal(advice('node tests/missing/run-tests.mjs', contextAt(repo)), null);
  });
  await withHarnessRepo(({ repo }) => {
    assert.equal(advice('node tests/run-tests.mjs', contextAt(repo)), null);
  }, { 'tests/run-tests.mjs': 'console.log("not a harness");\n' });
});

test('chemx test itself, and a bypass comment, stay quiet', async () => {
  await withHarnessRepo(({ repo }) => {
    assert.equal(advice('chemx test tests/alpha.test.mjs', contextAt(repo)), null);
    const bypassed = decide('node tests/run-tests.mjs # chemx-bypass: need the raw docker output', contextAt(repo));
    assert.deepEqual([bypassed.decision, bypassed.rule, bypassed.overrode], ['allow', 'nudge-project-runner', true]);
  });
});

test('guardNudges: block turns the nudge into a block with the same advice', async () => {
  await withHarnessRepo(({ repo }) => {
    const result = decide('node tests/run-tests.mjs', { ...contextAt(repo), nudgePromotion: { all: true, ids: [] } });
    assert.equal(result.decision, 'deny');
    assert.match(result.reason, /chemx test/);
  });
});

test('an unreadable .chemxrc means no allow-list, never a crash', async () => {
  await withHarnessRepo(({ repo }) => {
    fs.writeFileSync(path.join(repo, '.chemxrc'), '{ not json');
    assert.match(advice('node tests/run-tests.mjs', contextAt(repo)), /chemx test/);
  });
});

// K11 #6756: guard.allow is the general name of the list; test.runners keeps working as its alias.
test('guard.allow lists the runner too: no nudge, with the call as typed or a path-resolved spelling', async () => {
  await withHarnessRepo(({ repo }) => {
    fs.writeFileSync(path.join(repo, '.chemxrc'), JSON.stringify({ guard: { allow: ['node tests/run-tests.mjs'] } }));
    assert.equal(advice('node tests/run-tests.mjs', contextAt(repo)), null);
    assert.equal(advice('node ./tests/run-tests.mjs tests/alpha.test.mjs', contextAt(repo)), null);
    assert.equal(advice('cd tests && node run-tests.mjs', contextAt(repo)), null);
    assert.equal(decide('node tests/run-tests.mjs', contextAt(repo)).nudged, undefined);
  });
});

test('both lists apply together; an entry that names another script leaves the nudge in place', async () => {
  await withHarnessRepo(({ repo }) => {
    fs.writeFileSync(path.join(repo, '.chemxrc'), JSON.stringify({ guard: { allow: ['node scripts/other.mjs'] }, test: { runners: ['node tests/run-tests.mjs'] } }));
    assert.equal(advice('node tests/run-tests.mjs', contextAt(repo)), null);
  });
  await withHarnessRepo(({ repo }) => {
    fs.writeFileSync(path.join(repo, '.chemxrc'), JSON.stringify({ guard: { allow: ['node scripts/other.mjs'] } }));
    assert.match(advice('node tests/run-tests.mjs', contextAt(repo)), /chemx test/);
  });
});
