// Forge fingerprint hashing primitive: murmur3-32 over UTF-16 code units (two units per 32-bit block),
// and a 64-bit digest made of two independent lanes, printed as 16 lowercase hex characters.
// Pure and deterministic: no clocks, no randomness, no host-dependent byte order.

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;
const SEED_A = 0x9747b28c;
const SEED_B = 0x5bd1e995;

const rotl = (value, bits) => (value << bits) | (value >>> (32 - bits));

const scramble = (block) => Math.imul(rotl(Math.imul(block, C1), 15), C2);

const finalize = (hash, byteLength) => {
  let h = hash ^ byteLength;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};

/** murmur3-32 of a string, reading each UTF-16 code unit as two bytes. Returns an unsigned 32-bit int. */
export const murmur3 = (text, seed = 0) => {
  let h = seed >>> 0;
  const blockCount = text.length >> 1;
  for (let i = 0; i < blockCount; i += 1) {
    const low = text.charCodeAt(2 * i) & 0xffff;
    const high = text.charCodeAt(2 * i + 1) & 0xffff;
    h ^= scramble(low | (high << 16));
    h = (Math.imul(rotl(h, 13), 5) + 0xe6546b64) | 0;
  }
  const hasOddUnit = (text.length & 1) === 1;
  if (hasOddUnit) h ^= scramble(text.charCodeAt(text.length - 1) & 0xffff);
  return finalize(h, text.length * 2);
};

const step = (h, value) => (Math.imul(rotl(h ^ scramble(value | 0), 13), 5) + 0xe6546b64) | 0;

/** murmur3-32 over `head` then a list of 32-bit integers (one block each): mixes Merkle child digests. */
export const murmur3Ints = (head, ints, seed) => {
  let h = step(seed >>> 0, head);
  for (let i = 0; i < ints.length; i += 1) h = step(h, ints[i]);
  return finalize(h, (ints.length + 1) * 4);
};

// Byte-to-hex table: same output as value.toString(16).padStart(8, '0'), at about a third of the cost
// (each unit prints 6 to 8 of these).
const HEX_BYTES = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));
const toHex8 = (value) => HEX_BYTES[value >>> 24] + HEX_BYTES[(value >>> 16) & 0xff] + HEX_BYTES[(value >>> 8) & 0xff] + HEX_BYTES[value & 0xff];

/** Two murmur3-32 lanes with fixed seeds: a 16-hex-character digest. */
export const hash64 = (text) => toHex8(murmur3(text, SEED_A)) + toHex8(murmur3(text, SEED_B));

/** A two-lane digest [laneA, laneB] of a string. */
export const hashPair = (text) => [murmur3(text, SEED_A), murmur3(text, SEED_B)];

/**
 * hashPair(`${type}|${label}`), memoized per (type, label) without building the joined string:
 * node labels repeat a lot. The memo only ever returns what hashPair would compute.
 */
const LABEL_CACHE_LIMIT = 65536;
const labelCache = new Map();
let labelCacheSize = 0;
export const hashLabelPair = (type, label) => {
  const cached = labelCache.get(type)?.get(label);
  if (cached) return cached;
  const isFull = labelCacheSize >= LABEL_CACHE_LIMIT;
  if (isFull) labelCache.clear();
  labelCacheSize = isFull ? 1 : labelCacheSize + 1;
  const byLabel = labelCache.get(type) ?? new Map();
  labelCache.set(type, byLabel);
  const pair = hashPair(`${type}|${label}`);
  byLabel.set(label, pair);
  return pair;
};

/** Mixes a label pair with child digests (flat [a0, b0, a1, b1, ...]) into a new [laneA, laneB]. */
export const mixPair = (labelPair, childInts) => [
  murmur3Ints(labelPair[0], childInts, SEED_A),
  murmur3Ints(labelPair[1], childInts, SEED_B)
];

/** 16-hex-character form of a [laneA, laneB] digest. */
export const pairHex = (pair) => toHex8(pair[0]) + toHex8(pair[1]);
