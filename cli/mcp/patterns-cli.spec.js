import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePatternsArgs } from './patterns-cli.js';
import { findCommandSchema, ROUTABLE_COMMAND_TOKENS } from '../commands-schema.js';

test('parsePatternsArgs maps argv onto the MCP handler params', () => {
  assert.deepEqual(parsePatternsArgs([]), { compact: true });
  assert.deepEqual(parsePatternsArgs(['src', '--type=CLONE', '--min=3', '--full']), { dir: 'src', type: 'CLONE', minOccurrences: 3, compact: false });
});

test('patterns is a routable command with a schema entry', () => {
  assert.ok(ROUTABLE_COMMAND_TOKENS.includes('patterns'));
  assert.equal(findCommandSchema('patterns').name, 'patterns');
});
