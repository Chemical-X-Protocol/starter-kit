// Anchor weights, ubiquity and evidence (engine doc section 4). Anchors are strings '<kind>:<text>':
//   import:<local name>  imported binding           2
//   global:<name>        non-trivial global          2
//   call:<name>          member-call (method) name   1
//   str:<json value>     L1 string literal           1
//   num:<value>          numeric literal not 0/1     0.5
//   regex:/<p>/<f>       regex literal               2
//   key:<name>           L1 object key               0.5
// An anchor present in more than 40% of a facet's files is ubiquitous and weighs 0.
// E (evidence) = mass + 3 * anchorWeight.

export const ANCHOR_WEIGHTS = Object.freeze({ import: 2, global: 2, call: 1, str: 1, num: 0.5, regex: 2, key: 0.5 });

/** Globals that carry no evidence at all (they are never anchors, at any level). */
export const TRIVIAL_GLOBALS = new Set(['undefined', 'NaN', 'Infinity', 'arguments', 'globalThis']);

export const UBIQUITY_THRESHOLD = 0.4;

const NO_ANCHORS = new Set();

export const anchorKind = (anchor) => anchor.slice(0, anchor.indexOf(':'));

const weightOf = (anchor) => ANCHOR_WEIGHTS[anchorKind(anchor)] ?? 0;

/** Sum of weights over distinct anchors, ubiquitous ones counting 0. */
export const anchorWeight = (anchors, ubiquitous = NO_ANCHORS) => {
  const distinct = [...new Set(anchors)].filter((anchor) => !ubiquitous.has(anchor));
  return distinct.reduce((total, anchor) => total + weightOf(anchor), 0);
};

/** Number of distinct anchors that are not ubiquitous (the expr-unit gate needs at least 2). */
export const countNonUbiquitous = (anchors, ubiquitous = NO_ANCHORS) =>
  new Set(anchors.filter((anchor) => !ubiquitous.has(anchor))).size;

export const evidence = (mass, weight) => mass + 3 * weight;

/**
 * Ubiquitous anchors of one facet. fileAnchorSets: an iterable of per-file anchor collections.
 * Returns the Set of anchors present in more than threshold of those files.
 */
export const ubiquitousAnchors = (fileAnchorSets, threshold = UBIQUITY_THRESHOLD) => {
  const counts = new Map();
  let fileCount = 0;
  for (const anchors of fileAnchorSets) {
    fileCount += 1;
    for (const anchor of new Set(anchors)) counts.set(anchor, (counts.get(anchor) ?? 0) + 1);
  }
  const limit = fileCount * threshold;
  return new Set([...counts].filter(([, count]) => count > limit).map(([anchor]) => anchor));
};
