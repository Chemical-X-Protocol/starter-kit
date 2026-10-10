// One shard of the large seeded fuzz run (slow lane, #4599). Each class derives its own seed from the run
// seed and its name (run.js classSeed), so running a class alone draws the same pairs as in a full run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runFuzz, formatFailure } from './run.js';

export const FUZZ_SEED = Number(process.env.CHEMX_FUZZ_SEED ?? 0x51ed);
export const FUZZ_PER_CLASS = Number(process.env.CHEMX_FUZZ_PER_CLASS ?? 300);

/** Registers the two large-run tests (inlining off, on) for `classes`. */
export const defineFuzzShard = (classes) => {
  for (const inline of [false, true]) {
    const mode = inline ? 'inlining on' : 'inlining off (default)';
    test(`large fuzz run (seed ${FUZZ_SEED}, ${FUZZ_PER_CLASS} per class), ${classes.join(', ')}, ${mode}`, () => {
      const report = runFuzz({ seed: FUZZ_SEED, perClass: FUZZ_PER_CLASS, inputs: 8, classes, inline });
      const failures = report.failures.map(formatFailure).join('\n\n');
      assert.equal(report.failures.length, 0, `${report.failures.length} unsound merge(s)\n\n${failures}`);
      assert.equal(report.crashes.length, 0, report.crashes.map((crash) => `${crash.cls}: ${crash.message}`).join('\n'));
    });
  }
};
