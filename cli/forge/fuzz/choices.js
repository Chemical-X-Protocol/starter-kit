// Seeded choice stream for the canonicalization fuzzer (#2596). Every random decision a generator makes
// goes through `int(n)`, which records the value it returned. Replaying a recorded list regenerates the
// same pair, and a shrinker edits the list (a smaller value is always the simpler option) to find a
// minimal repro. Past the end of a replayed list every choice is 0, the simplest option.

/** mulberry32: small, fast, and identical on every platform for a given 32-bit seed. */
export const createRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * A choice stream. seed drives fresh choices; replay (an array) is consumed first when given.
 * Returns { int, pick, chance, recorded } where recorded() is the list of values returned so far.
 */
export const createChoices = ({ seed = 1, replay = null } = {}) => {
  const random = createRandom(seed);
  const recorded = [];
  const isReplay = Array.isArray(replay);
  const int = (n) => {
    const bound = Math.max(1, n);
    const index = recorded.length;
    const fresh = () => Math.floor(random() * bound);
    const replayed = isReplay ? (replay[index] ?? 0) : null;
    const value = isReplay ? Math.min(replayed, bound - 1) : fresh();
    recorded.push(value);
    return value;
  };
  const pick = (items) => items[int(items.length)];
  const chance = (oneIn) => int(oneIn) === 0;
  return { int, pick, chance, recorded: () => [...recorded] };
};

/** Seed of pair `index` in a run seeded with `seed` (independent streams per pair). */
export const pairSeed = (seed, index) => (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(index + 1, 0xc2b2ae35)) >>> 0;
