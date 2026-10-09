// n-ary anti-unification (engine doc section 6): the least general generalization of a group's member
// trees in one simultaneous walk. Positions whose L1 digests agree are shared; equal (type, L1 label,
// kid shape) recurses; any other difference is a hole keyed by the tuple of the members' L1 digests, so
// equal tuples share one hole (a repeated difference is one param). Inside shared code, an outer-bound
// identifier (a capture, @k at L1) is a capture when every member names the same binding, and a ref
// hole when the names differ (fetchLocks vs fetchTasks: the refetch callback of A21).
// Members are unit trees (unit-trees.js); the walk reads per-node notes from hashUnit's onNode, so the
// digests are exactly the ledger's. Hole kinds and facts come from hole-kinds.js; rejects.js judges them.
import { hashUnit } from './hash.js';
import { holeFactsOf } from './hole-kinds.js';
import { printCanonical } from './canon-print.js';

/** LGG over at most this many members (design doc, BUDGETS: LGG on at most 50 pairs per bucket). */
export const LGG_MEMBER_CAP = 50;

const EXAMPLE_LIMIT = 3;
const EXAMPLE_WIDTH = 60;
const EXAMPLE_MAX_NODES = 40;
const WRITE_SLOTS = new Set(['AssignmentExpression.left', 'UpdateExpression.argument']);

const childList = (value) => (Array.isArray(value) ? value : [value]);

const windowNode = (statements) => ({ type: 'Window', label: '', kids: { body: statements }, isExpr: false, loc: null, ident: null, lit: null });

// Per-node notes of a tree, once per tree object (unit-trees.js hands out one object per span).
const PREPARED = new WeakMap();

const prepare = (tree) => {
  const known = PREPARED.get(tree);
  if (known) return known;
  const notes = new Map();
  hashUnit(tree.root, { declScope: tree.declScope ?? undefined, onNode: (node, note) => notes.set(node, note) });
  const top = Array.isArray(tree.root) ? windowNode(tree.root) : tree.root;
  const prepared = { notes, top, paramIds: tree.paramIds ?? new Set(), mass: sizeOf(top) };
  PREPARED.set(tree, prepared);
  return prepared;
};

const sizeOf = (node) => {
  let count = 0;
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    count += current.type === 'Window' ? 0 : 1;
    for (const value of Object.values(current.kids)) childList(value).forEach((child) => child && stack.push(child));
  }
  return count;
};

// '#' (a unit-local binder) or '@' (a capture) for a binder identifier, else null.
const binderMarkOf = (member, node) => {
  const mark = node.type === 'Identifier' ? member.notes.get(node)?.v1?.[0] : null;
  return mark === '#' || mark === '@' ? mark : null;
};

// Binder numbers (#k, @k) are first-use positions, so one differing region shifts every later number:
// the shape compares only the binder class, and noteBinder pairs the binders themselves.
const shapeOf = (member, node) => {
  const label = binderMarkOf(member, node) ?? member.notes.get(node)?.v1 ?? node.label;
  const kidShape = Object.entries(node.kids).map(([key, value]) => (Array.isArray(value) ? `${key}[${value.length}]` : key)).join(',');
  return `${node.type}|${label}|${kidShape}`;
};

// Canonical source of one side for reports; a node outside the printable subset shows its type.
const printedOf = (node) => {
  try {
    return printCanonical(node);
  } catch {
    return `<${node.type}>`;
  }
};

const exampleOf = (node, size) => {
  const isAbsent = node === null;
  if (isAbsent) return '<none>';
  const isLarge = size > EXAMPLE_MAX_NODES;
  if (isLarge) return `<${node.type}: ${size} nodes>`;
  const text = printedOf(node).replace(/\s+/g, ' ');
  return text.length > EXAMPLE_WIDTH ? `${text.slice(0, EXAMPLE_WIDTH - 3)}...` : text;
};

// Calls visit(sides, slot) for every kid position of structurally equal sides.
const descend = (sides, visit) => {
  const head = sides[0];
  for (const [key, value] of Object.entries(head.kids)) {
    const slot = `${head.type}.${key}`;
    const isList = Array.isArray(value);
    if (isList) value.forEach((_, index) => visit(sides.map((node) => node.kids[key][index]), slot));
    if (!isList) visit(sides.map((node) => node.kids[key]), slot);
  }
};

const createWalk = (members, ubiquitous, withExamples) => {
  const holes = new Map();
  const captures = new Map();
  const holeNodes = members.map(() => 0);

  const addHole = (sides, tupleKey) => {
    const facts = holeFactsOf(sides.map((node, m) => ({ node, notes: members[m].notes, paramIds: members[m].paramIds })), ubiquitous);
    facts.sizes.forEach((size, m) => { holeNodes[m] += size; });
    const existing = holes.get(tupleKey);
    if (existing) {
      existing.occurrences += 1;
      return;
    }
    const examples = withExamples ? sides.slice(0, EXAMPLE_LIMIT).map((node, m) => exampleOf(node, facts.sizes[m])) : [];
    holes.set(tupleKey, { id: `h${holes.size + 1}`, ...facts, occurrences: 1, examples });
  };

  const noteCapture = (sides, slot) => {
    const names = sides.map((node) => node.label);
    const isSameName = names.every((name) => name === names[0]);
    if (!isSameName) return addHole(sides, `ref:${names.join('|')}`);
    const known = captures.get(names[0]) ?? { name: names[0], isWritten: false };
    known.isWritten = known.isWritten || WRITE_SLOTS.has(slot);
    captures.set(names[0], known);
    return undefined;
  };

  // Unit-local binders correspond when each member's binding always meets the same partners; a binding
  // that meets another partner somewhere is a ref hole there.
  const partners = members.map(() => new Map());
  const noteLocal = (sides) => {
    const tuple = sides.map((node) => node.ident?.bindingId ?? node.label).join('|');
    const isConsistent = sides.every((node, m) => (partners[m].get(node.ident?.bindingId ?? node.label) ?? tuple) === tuple);
    if (!isConsistent) return addHole(sides, `local:${tuple}`);
    sides.forEach((node, m) => partners[m].set(node.ident?.bindingId ?? node.label, tuple));
    return undefined;
  };

  const binderClassOf = (sides) => {
    const marks = sides.map((node, m) => binderMarkOf(members[m], node));
    const isOneClass = marks[0] !== null && marks.every((mark) => mark === marks[0]);
    return isOneClass ? marks[0] : null;
  };

  const noteBinder = (sides, slot, mark) => (mark === '@' ? noteCapture(sides, slot) : noteLocal(sides));

  const scanShared = (sides, slot) => {
    const head = sides[0];
    const isEmptySlot = !head;
    if (isEmptySlot) return undefined;
    const mark = binderClassOf(sides);
    if (mark) return noteBinder(sides, slot, mark);
    return descend(sides, scanShared);
  };

  const walk = (sides, slot) => {
    const isAllAbsent = sides.every((node) => node === null || node === undefined);
    if (isAllAbsent) return undefined;
    const present = sides.map((node) => node ?? null);
    const isPartlyAbsent = present.some((node) => node === null);
    const keys = present.map((node, m) => (node ? members[m].notes.get(node)?.l1 ?? null : null));
    if (isPartlyAbsent) return addHole(present, keys.join('|'));
    const mark = binderClassOf(present);
    if (mark) return noteBinder(present, slot, mark);
    const isShared = keys[0] !== null && keys.every((key) => key === keys[0]);
    if (isShared) return scanShared(present, slot);
    const shape = shapeOf(members[0], present[0]);
    const isSameShape = present.every((node, m) => shapeOf(members[m], node) === shape);
    return isSameShape ? descend(present, walk) : addHole(present, keys.join('|'));
  };

  return { walk, holes, captures, holeNodes };
};

const ratioOf = (numerator, denominator) => (denominator === 0 ? 0 : numerator / denominator);

/**
 * LGG of unit trees (createTreeReader().treeOf results, at most LGG_MEMBER_CAP are used).
 * options.ubiquitous: the facet's ubiquitous anchors; options.examples (default true) prints up to 3
 * sides of each hole, which a merge test does not need. Returns null for fewer than 2 trees, else
 * { memberCount, rootType, mass, holeNodes, holeRatio, holes, captures } where holes carry
 * { id, kind, occurrences, sizes, hasLocal, hasExit, anchoredMembers, base, examples } and captures
 * { name, isWritten }; nothing in it refers to tree nodes, so it can be stored as JSON.
 */
export const antiUnify = (trees, { ubiquitous = new Set(), examples = true } = {}) => {
  const used = trees.slice(0, LGG_MEMBER_CAP);
  const isTooFew = used.length < 2;
  if (isTooFew) return null;
  const members = used.map(prepare);
  const state = createWalk(members, ubiquitous, examples);
  state.walk(members.map((member) => member.top), null);
  const mass = members.map((member) => member.mass);
  const totalHoleNodes = state.holeNodes.reduce((total, count) => total + count, 0);
  const totalMass = mass.reduce((total, count) => total + count, 0);
  return {
    memberCount: members.length,
    rootType: members[0].top.type,
    mass,
    holeNodes: state.holeNodes,
    holeRatio: ratioOf(totalHoleNodes, totalMass),
    holes: [...state.holes.values()],
    captures: [...state.captures.values()].sort((a, b) => Number(a.name > b.name) - Number(a.name < b.name))
  };
};
