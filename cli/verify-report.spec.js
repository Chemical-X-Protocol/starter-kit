import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTestStep, testStepIcon, formatVerdict, createProgress } from './verify-report.js';
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

test('verify-report: a pass that ran no tests (--allow-empty) never gets the all-checks-passed headline', () => {
  const verdict = stripAnsi(formatVerdict(STATUS.PASS, null, { testsRanNothing: true }));
  assert.ok(!verdict.includes('All verification checks passed'), verdict);
  assert.match(verdict, /no tests ran/i);
  assert.match(stripAnsi(formatVerdict(STATUS.PASS, null)), /All verification checks passed/);
});

const captureStdout = (fn) => {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => chunks.push(String(chunk));
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
};

test('verify-report: on a pipe, a step announced before a blocking call prints a lasting running line', () => {
  const output = captureStdout(() => {
    const progress = createProgress(true);
    progress.start('AST Architecture', { announceOnPipe: true });
    progress.finish('  done\n');
    progress.start('TypeScript');
  });
  assert.equal(stripAnsi(output), '  … AST Architecture:  running\n  done\n');
});
