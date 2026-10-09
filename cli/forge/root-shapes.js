// Root shapes for drift (engine doc section 6: a drift unit has the same root shape as the group). The
// shape of a unit is the type of what it computes: a statement is read through its initializer, test,
// argument or expression, and leading `!`s are looked through (De Morgan moves them). A window's shape is
// its statement types in order, a fn unit's is `fn`. A group whose root is a logical chain also accepts
// the shape of each operand, since a drifted copy is a check that lost a conjunct (`!rel.startsWith('..')`
// against `rel.startsWith('..') || path.isAbsolute(rel)`).
// A row's shape depends only on its own text, so it is cached by kind and content key
// (content_hash:start:end) across runs (group-store.js); a warm run parses no file for drift.
const LOGICAL_TYPES = new Set(['LogicalNary', 'LogicalExpression']);
const NEGATION_LABEL = 'operator:! prefix';

const READ_THROUGH = {
  VariableDeclaration: (node) => (node.kids.declarations.length === 1 ? node.kids.declarations[0].kids.init : null),
  ExpressionStatement: (node) => node.kids.expression,
  IfStatement: (node) => node.kids.test,
  ReturnStatement: (node) => node.kids.argument
};

const stripNegation = (node) => {
  let current = node;
  while (current?.type === 'UnaryExpression' && current.label === NEGATION_LABEL) current = current.kids.argument;
  return current;
};

/** The node a unit computes: statements read through, negations stripped (null when there is none). */
export const computedNodeOf = (node) => {
  const readThrough = READ_THROUGH[node?.type];
  return stripNegation(readThrough ? readThrough(node) : node) ?? null;
};

const operandsOf = (node) => {
  const isLogical = LOGICAL_TYPES.has(node?.type);
  if (!isLogical) return [];
  return Object.values(node.kids).flat().filter(Boolean).map((operand) => stripNegation(operand)?.type ?? null).filter(Boolean);
};

// { type, computed, operands } of one unit node.
const shapeOfNode = (node, kind) => {
  const computed = kind === 'fn' ? null : computedNodeOf(node);
  return { type: node.type, computed: kind === 'fn' ? 'fn' : computed?.type ?? null, operands: operandsOf(computed) };
};

const UNKNOWN_SHAPE = Object.freeze({ type: null, computed: null, operands: [] });

/**
 * Shape reader over a tree reader (unit-trees.js), the rows by id and the content hashes. options.cache:
 * Map(rowKey -> shape) from the last run. Returns { spanShape(rows), groupShapes(group), decisions }:
 * decisions holds every row shape used this run, for the store.
 */
export const createShapeReader = (reader, rowsById, { contentHashes = new Map(), cache = new Map() } = {}) => {
  const decisions = new Map();
  const keyOf = (row) => `${row.kind}|${contentHashes.get(row.file_path) ?? row.file_path}:${row.start}:${row.end}`;

  const readShape = (row) => {
    const tree = reader.treeOf({ kind: row.kind, unitIds: [row.id] });
    const node = row.kind === 'fn' ? tree?.declScope : tree?.root;
    return node ? shapeOfNode(node, row.kind) : UNKNOWN_SHAPE;
  };

  const rowShape = (row) => {
    const key = keyOf(row);
    const shape = decisions.get(key) ?? cache.get(key) ?? readShape(row);
    decisions.set(key, shape);
    return shape;
  };

  const spanShape = (rows) => {
    const isWindow = rows.length > 1;
    return isWindow ? rows.map((row) => rowShape(row).type).join(',') : rowShape(rows[0]).computed;
  };

  const groupShapes = (group) => {
    const rows = (group.instances[0]?.unitIds ?? []).map((id) => rowsById.get(id)).filter(Boolean);
    const isEmpty = rows.length === 0;
    if (isEmpty) return new Set();
    const isWindow = rows.length > 1;
    const shapes = isWindow ? [spanShape(rows)] : [rowShape(rows[0]).computed, ...rowShape(rows[0]).operands];
    return new Set(shapes.filter(Boolean));
  };

  return { spanShape, groupShapes, decisions };
};
