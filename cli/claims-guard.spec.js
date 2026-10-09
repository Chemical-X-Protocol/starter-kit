import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatVerdict } from './verify-report.js';
import { stripAnsi } from './terminal.js';
import { STATUS } from './result-status.js';
import { UI_CLIENT_CERT_SCRIPT } from './ui-client-cert.js';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BANNED = [/zero context burn/i, /token-burn/i, /45 token/i, /milliseconds/i, /\binstantly\b/i];
const scanned = ['README.md', 'AGENTS.md', 'cli/verify-report.js', 'cli/ui-client-cert.js'];

const readKit = (rel) => fs.readFileSync(path.join(kitRoot, rel), 'utf8');

test('claims: the green verify card says exactly what the README sample says', () => {
  const card = stripAnsi(formatVerdict(STATUS.PASS, null)).trim();
  assert.equal(card, 'All verification checks passed.');
  assert.ok(readKit('README.md').includes(card), 'README sample must show the real card text');
});

test('claims: README, AGENTS and user-facing output contain no unbacked speed or token claims', () => {
  const hits = scanned.flatMap((rel) => {
    const lines = readKit(rel).split('\n');
    return lines.flatMap((line, i) => BANNED.filter((re) => re.test(line)).map((re) => `${rel}:${i + 1} ${re}`));
  });
  assert.deepEqual(hits, []);
});

test('claims: the savings certificate never invents a reduction figure', () => {
  assert.ok(!/\|\|\s*88/.test(UI_CLIENT_CERT_SCRIPT));
  assert.match(UI_CLIENT_CERT_SCRIPT, /not measured/);
});

test('claims: benchmark prose derives its counts from the results', () => {
  const src = readKit('benchmarks/run-benchmark.mjs');
  assert.ok(!/Across 3 Categories/.test(src));
  assert.ok(!/ten fixed targets/.test(src));
});
