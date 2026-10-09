import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePatternsArgs, unknownPatternsFlags, runPatternsCli } from './patterns-cli.js';
import { findUnknownFlag } from '../commands/unknown-flags.js';
import { findCommandSchema, ROUTABLE_COMMAND_TOKENS } from '../commands-schema.js';

test('parsePatternsArgs maps argv onto the MCP handler params', () => {
  assert.deepEqual(parsePatternsArgs([]), { compact: true });
  assert.deepEqual(parsePatternsArgs(['src', '--type=CLONE', '--min=3', '--full']), { dir: 'src', type: 'CLONE', minOccurrences: 3, compact: false });
});

test('patterns is a routable command with a schema entry', () => {
  assert.ok(ROUTABLE_COMMAND_TOKENS.includes('patterns'));
  assert.equal(findCommandSchema('patterns').name, 'patterns');
});

test('unknownPatternsFlags names flags the command does not read', () => {
  assert.deepEqual(unknownPatternsFlags(['--forge', '--limit=20', '--json']), []);
  assert.deepEqual(unknownPatternsFlags(['--score=x', '--no-library']), ['--no-library']);
});

test('the router flag guard accepts every flag the handler reads for --forge', () => {
  const args = ['patterns', '--forge', '--limit=2', '--json', '--rejected', '--explain=x', '--include-tests', '--idioms', '--path=a', '--kind=b'];
  assert.equal(findUnknownFlag('patterns', args), null);
  assert.match(findUnknownFlag('patterns', ['patterns', '--forge', '--no-library']) ?? '', /--no-library/);
});

test('--forge --limit=2 --json prints 2 groups', () => {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  try { runPatternsCli(['--forge', '--limit=2', '--json']); } finally { process.stdout.write = original; }
  const out = JSON.parse(chunks.join(''));
  const groups = out.groups ?? out;
  assert.equal(groups.length, 2);
});
