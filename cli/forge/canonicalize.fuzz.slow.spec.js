// Differential fuzzing of Forge canonicalization, large seeded run (slow lane, #2596). Same checks as
// canonicalize.fuzz.spec.js with more pairs per class and more inputs per pair, in both inlining modes.
// CHEMX_FUZZ_SEED and CHEMX_FUZZ_PER_CLASS override the seed (default 0x51ed) and the pair count per
// class (default 300); a failure prints the seed and the recorded choices that replay it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runFuzz, formatFailure } from './fuzz/run.js';

const seed = Number(process.env.CHEMX_FUZZ_SEED ?? 0x51ed);
const perClass = Number(process.env.CHEMX_FUZZ_PER_CLASS ?? 300);

for (const inline of [false, true]) {
  const mode = inline ? 'inlining on' : 'inlining off (default)';
  test(`large fuzz run (seed ${seed}, ${perClass} per class), ${mode}`, () => {
    const report = runFuzz({ seed, perClass, inputs: 8, inline });
    const failures = report.failures.map(formatFailure).join('\n\n');
    assert.equal(report.failures.length, 0, `${report.failures.length} unsound merge(s)\n\n${failures}`);
    assert.equal(report.crashes.length, 0, report.crashes.map((crash) => `${crash.cls}: ${crash.message}`).join('\n'));
  });
}
