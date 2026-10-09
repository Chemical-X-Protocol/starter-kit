import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCode } from '../audit/rules.js';

const STDIO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stdio.js');

// #1955: the parent-process watchdog interval must be cleared on shutdown, so
// the kit's own TIMER_DISCIPLINE ratchet stays at baseline.
test('the stdio parent watchdog interval is cleared on shutdown', () => {
  const rel = 'cli/mcp/stdio.js';
  const violations = auditCode(fs.readFileSync(STDIO, 'utf8'), rel, rel);
  const timers = violations.filter((v) => v.rule === 'TIMER_DISCIPLINE');
  assert.deepEqual(timers.map((v) => `${v.line}: ${v.hazard}`), []);
});
