import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTestOutput, REASONS } from './test-output.js';
import { STATUS } from './result-status.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'runner-output');
const fixture = (name) => fs.readFileSync(path.join(fixtureDir, name), 'utf8');

test('test-output: node spec reporter keeps the diff lines of a deepEqual failure listed twice', () => {
  const out = [
    '✖ my deep test (3ms)',
    'ℹ tests 1',
    'ℹ pass 0',
    'ℹ fail 1',
    '',
    '✖ failing tests:',
    '',
    'test at a.spec.js:1:1',
    '✖ my deep test (3ms)',
    '  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:',
    '  + actual - expected',
    '  ',
    '  + [',
    "  +   'offender'",
    '  + ]',
    '  - []'
  ].join('\n');
  const [failure] = parseTestOutput(out, '', 1).failures;
  assert.ok(failure.name.startsWith('my deep test'));
  assert.ok(failure.details.some((l) => l.includes("'offender'")));
});

test('test-output: vitest failure keeps the test name, assertion message and location (real ANSI output)', () => {
  const parsed = parseTestOutput(fixture('vt-fail.txt'), '', 1);
  assert.equal(parsed.status, STATUS.FAIL);
  assert.equal(parsed.failed, 1);
  assert.equal(parsed.passed, 2);
  assert.equal(parsed.totalTests, 3);
  assert.equal(parsed.failures.length, 1);
  const [failure] = parsed.failures;
  assert.equal(failure.name, 'tests/a.spec.ts > math > breaks');
  assert.match(failure.message, /^AssertionError: expected 4 to be 5/);
  assert.equal(failure.location, 'tests/a.spec.ts:4:38');
  assert.equal(failure.details[0], failure.message, 'the message is the first detail line shown');
});

test('test-output: vitest "No test files found" is inconclusive NO_TESTS_RAN, not a failure or a pass', () => {
  const parsed = parseTestOutput(fixture('vt-nofiles.txt'), '', 1);
  assert.equal(parsed.status, STATUS.INCONCLUSIVE);
  assert.equal(parsed.reason, REASONS.NO_TESTS_RAN);
  assert.equal(parsed.success, false);
  assert.equal(parsed.failures.length, 0);
});

test('test-output: a filter that skips every test is inconclusive even though the runner exits 0', () => {
  const parsed = parseTestOutput(fixture('vt-skipped.txt'), '', 0);
  assert.equal(parsed.status, STATUS.INCONCLUSIVE);
  assert.equal(parsed.reason, REASONS.NO_TESTS_RAN);
  assert.equal(parsed.skipped, 2);
  assert.equal(parsed.passed, 0);
});

test('test-output: --allow-empty turns an empty run into a pass with a distinct reason', () => {
  const parsed = parseTestOutput(fixture('vt-skipped.txt'), '', 0, { allowEmpty: true });
  assert.equal(parsed.status, STATUS.PASS);
  assert.equal(parsed.reason, REASONS.EMPTY_ALLOWED);
});

test('test-output: node --test reporting "# tests 0" is inconclusive, never "Passed (0/0)"', () => {
  const parsed = parseTestOutput('TAP version 13\n1..0\n# tests 0\n# suites 0\n# pass 0\n# fail 0\n', '', 0);
  assert.equal(parsed.status, STATUS.INCONCLUSIVE);
  assert.equal(parsed.reason, REASONS.NO_TESTS_RAN);
});

test('test-output: node --test name pattern that matches nothing is not counted as one passing test', () => {
  const parsed = parseTestOutput(fixture('nt-pattern-empty.txt'), '', 0);
  assert.equal(parsed.passed, 0);
  assert.equal(parsed.status, STATUS.INCONCLUSIVE);
});

test('test-output: node --test TAP failure reports the assertion message, not YAML keys', () => {
  const parsed = parseTestOutput(fixture('nt-fail.txt'), '', 1);
  assert.equal(parsed.status, STATUS.FAIL);
  assert.equal(parsed.failures.length, 1);
  const [failure] = parsed.failures;
  assert.equal(failure.name, 'breaks');
  assert.equal(failure.message, 'math is broken');
  assert.match(failure.location, /src\/a\.spec\.js:4:1$/);
  assert.ok(!failure.details.some((d) => /duration_ms|failureType/.test(d)));
});

test('test-output: vitest unhandled errors fail the run with the error message and origin, one consistent headline count', () => {
  const parsed = parseTestOutput(fixture('vt-unhandled.txt'), '', 1);
  assert.equal(parsed.status, STATUS.FAIL);
  assert.equal(parsed.failed, 0);
  assert.equal(parsed.errors, 1);
  const [failure] = parsed.failures;
  assert.equal(failure.kind, 'unhandled-error');
  assert.equal(failure.message, 'TypeError: boom from timer');
  assert.match(failure.name, /tests\/u\.spec\.ts/);
});

test('test-output: a fatal crash surfaces as executionError instead of a fake test failure', () => {
  const stderr = '<--- Last few GCs --->\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n 1: 0xb8 node::Abort() [node]\n 2: 0xc1 v8::Utils::ReportOOMFailure [node]\n';
  const parsed = parseTestOutput('', stderr, 134);
  assert.equal(parsed.status, STATUS.FAIL);
  assert.match(parsed.executionError, /FATAL ERROR: Reached heap limit/);
  assert.equal(parsed.failures.length, 0);
});

test('test-output: a command that exits 1 without running tests is an execution error, not "0 failed"', () => {
  const parsed = parseTestOutput('', 'Error: Cannot find module \'/x/setup.js\'\n', 1);
  assert.notEqual(parsed.status, STATUS.PASS);
  assert.equal(parsed.failures.length, 0);
});

test('test-output: a timed-out run is inconclusive STEP_TIMEOUT whatever was printed', () => {
  const parsed = parseTestOutput('ℹ tests 3\nℹ pass 3\n', '', null, { timedOut: true, timeoutMs: 500 });
  assert.equal(parsed.status, STATUS.INCONCLUSIVE);
  assert.equal(parsed.reason, REASONS.STEP_TIMEOUT);
});

test('test-output: jest failures use the bullet test name, not the per-file FAIL header', () => {
  const jestOutput = [
    'FAIL src/sum.test.js',
    '  math',
    '    ✕ breaks (3 ms)',
    '',
    '  ● math › breaks',
    '',
    '    expect(received).toBe(expected) // Object.is equality',
    '',
    '    Expected: 5',
    '    Received: 4',
    '',
    '      at Object.toBe (src/sum.test.js:4:20)',
    '',
    'Tests:       1 failed, 1 passed, 2 total'
  ].join('\n');
  const parsed = parseTestOutput(jestOutput, '', 1);
  assert.equal(parsed.failures[0].name, 'math › breaks');
  assert.match(parsed.failures[0].location, /src\/sum\.test\.js:4:20/);
  assert.equal(parsed.totalTests, 2);
});

test('test-output: a passing test whose name mentions "No test files found" does not make the run empty', () => {
  const output = '# Subtest: reports No test files found as inconclusive\nok 1 - reports No test files found as inconclusive\n# tests 1\n# pass 1\n# fail 0\n';
  const parsed = parseTestOutput(output, '', 0);
  assert.equal(parsed.status, STATUS.PASS);
});

test('test-output: a vitest startup error (broken config) fails with the error, never an empty run', () => {
  const parsed = parseTestOutput('', fixture('vt-startup-error.txt'), 1);
  assert.equal(parsed.status, STATUS.FAIL);
  assert.equal(parsed.reason, null);
  const messages = parsed.failures.map((f) => f.message).join('\n');
  assert.match(messages, /Error: Build failed with 1 error/);
  assert.match(messages, /Unexpected "}"/, 'the esbuild ✘ [ERROR] line is reported');
  assert.ok(parsed.failures.some((f) => f.location === 'vitest.config.mjs:1:427'));
});

test('test-output: --allow-empty never turns a crashed runner into a pass', () => {
  const crashed = parseTestOutput('', fixture('vt-startup-error.txt'), 1, { allowEmpty: true });
  assert.equal(crashed.status, STATUS.FAIL);
  const missingBinary = parseTestOutput('', 'sh: 1: nonexistent-runner-xyz: not found\n', 127, { allowEmpty: true });
  assert.equal(missingBinary.status, STATUS.FAIL);
  assert.match(missingBinary.executionError, /nonexistent-runner-xyz: not found/);
});

test('test-output: a non-zero exit with no tests and no "no tests" line is a FAIL with the first error line', () => {
  const parsed = parseTestOutput('', 'Error: Cannot find module \'/x/setup.js\'\n    at foo (bar.js:1:1)\n', 1);
  assert.equal(parsed.status, STATUS.FAIL);
  assert.equal(parsed.executionError, 'Error: Cannot find module \'/x/setup.js\'');
});

test('test-output: the runner\'s own "No test files found" exit 1 is still the empty run --allow-empty accepts', () => {
  const parsed = parseTestOutput(fixture('vt-nofiles.txt'), '', 1, { allowEmpty: true });
  assert.equal(parsed.status, STATUS.PASS);
  assert.equal(parsed.reason, REASONS.EMPTY_ALLOWED);
});

test('test-output: vitest separator lines with a [n/m] counter are not failure details', () => {
  const output = [
    ' FAIL  tests/c.spec.ts [ tests/c.spec.ts ]',
    'Error: import boom',
    ' ❯ tests/c.spec.ts:1:7',
    '',
    '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯',
    '',
    ' Test Files  1 failed (1)',
    '      Tests  no tests'
  ].join('\n');
  const parsed = parseTestOutput(output, '', 1);
  assert.equal(parsed.status, STATUS.FAIL);
  assert.equal(parsed.failures[0].message, 'Error: import boom');
  assert.ok(!parsed.failures[0].details.some((d) => /⎯/.test(d)), parsed.failures[0].details.join(' | '));
});

test('test-output: a missing test script is a failure, not an empty run, when specific tests were asked for', () => {
  const stderr = 'npm error Missing script: "test"\nnpm error\nnpm error To see a list of scripts, run:\nnpm error   npm run';
  const scoped = parseTestOutput('', stderr, 1, { scoped: true });
  assert.equal(scoped.status, 'fail');
  assert.match(scoped.executionError, /Missing script/);
  assert.equal(parseTestOutput('', stderr, 1, { scoped: true, allowEmpty: true }).status, 'fail', '--allow-empty never hides it');
  const placeholder = parseTestOutput('Error: no test specified', '', 1, { scoped: true, allowEmpty: true });
  assert.equal(placeholder.status, 'fail');
  assert.equal(parseTestOutput('', stderr, 1, {}).status, 'inconclusive', 'an unscoped project with no test script ran nothing');
});
