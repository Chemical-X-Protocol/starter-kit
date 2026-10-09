// Reject codes over a group's LGG (engine doc section 6). Every code is evaluated and stored; the first
// one is the group's reject reason:
//   R1  more than 4 differing holes (W allows up to 8 leaf holes: literal, key, ref or transform columns;
//       N3, a same-name near miss, allows one variant hole)
//   R2  hole nodes over member mass above 0.30 (0.35 for templates)
//   R3  a hole reads a binder the unit introduces (catch param, loop var, local const)
//   R4  a hole contains return, break, continue, yield or throw of the unit's own function
//   R5  a non-transform hole swallows anchors (import, global, member call, regex) in half the members
//   R6  the members' facets are not homogeneous
//   R7  the LGG matches a library convention entry (conventions.js)
//   R8  more than 3 capture params after bundling: written captures stay one param each, read-only
//       captures are one options object when there are more than 2
import { evaluateRules } from '../rules.js';

export const REJECT_LIMITS = Object.freeze({
  maxHoles: 4,
  maxTableHoles: 8,
  maxNamedHoles: 1,
  maxHoleRatio: 0.3,
  maxTemplateHoleRatio: 0.35,
  bundleAbove: 2,
  maxCaptureParams: 3
});

export const REJECT_CODES = Object.freeze(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);

const TABLE_KINDS = new Set(['literal', 'key', 'ref', 'transform']);

/** Params the captures cost after bundling. */
export const captureParamsOf = (captures) => {
  const written = captures.filter((capture) => capture.isWritten).length;
  const readOnly = captures.length - written;
  return written + (readOnly > REJECT_LIMITS.bundleAbove ? 1 : readOnly);
};

const isTableShaped = (lgg, group) => {
  const isSiblingGroup = group.path === 'W';
  const isAllLeaf = lgg.holes.every((hole) => TABLE_KINDS.has(hole.kind));
  return isSiblingGroup && isAllLeaf && lgg.holes.length <= REJECT_LIMITS.maxTableHoles;
};

const holeLimitOf = (group) => (group.path === 'N3' ? REJECT_LIMITS.maxNamedHoles : REJECT_LIMITS.maxHoles);

const ratioLimitOf = (group) => (group.kind === 'tmpl' ? REJECT_LIMITS.maxTemplateHoleRatio : REJECT_LIMITS.maxHoleRatio);

const swallowsAnchors = (lgg) => lgg.holes.some((hole) => hole.kind !== 'transform' && hole.anchoredMembers * 2 >= lgg.memberCount);

const REJECT_RULES = (lgg, group, context) => ({
  R1: () => lgg.holes.length > holeLimitOf(group) && !isTableShaped(lgg, group),
  R2: () => lgg.holeRatio > ratioLimitOf(group),
  R3: () => lgg.holes.some((hole) => hole.hasLocal),
  R4: () => lgg.holes.some((hole) => hole.hasExit),
  R5: () => swallowsAnchors(lgg),
  R6: () => !context.isHomogeneous,
  R7: () => Boolean(context.convention),
  R8: () => captureParamsOf(lgg.captures) > REJECT_LIMITS.maxCaptureParams
});

/** An LGG with nothing to judge but the facet and the convention (template groups have no script LGG). */
export const emptyLgg = (memberCount) => ({ memberCount, rootType: null, mass: [], holeNodes: [], holeRatio: 0, holes: [], captures: [] });

/**
 * Judges one LGG. context: { isHomogeneous, convention } (convention: a matching convention id or null).
 * Returns { ok, reason, codes }: reason is the first failing code, codes every failing one, in order.
 */
export const judgeLgg = (lgg, group, context = {}) => {
  const result = evaluateRules(REJECT_RULES(lgg, group, { isHomogeneous: context.isHomogeneous ?? true, convention: context.convention ?? null }));
  return { ok: result.ok, reason: result.first, codes: result.violations };
};
