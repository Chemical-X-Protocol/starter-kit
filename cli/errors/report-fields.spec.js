/**
 * Every field the issue body prints goes through the sanitizer, and a secret-named key
 * masks everything beneath it, not only a primitive directly under it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueBody } from './formatter.js';
import { sanitizeValue } from './sanitizer.js';

const KEY = 'CX-WXYZ-1234-5678';

test('git branch and commit are sanitized in the issue body', () => {
  const body = buildIssueBody({ message: 'boom', gitBranch: `feat/${KEY}`, gitCommit: 'abc1234 by dev@example.com' });
  assert.doesNotMatch(body, /CX-WXYZ/);
  assert.doesNotMatch(body, /dev@example\.com/);
  assert.match(body, /\*\*Git Branch\*\* \| `feat\/\[REDACTED_LICENSE\]`/);
});

test('a non-CX license value nested under a secret-named key is masked', () => {
  const out = sanitizeValue({ nested: { license: { key: 'abcdefgh-not-cx', seats: 3, active: true } } });
  assert.deepEqual(out, { nested: { license: { key: '[REDACTED_SECRET]', seats: '[REDACTED_SECRET]', active: true } } });
});

test('arrays under a secret-named key are masked element by element', () => {
  assert.deepEqual(sanitizeValue({ tokens: ['plain-value-1', 'plain-value-2'] }), { tokens: ['[REDACTED_SECRET]', '[REDACTED_SECRET]'] });
});

test('non-secret context is left readable', () => {
  assert.deepEqual(sanitizeValue({ file: 'src/a.js', count: 2, nested: { ok: true } }), { file: 'src/a.js', count: 2, nested: { ok: true } });
});
