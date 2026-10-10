// Forge gates and instance rules (engine doc section 4). A gate is an evidence floor for one grouping
// level; the instance rules say how many instances, in how many files, a group needs:
//   G1  L1 groups (N1-fp1, and N3, whose shared name is extra evidence)  E >= 18, mass >= 8
//   G2  L2 fn/stmt/window groups (N1-fp2, N2)                           E >= 30, anchorWeight >= 2
//   G3  L3 groups (N1-fp3); LGG is mandatory for them                    mass >= 40, E >= 50
//   G4  templates (T and template W)                                     mass >= 10
//   cross-file  at least 2 files; a 2-instance group needs G2, or G1 with anchorWeight >= 3
//   within-file at least 3 instances, only through W (siblings.js applies the W floor)
//   templates   at least 3 instances
//   fn-clone pair  a 2-instance exact whole-function group (N1-fp1, kind fn) also passes with G1, mass >= 20
//               and anchorWeight >= 1: the pair rule alone dropped small alpha-equivalent twins (#4443)
//   idiom       an expr group with more than 25 instances across more than 10 directories and E < 35
// mass, anchorWeight and E are group metrics (group-shape.js metricsOf): the smallest instance mass and
// the weight of the anchors every instance shares, ubiquitous anchors weighing 0. Ubiquity is per facet:
// an anchor in more than 40% of the facet's files.
import path from 'node:path';
import { evaluateRules } from '../rules.js';
import { ubiquitousAnchors } from './anchors.js';

export const GATES = Object.freeze({
  G1: Object.freeze({ minEvidence: 18, minMass: 8 }),
  G2: Object.freeze({ minEvidence: 30, minAnchorWeight: 2 }),
  G3: Object.freeze({ minMass: 40, minEvidence: 50 }),
  G4: Object.freeze({ minMass: 10 })
});

export const INSTANCE_RULES = Object.freeze({ minFiles: 2, pairAnchorWeight: 3, minTemplateInstances: 3 });

export const IDIOM = Object.freeze({ moreThanInstances: 25, moreThanDirs: 10, belowEvidence: 35 });

/** The gate each grouping path must pass (W has its own floor in siblings.js). */
export const GATE_OF_PATH = Object.freeze({ 'N1-fp1': 'G1', 'N1-fp2': 'G2', 'N1-fp3': 'G3', N2: 'G2', N3: 'G1', T: 'G4', W: null });

/** The extra way a 2-instance exact whole-function clone is a strong pair (both fns, same fp1, G1 met). */
export const FN_CLONE_PAIR = Object.freeze({ minMass: 20, minAnchorWeight: 1 });

const GATE_RULES = {
  G1: (m) => ({ lowEvidence: m.evidence < GATES.G1.minEvidence, lowMass: m.mass < GATES.G1.minMass }),
  G2: (m) => ({ lowEvidence: m.evidence < GATES.G2.minEvidence, lowAnchorWeight: m.anchorWeight < GATES.G2.minAnchorWeight }),
  G3: (m) => ({ lowMass: m.mass < GATES.G3.minMass, lowEvidence: m.evidence < GATES.G3.minEvidence }),
  G4: (m) => ({ lowMass: m.mass < GATES.G4.minMass })
};

const PASS = Object.freeze({ ok: true, first: null, violations: [] });

/** Evaluates one gate on { mass, anchorWeight, evidence }: { ok, first, violations }. */
export const checkGate = (gate, metrics) => (gate ? evaluateRules(GATE_RULES[gate](metrics)) : PASS);

const isStrongPair = (group) => {
  const passesG2 = checkGate('G2', group).ok;
  const isAnchoredG1 = checkGate('G1', group).ok && group.anchorWeight >= INSTANCE_RULES.pairAnchorWeight;
  const isFnClone = group.path === 'N1-fp1' && group.kind === 'fn' && checkGate('G1', group).ok;
  const isSubstantialClone = isFnClone && group.mass >= FN_CLONE_PAIR.minMass && group.anchorWeight >= FN_CLONE_PAIR.minAnchorWeight;
  return passesG2 || isAnchoredG1 || isSubstantialClone;
};

const INSTANCE_CHECKS = {
  crossFile: (group) => ({
    singleFile: group.fileCount < INSTANCE_RULES.minFiles,
    weakPair: () => group.memberCount === 2 && !isStrongPair(group)
  }),
  template: (group) => ({
    singleFile: group.fileCount < INSTANCE_RULES.minFiles,
    tooFewInstances: group.memberCount < INSTANCE_RULES.minTemplateInstances
  })
};

const INSTANCE_RULE_OF_PATH = { 'N1-fp1': 'crossFile', 'N1-fp2': 'crossFile', 'N1-fp3': 'crossFile', N2: 'crossFile', N3: 'crossFile', T: 'template' };

/**
 * Gate plus instance rules for a cross-file group. Returns { ok, reason }: reason names the first failed
 * rule (e.g. 'G2.lowEvidence', 'instances.weakPair'), null when the group is admitted.
 */
export const admitGroup = (group) => {
  const gate = GATE_OF_PATH[group.path];
  const gateResult = checkGate(gate, group);
  const isGateFailed = !gateResult.ok;
  if (isGateFailed) return { ok: false, reason: `${gate}.${gateResult.first}` };
  const ruleName = INSTANCE_RULE_OF_PATH[group.path];
  const ruleResult = ruleName ? evaluateRules(INSTANCE_CHECKS[ruleName](group), { failFast: true }) : PASS;
  return ruleResult.ok ? { ok: true, reason: null } : { ok: false, reason: `instances.${ruleResult.first}` };
};

const dirCountOf = (group) => new Set(group.instances.map((instance) => path.posix.dirname(instance.file))).size;

/** An expr group so common and so light that it is an idiom, shown only with --idioms. */
export const isIdiom = (group) => {
  const isExpr = group.kind === 'expr';
  const isCommon = group.memberCount > IDIOM.moreThanInstances;
  const isLight = group.evidence < IDIOM.belowEvidence;
  return isExpr && isCommon && isLight && dirCountOf(group) > IDIOM.moreThanDirs;
};

/** Applies the idiom label: status 'idiom' instead of 'candidate'. */
export const labelIdiom = (group) => (isIdiom(group) ? { ...group, status: 'idiom' } : group);

const parseAnchors = (anchors) => (Array.isArray(anchors) ? anchors : JSON.parse(anchors || '[]'));

/**
 * Per-facet ubiquity from ledger rows: ubiquitousOf(facetKey) is the Set of anchors present in more
 * than 40% of that facet's files (each file's anchors are the union over its stored units).
 */
export const createUbiquityIndex = (rows) => {
  const filesByFacet = new Map();
  for (const row of rows) {
    const files = filesByFacet.get(row.facet_key) ?? new Map();
    filesByFacet.set(row.facet_key, files);
    const anchors = files.get(row.file_path) ?? new Set();
    files.set(row.file_path, anchors);
    for (const anchor of parseAnchors(row.anchors)) anchors.add(anchor);
  }
  const byFacet = new Map([...filesByFacet].map(([facetKey, files]) => [facetKey, ubiquitousAnchors(files.values())]));
  const none = new Set();
  return (facetKey) => byFacet.get(facetKey) ?? none;
};
