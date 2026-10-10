// One shard of the large seeded fuzz run (slow lane, #4599). Each class derives its own seed from the run
// seed and its name (run.js classSeed), so running a class alone draws the same pairs as in a full run.
//
// The fuzz itself runs in a child process (#5918). The sandbox cuts off a slow evaluation with a vm
// timeout while microtasks are draining; under load that cut-off can leave node's async-hook stack
// unbalanced, and node:test then aborts its own file process ("async hook stack has become corrupted",
// exit 1 with every subtest passed). A plain child process has no test-runner async scope to check, so
// a cut-off there should not take the test file down. Not guaranteed: a child that still dies is
// reported by the test with its exit status and stderr.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runFuzz, formatFailure } from './run.js';

export const FUZZ_SEED = Number(process.env.CHEMX_FUZZ_SEED ?? 0x51ed);
export const FUZZ_PER_CLASS = Number(process.env.CHEMX_FUZZ_PER_CLASS ?? 300);
// No per-test timeout: node:test's default is already unlimited, and a synchronous run cannot be
// interrupted by one.

const SELF = fileURLToPath(import.meta.url);
const RESULT_MARK = 'CHEMX_FUZZ_SHARD_RESULT ';

/** Child-side: runs the fuzz and prints one marked JSON line (failures already formatted as text). */
const runInChild = (request) => {
  const report = runFuzz(request);
  const result = {
    pid: process.pid,
    failures: report.failures.map(formatFailure),
    crashes: report.crashes.map((crash) => `${crash.cls}: ${crash.message}`),
  };
  process.stdout.write(`${RESULT_MARK}${JSON.stringify(result)}\n`);
};

/** Runs the fuzz for `request` in a child process; returns { pid, failures, crashes } or throws with the child's stderr. */
export const runFuzzIsolated = (request) => {
  const child = spawnSync(process.execPath, [SELF, JSON.stringify(request)], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const line = String(child.stdout ?? '').split('\n').find((text) => text.startsWith(RESULT_MARK));
  const didFinish = child.status === 0 && Boolean(line);
  if (!didFinish) {
    const detail = `exit ${child.status}, signal ${child.signal ?? 'none'}${child.error ? `, ${child.error.message}` : ''}`;
    throw new Error(`fuzz child did not finish (${detail})\n${String(child.stderr ?? '').slice(-4000)}`);
  }
  return JSON.parse(line.slice(RESULT_MARK.length));
};

/** Registers the two large-run tests (inlining off, on) for `classes`. */
export const defineFuzzShard = (classes) => {
  for (const inline of [false, true]) {
    const mode = inline ? 'inlining on' : 'inlining off (default)';
    test(`large fuzz run (seed ${FUZZ_SEED}, ${FUZZ_PER_CLASS} per class), ${classes.join(', ')}, ${mode}`, () => {
      const result = runFuzzIsolated({ seed: FUZZ_SEED, perClass: FUZZ_PER_CLASS, inputs: 8, classes, inline });
      assert.equal(result.failures.length, 0, `${result.failures.length} unsound merge(s)\n\n${result.failures.join('\n\n')}`);
      assert.equal(result.crashes.length, 0, result.crashes.join('\n'));
    });
  }
};

const isChildEntry = process.argv[1] === SELF;
if (isChildEntry) runInChild(JSON.parse(process.argv[2]));
