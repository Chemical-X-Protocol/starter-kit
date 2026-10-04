import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCode } from './rules.js';

const fired = (code, file = 'src/thing.js') =>
  auditCode(code, file, file).some((v) => v.rule === 'AI_SLOP_LAZY_PLACEHOLDER');

test('slop: real truncation placeholder in a comment still fires', () => {
  assert.equal(fired('function a() {\n  // ... rest of code\n}\n'), true);
});

test('slop: trailing truncation comment after code still fires', () => {
  assert.equal(fired('doThing();  // ... remaining implementation\n'), true);
});

test('slop: placeholder text inside a double-quoted string does not fire', () => {
  const code = 'const copy = "Blocks lazy \'// ...rest of code\' truncation placeholders";\n';
  assert.equal(fired(code), false, 'marketing copy describing the pattern must not be flagged');
});

test('slop: placeholder text inside a single-quoted string does not fire', () => {
  const code = "const copy = 'we detect // ... existing code markers';\n";
  assert.equal(fired(code), false);
});

test('slop: placeholder inside a template literal does not fire', () => {
  const code = 'const copy = `catches // ... remaining logic in your diff`;\n';
  assert.equal(fired(code), false);
});

test('slop: string-literal guard applies to non-JS languages too', () => {
  const py = 'DESCRIPTION = "flags // ... rest of code placeholders"\n';
  assert.equal(fired(py, 'services/detect.py'), false);
});
