import test from 'node:test';
import assert from 'node:assert/strict';
import { parseForgeArgs } from './patterns-forge-cli.js';
import { rejectedSummary } from '../forge/forge-report.js';
import { TOP_SURFACED } from '../forge/rank.js';

test('parseForgeArgs reads the Forge listing flags', () => {
  assert.deepEqual(parseForgeArgs(['--forge']), {
    targetDir: null, includeTests: false, includeIdioms: false, showRejected: false, explain: null,
    limit: TOP_SURFACED, path: null, kind: null, json: false
  });
  const options = parseForgeArgs(['cli', '--forge', '--rejected', '--explain=3f2a9c0d', '--limit=5', '--path=W', '--kind=window', '--include-tests', '--json']);
  assert.deepEqual(options, {
    targetDir: 'cli', includeTests: true, includeIdioms: false, showRejected: true, explain: '3f2a9c0d',
    limit: 5, path: 'W', kind: 'window', json: true
  });
  assert.equal(parseForgeArgs(['--forge', '--limit=0']).limit, TOP_SURFACED);
});

test('the rejected summary lists R1-R8 first, then refine and suppressed', () => {
  assert.equal(rejectedSummary({ refine: 2, R5: 3, R1: 4, suppressed: 1 }), 'rejected 10: R1 4, R5 3, refine 2, suppressed 1 (--rejected lists them)');
  assert.equal(rejectedSummary({}), 'rejected: none');
});
