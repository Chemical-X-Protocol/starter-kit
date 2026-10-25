// A run without rg on PATH says how many ripgrep-engine specs it skipped (task #6772).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseTestOutput, RG_SKIP_REASON } from './test-output.js';
import { formatTestReport, describeRipgrepSkips } from './test-report.js';

const TAP = [
  'TAP version 13',
  'ok 1 - uses rg # SKIP ripgrep not on PATH; run with rg on PATH to cover the rg engine',
  'ok 2 - other # SKIP not this one',
  'ok 3 - parity # SKIP ripgrep not on PATH; the rg engine is not compared with the js one',
  'ok 4 - plain',
  '# tests 4', '# pass 2', '# fail 0', '# skipped 2'
].join('\n');

test('rg skips: TAP skip lines naming ripgrep are counted, other skips are not', () => {
  const result = parseTestOutput(TAP, '', 0);
  assert.equal(result.skippedRipgrep, 2);
  assert.equal(parseTestOutput('# tests 1\n# pass 1\n# fail 0\n', '', 0).skippedRipgrep, 0);
});

test('rg skips: the spec reporter\'s skip lines count too', () => {
  const spec = ['﹣ rg engine (0.2ms) # ripgrep not on PATH; run with rg', '✔ plain (1ms)', 'ℹ tests 2', 'ℹ pass 1', 'ℹ fail 0', 'ℹ skipped 1'].join('\n');
  assert.equal(parseTestOutput(spec, '', 0).skippedRipgrep, 1);
});

test('rg skips: the report says it in one line, only when there are some', () => {
  const report = { status: 'pass', passed: 2, skipped: 2, failures: [], command: 'node --test', skippedRipgrep: 2, durationMs: 5 };
  assert.match(formatTestReport(report), /ripgrep is not on PATH: 2 ripgrep-engine specs skipped, so the rg search engine went untested here/);
  assert.equal(describeRipgrepSkips(1), 'ripgrep is not on PATH: 1 ripgrep-engine spec skipped, so the rg search engine went untested here');
  assert.equal(describeRipgrepSkips(0), null);
  assert.doesNotMatch(formatTestReport({ ...report, skippedRipgrep: undefined }), /ripgrep/);
});

test('rg skips: every spec that skips without rg gives the reason the run summary counts', () => {
  const sites = ['search-literal.spec.js', 'search-literal-modes.spec.js', 'search-literal-dotdirs.spec.js'];
  for (const name of sites) {
    const text = fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
    const skips = text.split('\n').filter((line) => /skip:/.test(line) && /isRipgrepAvailable/.test(line));
    for (const line of skips) assert.ok(line.includes(RG_SKIP_REASON), `${name} skips without the reason "${RG_SKIP_REASON}": ${line.trim().slice(0, 120)}`);
  }
});
