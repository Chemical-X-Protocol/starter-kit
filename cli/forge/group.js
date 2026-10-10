// Cross-file grouping paths over ledger rows (engine doc section 5). Every bucket is keyed by
// (kind, facet, fp), so units of different facets never meet, and must span at least 2 files:
//   N1  exact buckets. fp1 for fn, stmt and expr (an expression statement's own expression is matched
//       through the stmt row's inner_fp1, see unit-floor.js), gated by G1; fp2 for fn and stmt (G2);
//       fp3 for fn and stmt (G3, then LGG: needsLgg).
//   N2  windows of k = 2..6 consecutive statements over per-block fp2 sequences, maximal windows only,
//       gated by G2.
//   N3  fn units with the same declared name and equal fp3; gated by G1 (the name is the extra evidence),
//       LGG then allows one variant hole (needsLgg).
//   N4  name twins (groupNameTwins, below): the same helper name in 2+ files with body evidence instead of
//       a shared fp. Review candidates only: needsLgg, assumed behaviorDelta, ranked below N1-N3.
// A statement instance (N1) or window (N2) with an own return must end its function's body, or end in an
// unconditional `return` (exits.js, body-ends.js); ending a loop or `if` body is not enough. Any other
// such span cannot be cut out as a piece and is dropped before the gates.
// Parsing a span for its returns is the costly step, so a bucket is first gated on the members that
// surely stay (no `return` word): metrics only rise as members drop, so when even those fail the gate,
// the filtered group fails it too and nothing is parsed.
// context: { contentHashes, ubiquitousOf, mayReturnAt and strandsAt(file, start, end),
// endsFunctionBody(row), reject(draft, reason, finish) }; reject hears every group that failed its gate
// or instance rules and finish() builds it in full.
import { byCodePoint, draftGroup, finishGroup, instanceOfRow, instanceOfRows, metricsOf, pushTo, spansFiles } from './group-shape.js';
import { admitGroup, checkGate, labelIdiom, GATE_OF_PATH } from './gates.js';
import { blocksOf, runsOf, windowsOfRuns, windowKeyOf, nonOverlapping, dropDominated } from './windows.js';

export const N1_LEVELS = Object.freeze([
  Object.freeze({ path: 'N1-fp1', level: 1, kinds: new Set(['fn', 'stmt', 'expr']), withInner: true, needsLgg: false }),
  Object.freeze({ path: 'N1-fp2', level: 2, kinds: new Set(['fn', 'stmt']), withInner: false, needsLgg: false }),
  Object.freeze({ path: 'N1-fp3', level: 3, kinds: new Set(['fn', 'stmt']), withInner: false, needsLgg: true })
]);

export const N2_WINDOW = Object.freeze({ minK: 2, maxK: 6 });

const N2_SPEC = Object.freeze({ path: 'N2', level: 2, needsLgg: false });
const N3_SPEC = Object.freeze({ path: 'N3', level: 3, needsLgg: true });

const asIs = (member) => member;

/**
 * Gates members (ledger rows or instances) as one group and builds it only when admitted:
 * options.toInstance turns a member into its instance. A failing group goes to context.reject with the
 * reason (prefixed by options.reasonPrefix); null is returned.
 */
export const admitted = (spec, members, context, { reasonPrefix = '', toInstance = asIs } = {}) => {
  const draft = draftGroup(spec, members, context);
  const verdict = admitGroup(draft);
  const finish = () => finishGroup(draft, members.map(toInstance), context);
  const isAdmitted = verdict.ok;
  if (isAdmitted) return labelIdiom(finish());
  context.reject?.(draft, `${reasonPrefix}${verdict.reason}`, finish);
  return null;
};

// Calls visit(kind, fp, row) for each fp a row offers at this level: its own (for the level's kinds) and,
// at fp1, its expression statement's inner expression as an expr.
const forEachFp = (rows, spec, visit) => {
  const ownColumn = `fp${spec.level}`;
  const innerColumn = `inner_fp${spec.level}`;
  for (const row of rows) {
    const hasOwn = spec.kinds.has(row.kind);
    if (hasOwn) visit(row.kind, row[ownColumn], row);
    const innerFp = spec.withInner ? row[innerColumn] : null;
    if (innerFp) visit('expr', innerFp, row);
  }
};

// Two passes: count each fp, then bucket only the fps seen more than once (most are unique).
const exactBuckets = (rows, spec) => {
  const counts = new Map();
  forEachFp(rows, spec, (kind, fp) => counts.set(fp, (counts.get(fp) ?? 0) + 1));
  const buckets = new Map();
  forEachFp(rows, spec, (kind, fp, row) => {
    const isShared = counts.get(fp) > 1;
    if (isShared) pushTo(buckets, `${kind}|${row.facet_key}|${fp}`, row);
  });
  return [...buckets].filter(([, members]) => spansFiles(members)).map(([key, members]) => ({ kind: key.slice(0, key.indexOf('|')), rows: members }));
};

// A span that may hold an own return (the word test): (first, last) are its first and last stmt rows.
const mayStrand = (first, last, context) => context.mayReturnAt(first.file_path, first.start, last.end);

// The span returns from its function and is not the end of that function's body.
const strands = (first, last, context) => mayStrand(first, last, context) && !context.endsFunctionBody(last) && context.strandsAt(first.file_path, first.start, last.end);

const failsGateEarly = (spec, sureMembers, context) => {
  const hasSure = sureMembers.length > 0;
  return hasSure && !checkGate(GATE_OF_PATH[spec.path], metricsOf(sureMembers, context.ubiquitousOf(spec.facetKey))).ok;
};

const exactGroup = (spec, bucket, context) => {
  const { kind } = bucket;
  const groupSpec = { ...spec, kind, facetKey: bucket.rows[0].facet_key };
  const toInstance = (row) => ({ ...instanceOfRow(row), kind });
  const isStmt = kind === 'stmt';
  const sure = isStmt ? bucket.rows.filter((row) => !mayStrand(row, row, context)) : bucket.rows;
  const isHopeless = failsGateEarly(groupSpec, sure, context);
  if (isHopeless) return admitted(groupSpec, bucket.rows, context, { toInstance });
  const kept = isStmt ? bucket.rows.filter((row) => !strands(row, row, context)) : bucket.rows;
  const isStillCrossFile = spansFiles(kept);
  if (!isStillCrossFile) return null;
  return admitted(groupSpec, kept, context, { toInstance });
};

/** N1: exact fp buckets at fp1, fp2 and fp3, in that order. */
export const groupExact = (rows, context) =>
  N1_LEVELS.flatMap((spec) => exactBuckets(rows, spec).map((entries) => exactGroup(spec, entries, context)).filter(Boolean));

const blockOfWindow = (window) => `${window.rows[0].file_path}#${window.rows[0].block_id}`;

const nonOverlappingInstances = (windows) => {
  const byBlock = new Map();
  for (const window of windows) pushTo(byBlock, blockOfWindow(window), window);
  return [...byBlock.values()].flatMap((blockWindows) => nonOverlapping(blockWindows)).map((window) => instanceOfRows(window.rows));
};

// One bucket's windows: the return rule, then non-overlapping per block (none when the bucket is hopeless).
const windowInstances = (windows, context) => {
  const sure = windows.filter((window) => !mayStrand(window.rows[0], window.rows.at(-1), context));
  const spec = { ...N2_SPEC, facetKey: windows[0].rows[0].facet_key };
  const isHopeless = failsGateEarly(spec, nonOverlappingInstances(sure), context);
  if (isHopeless) return [];
  return nonOverlappingInstances(windows.filter((window) => !strands(window.rows[0], window.rows.at(-1), context)));
};

// A statement whose fp2 occurs in only one file of its facet can be in no cross-file window.
const createRepeatTest = (rows) => {
  const files = new Map();
  for (const row of rows) {
    const isStmt = row.kind === 'stmt';
    if (isStmt) pushTo(files, `${row.facet_key}|${row.fp2}`, row.file_path);
  }
  const repeated = new Set([...files].filter(([, paths]) => new Set(paths).size >= 2).map(([key]) => key));
  return (row) => repeated.has(`${row.facet_key}|${row.fp2}`);
};

/** N2: maximal cross-file statement windows (k = 2..6) over fp2 sequences. */
export const groupWindows = (rows, context) => {
  const buckets = new Map();
  const isRepeated = createRepeatTest(rows);
  for (const blockRows of blocksOf(rows).values()) {
    for (const window of windowsOfRuns(runsOf(blockRows, isRepeated), N2_WINDOW)) {
      pushTo(buckets, `${window.k}|${window.rows[0].facet_key}|${windowKeyOf(window.rows, 2)}`, window);
    }
  }
  const candidates = [...buckets.values()]
    .filter((windows) => spansFiles(windows.map((window) => window.rows[0])))
    .map((windows) => ({ k: windows[0].k, facetKey: windows[0].rows[0].facet_key, instances: windowInstances(windows, context) }))
    .filter((bucket) => new Set(bucket.instances.map((instance) => instance.file)).size >= 2);
  return dropDominated(candidates)
    .map((bucket) => admitted({ ...N2_SPEC, kind: 'window', facetKey: bucket.facetKey }, bucket.instances, context))
    .filter(Boolean);
};

/** N3: same declared name, same facet, equal fp3, in at least 2 files. */
export const groupNamed = (rows, context) => {
  const buckets = new Map();
  for (const row of rows) {
    const isNamedFn = row.kind === 'fn' && Boolean(row.decl_name);
    if (isNamedFn) pushTo(buckets, `${row.facet_key}|${row.decl_name}|${row.fp3}`, row);
  }
  return [...buckets.values()]
    .filter(spansFiles)
    .map((named) => admitted({ ...N3_SPEC, kind: 'fn', facetKey: named[0].facet_key }, named, context, { toInstance: instanceOfRow }))
    .filter(Boolean);
};

// N4 (#4487): a name twin. Fn rows that re-declare the same helper name in 2+ files without sharing a
// structural level (N1-N3 cannot see them: a Type-3 re-implementation). The name alone is weak, so a pair
// is linked only on body evidence; a group is a clique of linked rows. N4 groups are review
// candidates: needsLgg is true, the bodies are assumed to differ in behavior (behaviorDelta), and N4
// ranks below N1-N3, so they are never an auto-heal.
export const N4_EVIDENCE = Object.freeze({ minNameLength: 6, minMass: 8, minJaccard: 0.6, minLiteralLength: 4, minRegexPrefix: 10 });

// Names too generic to say anything (also declared by unrelated code in many files).
export const N4_STOPLIST = new Set([
  'handler', 'format', 'render', 'setup', 'init', 'cleanup', 'finish', 'record', 'matches', 'visit', 'execute', 'process',
  'handle', 'create', 'update', 'remove', 'resolve', 'options', 'config', 'helper', 'wrapper', 'factory', 'default',
  'constructor', 'tostring', 'callback', 'listener', 'compare', 'filter', 'reduce', 'predicate', 'iterate'
]);

const N4_SPEC = Object.freeze({ path: 'N4', level: 3, needsLgg: true, behaviorDelta: 'assumed' });

const anchorsOfRow = (row) => (Array.isArray(row.anchors) ? row.anchors : JSON.parse(row.anchors || '[]'));

const nameKeyOf = (name) => name.replace(/^_+/, '').toLowerCase();

const isN4Candidate = (row) => {
  const name = row.decl_name ?? '';
  const isLongEnough = name.length >= N4_EVIDENCE.minNameLength;
  return row.kind === 'fn' && isLongEnough && row.mass >= N4_EVIDENCE.minMass && !N4_STOPLIST.has(nameKeyOf(name));
};

const jaccardOf = (a, b) => {
  const left = new Set(a);
  const right = new Set(b);
  const shared = [...right].filter((anchor) => left.has(anchor)).length;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
};

const prefixLength = (a, b) => {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
};

const regexBodies = (anchors) => anchors.filter((anchor) => anchor.startsWith('regex:')).map((anchor) => anchor.slice(6));

const longStrings = (anchors) => anchors.filter((anchor) => anchor.startsWith('str:') && anchor.length - 6 >= N4_EVIDENCE.minLiteralLength);

// A shared string literal of 4+ characters, or two regex literals that start the same for 10+ characters.
const sharesLiteral = (a, b) => {
  const strings = new Set(longStrings(a));
  const hasString = longStrings(b).some((anchor) => strings.has(anchor));
  const regexes = regexBodies(b);
  const hasRegex = regexBodies(a).some((left) => regexes.some((right) => prefixLength(left, right) >= N4_EVIDENCE.minRegexPrefix));
  return hasString || hasRegex;
};

const isLinked = (a, b) => jaccardOf(a, b) >= N4_EVIDENCE.minJaccard || sharesLiteral(a, b);

// Greedy cliques of the link relation among one name's rows, in row order: a row joins a group only
// when it is linked to every member (in another file than each), so one weak link never chains two
// unrelated readers together. Rows left alone are dropped. Rows are put in file/start order first, so
// the groups never depend on the order the ledger gave them.
const byRowPlace = (a, b) => byCodePoint(a.file_path, b.file_path) || a.start - b.start || byCodePoint(String(a.id), String(b.id));

const linkedCliques = (unsortedRows) => {
  const rows = [...unsortedRows].sort(byRowPlace);
  const anchors = rows.map(anchorsOfRow);
  const isTwin = (i, j) => rows[i].file_path !== rows[j].file_path && isLinked(anchors[i], anchors[j]);
  const taken = new Set();
  const cliques = [];
  const cliqueFrom = (seed) => {
    const members = [seed];
    for (let next = seed + 1; next < rows.length; next += 1) {
      const canJoin = !taken.has(next) && members.every((member) => isTwin(member, next));
      if (canJoin) members.push(next);
    }
    members.forEach((member) => taken.add(member));
    return members;
  };
  rows.forEach((row, seed) => {
    const members = taken.has(seed) ? [] : cliqueFrom(seed);
    const isTwinGroup = members.length > 1;
    if (isTwinGroup) cliques.push(members.map((member) => rows[member]));
  });
  return cliques;
};

/** N4: same normalized declared name (6+ characters, not stoplisted), same facet, 2+ files, body evidence. */
export const groupNameTwins = (rows, context) => {
  const buckets = new Map();
  for (const row of rows) {
    const isCandidate = isN4Candidate(row);
    if (isCandidate) pushTo(buckets, `${row.facet_key}|${nameKeyOf(row.decl_name)}`, row);
  }
  return [...buckets.values()]
    .filter(spansFiles)
    .flatMap(linkedCliques)
    .filter(spansFiles)
    .map((twins) => admitted({ ...N4_SPEC, kind: 'fn', facetKey: twins[0].facet_key }, twins, context, { toInstance: instanceOfRow }))
    .filter(Boolean)
    .map((group) => ({ ...group, behaviorDelta: N4_SPEC.behaviorDelta }));
};
