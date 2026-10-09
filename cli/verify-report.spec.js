import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTestStep, testStepIcon } from './verify-report.js';
import { formatTestHeadline } from './test-report.js';
import { stripAnsi } from './terminal.js';
import { STATUS } from './result-status.js';
import { SKIPPED } from './verify-steps.js';

const emptyAllowed = { status: STATUS.PASS, reason: 'EMPTY_ALLOWED', passed: 0, total: 0, totalTests: 0, failed: 0, skipped: 0, errors: 0, executionError: null };

test('verify-report: an empty run accepted by --allow-empty never reads "Passed (0/0)" or gets a green check', () => {
  assert.equal(formatTestStep(emptyAllowed), 'No tests ran (allowed by --allow-empty)');
  assert.equal(testStepIcon(emptyAllowed), SKIPPED);
  assert.equal(testStepIcon({ ...emptyAllowed, reason: null, passed: 3, total: 3 }), STATUS.PASS);
});

test('test-report: the allowed empty run headline has no green check', () => {
  const headline = stripAnsi(formatTestHeadline({ ...emptyAllowed, durationMs: 1 }));
  assert.ok(!headline.includes('✔'), headline);
  assert.match(headline, /No tests ran \(allowed by --allow-empty\)/);
});

test('test-report: a runner that failed to start says so instead of "0 failed out of 0"', () => {
  const report = { status: STATUS.FAIL, reason: null, exitCode: 1, failed: 0, errors: 0, totalTests: 0, executionError: 'Error: Build failed with 1 error:', failures: [{ kind: 'startup-error', name: 'Startup error', details: [] }] };
  const headline = stripAnsi(formatTestHeadline(report));
  assert.match(headline, /Test runner failed to start: Error: Build failed/);
});
