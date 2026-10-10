// Differential fuzzing of Forge canonicalization, large seeded run (slow lane, #2596). Same checks as
// canonicalize.fuzz.spec.js with more pairs per class and more inputs per pair, in both inlining modes.
// The run is sharded by class (#4599) into canonicalize.fuzz.shard-<n>.slow.spec.js so the shards run in
// parallel; each class draws the same pairs alone as in a full run. CHEMX_FUZZ_SEED and
// CHEMX_FUZZ_PER_CLASS override the seed (default 0x51ed) and the pair count per class (default 300); a
// failure prints the seed and the recorded choices that replay it. This file checks the sharding only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSES } from './fuzz/classes.js';

const here = dirname(fileURLToPath(import.meta.url));

const shardClasses = () => readdirSync(here)
  .filter((file) => /^canonicalize\.fuzz\.shard-\d+\.slow\.spec\.js$/.test(file))
  .flatMap((file) => {
    const match = readFileSync(join(here, file), 'utf8').match(/defineFuzzShard\((\[[^\]]*\])\)/);
    assert.ok(match, `${file} calls defineFuzzShard with a class list`);
    return JSON.parse(match[1].replaceAll("'", '"'));
  });

test('the fuzz shards cover every class exactly once', () => {
  const listed = shardClasses();
  assert.deepEqual([...listed].sort(), CLASSES.map((cls) => cls.name).sort());
});
