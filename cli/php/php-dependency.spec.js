import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('php-parser resolves at the pinned version', () => {
  assert.ok(require.resolve('php-parser'));
  assert.equal(require('php-parser/package.json').version, '3.7.0');
});

test('php-parser parses a trivial program', () => {
  const { Engine } = require('php-parser');
  const engine = new Engine({
    parser: { extractDoc: true, suppressErrors: false, version: '8.3' },
    ast: { withPositions: true },
  });
  assert.equal(engine.parseCode('<?php echo 1;', 'x.php').kind, 'program');
});
