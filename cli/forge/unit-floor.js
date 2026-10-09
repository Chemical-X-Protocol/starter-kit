// Which collected units the ledger stores (design doc, BUDGETS: pattern_units <= 40k rows on the kit).
// The floor drops only rows no grouping path can use, so it is lossless for N1, N2, N3 and W:
//   expr  an expression statement's expression: the stmt unit at the same offset already carries it
//         (its fp is a pure function of the expression's), so the expr row only duplicated it
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

const createFloorTest = (units) => {
  const blockSizes = blockSizesOf(units);
  const stmtStarts = new Set(units.filter((unit) => unit.kind === 'stmt').map((unit) => unit.startOffset));
  return {
    expr: (unit) => stmtStarts.has(unit.startOffset),
    fn: (unit) => isBelowSoloGates(unit),
    stmt: (unit) => blockSizes.get(unit.blockId) === 1 && isBelowSoloGates(unit),
    tmpl: () => false
  };
};

const byPriority = (a, b) => KIND_PRIORITY[a.unit.kind] - KIND_PRIORITY[b.unit.kind] || a.index - b.index;

/**
 * Applies the floor, then the per-file cap. Returns { units, floorDropped, capDropped } with units
 * in their original (source) order.
 */
export const selectStoredUnits = (units, { maxUnits = STORE_FLOOR.maxUnitsPerFile } = {}) => {
  const isFloored = createFloorTest(units);
  const floored = units.filter((unit) => !isFloored[unit.kind](unit));
  const isOverCap = floored.length > maxUnits;
  if (!isOverCap) return { units: floored, floorDropped: units.length - floored.length, capDropped: 0 };
  const keptIndexes = new Set(floored.map((unit, index) => ({ unit, index })).sort(byPriority).slice(0, maxUnits).map((entry) => entry.index));
  const capped = floored.filter((unit, index) => keptIndexes.has(index));
  return { units: capped, floorDropped: units.length - floored.length, capDropped: floored.length - capped.length };
};
