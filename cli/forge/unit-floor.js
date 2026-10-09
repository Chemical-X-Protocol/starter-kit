// Which collected units the ledger stores (design doc, BUDGETS: pattern_units <= 40k rows on the kit).
// The floor drops only rows no grouping path can use, so it is lossless for N1, N2, N3 and W:
//   expr  an expression statement's expression: its row is folded into the stmt row at the same
//         offset, which keeps the expression's own fps as innerFp1/2/3 (pattern_units.inner_fp*).
//         The stmt fp wraps the expression in ExpressionStatement, so it alone could not join the
//         same expression used as a return argument, initializer or call argument elsewhere; N1
//         matches expr fps against both fp* and inner_fp*, so no cross-context bucket is lost.
//   expr  every expr unit of a spec facet: spec code groups by fn bodies and stmt windows (setup
//         blocks such as ground-truth A16); assertion expressions alone were 5.2k rows of noise
//   fn    a body below both gates that apply alone (G1 mass >= 8, G2 E >= 30)
//   stmt  the only statement of its block below both gates: no window (N2 k >= 2, W >= 3 instances)
//         can include it, so it could only ever group on its own
// Then a hard cap per file keeps the heaviest kinds first (fn, tmpl, stmt, expr) in source order;
// hitting it is reported so the caller can log it.
import { anchorWeight, evidence } from './anchors.js';

export const STORE_FLOOR = Object.freeze({ minMass: 8, minEvidence: 30, maxUnitsPerFile: 400 });

const KIND_PRIORITY = { fn: 0, tmpl: 1, stmt: 2, expr: 3 };

const isBelowSoloGates = (unit) => {
  const isLight = unit.mass < STORE_FLOOR.minMass;
  const isWeak = evidence(unit.mass, anchorWeight(unit.anchors)) < STORE_FLOOR.minEvidence;
  return isLight && isWeak;
};

const blockSizesOf = (units) => {
  const sizes = new Map();
  for (const unit of units) {
    const isStmt = unit.kind === 'stmt';
    if (isStmt) sizes.set(unit.blockId, (sizes.get(unit.blockId) ?? 0) + 1);
  }
  return sizes;
};

const createFloorTest = (units, stmtStarts, isSpec) => {
  const blockSizes = blockSizesOf(units);
  return {
    expr: (unit) => isSpec || stmtStarts.has(unit.startOffset),
    fn: (unit) => isBelowSoloGates(unit),
    stmt: (unit) => blockSizes.get(unit.blockId) === 1 && isBelowSoloGates(unit),
    tmpl: () => false
  };
};

/** Expr units that an expression statement's stmt row absorbs, by start offset. */
const foldedExprsOf = (units, stmtStarts) => new Map(units
  .filter((unit) => unit.kind === 'expr' && stmtStarts.has(unit.startOffset))
  .map((unit) => [unit.startOffset, unit]));

const withInnerFps = (unit, folded) => {
  const inner = unit.kind === 'stmt' ? folded.get(unit.startOffset) : null;
  if (!inner) return unit;
  return { ...unit, innerFp1: inner.fp1, innerFp2: inner.fp2, innerFp3: inner.fp3 };
};

const byPriority = (a, b) => KIND_PRIORITY[a.unit.kind] - KIND_PRIORITY[b.unit.kind] || a.index - b.index;

/**
 * Applies the floor, then the per-file cap. options.isSpec: the file is in a spec facet. Returns
 * { units, floorDropped, capDropped } with units in their original (source) order.
 */
export const selectStoredUnits = (units, { maxUnits = STORE_FLOOR.maxUnitsPerFile, isSpec = false } = {}) => {
  const stmtStarts = new Set(units.filter((unit) => unit.kind === 'stmt').map((unit) => unit.startOffset));
  const isFloored = createFloorTest(units, stmtStarts, isSpec);
  const folded = foldedExprsOf(units, stmtStarts);
  const floored = units.filter((unit) => !isFloored[unit.kind](unit)).map((unit) => withInnerFps(unit, folded));
  const isOverCap = floored.length > maxUnits;
  if (!isOverCap) return { units: floored, floorDropped: units.length - floored.length, capDropped: 0 };
  const keptIndexes = new Set(floored.map((unit, index) => ({ unit, index })).sort(byPriority).slice(0, maxUnits).map((entry) => entry.index));
  const capped = floored.filter((unit, index) => keptIndexes.has(index));
  return { units: capped, floorDropped: units.length - floored.length, capDropped: floored.length - capped.length };
};
