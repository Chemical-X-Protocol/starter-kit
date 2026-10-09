// `chemx test --changed --depth=N`: the inner-loop cut of an affected-spec selection.
// The full selection (test-select.js) follows imports all the way up, so a change to a module
// that the CLI router imports selects every spec that runs the CLI. --depth=N keeps only the specs
// at most N import hops from a changed file (0 = the spec itself or its colocated spec).
// What this guarantees: the kept specs are exactly the ones the full selection reached within
// N hops. What it does NOT guarantee: the specs beyond N hops, and the ones selected only
// because they load modules by a computed path, are not run. Run without --depth before merging.

const HOP_SEPARATOR = ' <- ';
const UNBOUNDED_PREFIX = 'may load any changed file';

// Import hops a selection reason records: 0 for changed/colocated/names, the number of `<-`
// links for a dependency chain, Infinity when the only evidence is a computed import.
export const reasonHops = (reason) => {
  const isUnbounded = reason.startsWith(UNBOUNDED_PREFIX);
  if (isUnbounded) return Number.POSITIVE_INFINITY;
  return reason.split(HOP_SEPARATOR).length - 1;
};

const specHops = (spec) => Math.min(...spec.reasons.map(reasonHops));

// Parses --depth. Returns a non-negative integer, or null when absent or not a number.
export const parseDepth = (value) => {
  const depth = Number(value);
  const isValid = value !== undefined && value !== null && Number.isInteger(depth) && depth >= 0;
  return isValid ? depth : null;
};

// Narrows a resolved scope { targets, selection, emptyDetail? } to the specs within `depth` hops.
// Scopes that are not an affected-spec selection (full runs, explicit targets) pass through.
export const limitDepth = (scope, depth) => {
  const isAffected = scope.selection?.mode === 'affected' && scope.targets.length > 0;
  const hasDepth = depth !== null && depth !== undefined;
  const applies = isAffected && hasDepth;
  if (!applies) return scope;
  const within = scope.selection.specs.filter((spec) => specHops(spec) <= depth);
  const beyond = scope.selection.specs.filter((spec) => specHops(spec) > depth).map((spec) => spec.path);
  const kept = new Set(within.map((spec) => spec.path));
  const targets = scope.targets.filter((target) => kept.has(target));
  const selection = { ...scope.selection, depth, beyondDepth: beyond };
  const emptyDetail = targets.length === 0 ? `no affected spec is within ${depth} import hop(s) of the change; ${beyond.length} deeper spec(s) were not run (drop --depth to run them)` : undefined;
  return { ...scope, targets, selection, ...(emptyDetail ? { emptyDetail } : {}) };
};
