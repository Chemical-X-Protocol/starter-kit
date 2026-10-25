import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkFilePayload, formatCheckText } from './check-report.js';
import { stripAnsi } from './terminal.js';

const DISPATCH_SWITCH = "export const pick = (kind) => {\n  switch (kind) {\n    case 'a': return 1;\n    case 'b': return 2;\n    case 'c': return 3;\n    default: return 0;\n  }\n};\n";

const withFile = (name, content, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chemx-check-report-'));
  try {
    fs.writeFileSync(path.join(dir, name), content);
    return fn(path.join(dir, name));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('check-report: a clean file is one Crystalline line', () => {
  withFile('ok.js', 'export const one = 1;\n', (abs) => {
    const payload = checkFilePayload(abs, 'ok.js');
    assert.equal(payload.isClean, true);
    assert.equal(payload.violationsCount, 0);
    assert.match(stripAnsi(formatCheckText(payload)), /^\n✔ Crystalline: ok\.js \(0 hazards, \d+ms\)\n\n$/);
  });
});

test('check-report: a hazard prints the header, the counts, the line, the hazard and the directive', () => {
  withFile('bad.js', DISPATCH_SWITCH, (abs) => {
    const payload = checkFilePayload(abs, 'bad.js');
    assert.equal(payload.isClean, false);
    assert.equal(payload.highMedCount, 1);
    const text = stripAnsi(formatCheckText(payload));
    assert.match(text, /^\nChemical X Micro-Check: bad\.js \(\d+ms\)\n/);
    assert.match(text, /\n  💥 0 Critical \| 🔥 1 High\/Med\n\n/);
    assert.match(text, /\n  \[MEDIUM\] Line 2: CONTROL_FLOW_DISPATCH_SWITCH\n    Hazard: .+\n    Directive: .+\n\n$/);
  });
});

test('check-report: an inconclusive file says so and is never Crystalline', () => {
  const payload = { file: 'a.php', isClean: false, inconclusive: 'parser-unavailable', durationMs: 3, violationsCount: 0, criticalCount: 0, highMedCount: 0, violations: [] };
  const text = stripAnsi(formatCheckText(payload));
  assert.match(text, /inconclusive: parser-unavailable \(the AST rules did not run; a clean result is not claimed\)/);
  assert.doesNotMatch(text, /Crystalline/);
});
