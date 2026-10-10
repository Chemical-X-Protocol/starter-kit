// Shard 1 of 8 of the large seeded fuzz run (slow lane, #4599); canonicalize.fuzz.slow.spec.js fails
// if the shards stop covering every class exactly once.
import { defineFuzzShard } from './fuzz/slow-shard.js';

defineFuzzShard(['seeds', 'class-members', 'var']);
