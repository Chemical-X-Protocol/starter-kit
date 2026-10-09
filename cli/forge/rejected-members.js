// Near misses of a group that a blueprint must not touch (engine doc, Blueprint: evidence.rejectedMembers).
// A rejected member is a unit that reads like the group's members (it uses every non-literal anchor they
// share, at a comparable size) but whose contract differs, so replacing it with the piece would change what
// it does:
//   - a statement of the group's root type whose pair LGG with the home member fails R3 (a hole reads a
//     binder the unit introduces: the catch hands its error back);
//   - a function that has no statement of the group's root type at all, for a try group: it throws where
//     the members recover (R4).
// Anything else the pair LGG accepts is a mergeable near miss, not a rejection; failures without R3 are
// size or anchor differences and stay out of the list. Reads the ledger and the member trees only.
import { antiUnify } from './lgg.js';
import { judgeLgg } from './rejects.js';
import { instanceOfRow, sharedAnchors, byCodePoint } from './group-shape.js';
import { shapeAnchorsOf } from './library-match.js';

const MIN_ANCHORS = 3;
const MAX_LISTED = 40;
const LOW_MASS = 0.5;
const HIGH_MASS = 5;
const KINDS = new Set(['stmt', 'fn']);
const TRY_ROOT = 'TryStatement';

const REASONS = {
  R3: 'R3 a hole reads a binder the unit introduces (its catch hands the error back)',
  R4: `R4 no ${TRY_ROOT} in the unit: it throws where the members recover`
};

const kidsOf = (node) => Object.values(node.kids ?? {}).flatMap((value) => (Array.isArray(value) ? value : [value])).filter(Boolean);

const hasType = (node, type) => {
  if (!node) return false;
  if (Array.isArray(node)) return node.some((entry) => hasType(entry, type));
  return node.type === type || kidsOf(node).some((kid) => hasType(kid, type));
};

const rootTypeOf = (tree) => (Array.isArray(tree.root) ? 'window' : tree.root.type);

const overlaps = (row, instance) => row.file_path === instance.file && row.start_line <= instance.endLine && row.end_line >= instance.startLine;

const atOf = (row) => `${row.file_path}:${row.start_line}-${row.end_line}`;

const byRowLocation = (a, b) => byCodePoint(a.file_path, b.file_path) || a.start_line - b.start_line || a.id - b.id;

const candidatesOf = (group, context) => {
  const homeRow = context.rowsById.get(group.instances[0].unitIds[0]);
  const shape = shapeAnchorsOf(sharedAnchors(group.instances));
  const memberIds = new Set(group.instances.flatMap((instance) => instance.unitIds));
  const masses = group.instances.map((instance) => instance.mass);
  const low = Math.min(...masses) * LOW_MASS;
  const high = Math.max(...masses) * HIGH_MASS;
  const isNear = (row) => {
    const isSize = row.mass >= low && row.mass <= high;
    const isFree = !memberIds.has(row.id) && !group.instances.some((instance) => overlaps(row, instance));
    return isSize && isFree && !row.is_spec && row.facet_key === homeRow.facet_key && KINDS.has(row.kind);
  };
  const usesShape = (row) => {
    const own = new Set(shapeAnchorsOf(row.anchors));
    return shape.every((anchor) => own.has(anchor));
  };
  return { shape, rows: context.rows.filter((row) => isNear(row) && usesShape(row)).sort(byRowLocation) };
};

const isNested = (row, listed) => listed.some((other) => other.file_path === row.file_path && other.start_line <= row.start_line && other.end_line >= row.end_line);

/**
 * Rejected members of a group: [{ at, codes, reason }] in file and line order. context: { rows, rowsById,
 * treeOf(instance), ubiquitousOf?(facetKey) }. [] for groups that are not statement or function groups
 * and for shapes with fewer than MIN_ANCHORS anchors.
 */
export const findRejectedMembers = (group, context) => {
  const home = group.instances[0];
  const isScriptGroup = KINDS.has(home.kind) && group.kind !== 'tmpl';
  const { shape, rows } = isScriptGroup ? candidatesOf(group, context) : { shape: [], rows: [] };
  const homeTree = shape.length >= MIN_ANCHORS ? context.treeOf(home) : null;
  if (!homeTree) return [];
  const homeRoot = rootTypeOf(homeTree);
  const ubiquitous = context.ubiquitousOf?.(group.facetKey);
  const listed = [];
  for (const row of rows) {
    if (isNested(row, listed)) continue;
    const tree = context.treeOf(instanceOfRow(row));
    if (!tree) continue;
    const isSameKind = row.kind === home.kind;
    const lgg = isSameKind ? antiUnify([homeTree, tree], { examples: false, ...(ubiquitous ? { ubiquitous } : {}) }) : null;
    const verdict = lgg && lgg.rootType === homeRoot ? judgeLgg(lgg, { path: group.path, kind: group.kind }, {}) : null;
    const isBinderRead = verdict !== null && !verdict.ok && verdict.codes.includes('R3');
    const isThrower = !isSameKind && homeRoot === TRY_ROOT && !hasType(tree.root, TRY_ROOT);
    if (isBinderRead) listed.push({ ...row, codes: verdict.codes.filter((code) => code === 'R3' || code === 'R4'), reasonCode: 'R3' });
    if (isThrower) listed.push({ ...row, codes: ['R4'], reasonCode: 'R4' });
  }
  return listed.slice(0, MAX_LISTED).map((row) => ({ at: atOf(row), codes: row.codes, reason: REASONS[row.reasonCode] }));
};
