// Member refinement of a script group whose LGG is rejected (engine doc sections 6-7). Some rejections
// belong to a few members, not to the shape: a JSON reader whose catch hands its error back (B8,
// workspace.js and ratchet.js) puts a catch binder in a hole (R3) that the plain readers (A7) never
// have. Those members are evicted with a code as their reason and the LGG is computed again over the
// rest, for at most REFINE_ROUNDS rounds:
//   R3, R4, R5  the members whose side of a failing hole carries the local, the exit or the anchor
//   R1, R2      the shape is too far apart as a whole: every member outside the reference class (the
//               largest class by classOf, the fp2 of its units; ties go to source order) is judged
//               against one reference member, and evicted when that pair fails. Its reason is the
//               pair's behavioural code when it has one (R4 exit, R3 binder, R5 anchor), else the first
//               code: a reader whose catch returns its error differs in contract, not just in size.
// Every other code (R6 facet, R7 convention, R8 captures) is about the whole group and is final.
// The caller decides whether the kept members still form a group (gates and instance rules).
import { antiUnify } from './lgg.js';

export const REFINE_ROUNDS = 3;

const SIDE_FACT_OF_CODE = { R3: 'localSides', R4: 'exitSides', R5: 'anchoredSides' };
const BEHAVIOUR_CODES = ['R4', 'R3', 'R5'];

const holeOffenders = (lgg, code) => {
  const fact = SIDE_FACT_OF_CODE[code];
  const isSwallowRule = code === 'R5';
  const failing = lgg.holes.filter((hole) => hole[fact].length > 0 && !(isSwallowRule && hole.kind === 'transform'));
  return new Map(failing.flatMap((hole) => hole[fact]).map((index) => [index, code]));
};

const ONE_CLASS = () => 'one';

// Index of the reference member: first member of the largest class.
const referenceOf = (members, classOf) => {
  const sizes = new Map();
  for (const member of members) sizes.set(classOf(member), (sizes.get(classOf(member)) ?? 0) + 1);
  const largest = Math.max(...sizes.values());
  return members.findIndex((member) => sizes.get(classOf(member)) === largest);
};

const reasonOf = (verdict) => BEHAVIOUR_CODES.find((code) => verdict.codes.includes(code)) ?? verdict.reason;

// R1/R2: each member outside the reference class against the reference.
const pairOffenders = (members, judge, options) => {
  const classOf = options.classOf ?? ONE_CLASS;
  const reference = referenceOf(members, classOf);
  const referenceClass = classOf(members[reference]);
  const offenders = new Map();
  members.forEach((member, index) => {
    const isOutside = index !== reference && classOf(member) !== referenceClass;
    if (!isOutside) return;
    const pair = [members[reference], member];
    const verdict = judge(antiUnify(pair.map((entry) => entry.tree), { ubiquitous: options.ubiquitous, examples: false }), pair);
    const isRefused = !verdict.ok;
    if (isRefused) offenders.set(index, reasonOf(verdict));
  });
  return offenders;
};

/** Map(member index -> reason code) of the members to evict for a verdict; empty when the code is final. */
export const offendersOf = (lgg, verdict, members, judge, options = {}) => {
  const code = verdict.reason;
  const isSideCode = code in SIDE_FACT_OF_CODE;
  if (isSideCode) return holeOffenders(lgg, code);
  const isShapeCode = code === 'R1' || code === 'R2';
  return isShapeCode ? pairOffenders(members, judge, options) : new Map();
};

/**
 * Refines members ({ instance, tree } in group order). judge(lgg, members) => { ok, reason, codes }.
 * options: { ubiquitous (for the LGG), classOf(member) (members of one class are never judged against
 * each other) }. Returns { members, evicted: [{ instance, reason }], lgg, verdict }: members are the ones
 * kept; verdict is the last judgement (ok when refinement reached an accepted LGG).
 */
export const refineMembers = (members, judge, options = {}) => {
  let kept = members;
  const evicted = [];
  let lgg = antiUnify(kept.map((member) => member.tree), { ubiquitous: options.ubiquitous });
  let verdict = judge(lgg, kept);
  for (let round = 0; round < REFINE_ROUNDS; round += 1) {
    const isDone = verdict.ok || lgg === null;
    if (isDone) break;
    const offenders = offendersOf(lgg, verdict, kept, judge, options);
    const remaining = kept.filter((_, index) => !offenders.has(index));
    const canEvict = offenders.size > 0 && remaining.length >= 2;
    if (!canEvict) break;
    kept.forEach((member, index) => {
      const reason = offenders.get(index);
      if (reason) evicted.push({ instance: member.instance, reason });
    });
    kept = remaining;
    lgg = antiUnify(kept.map((member) => member.tree), { ubiquitous: options.ubiquitous });
    verdict = judge(lgg, kept);
  }
  return { members: kept, evicted, lgg, verdict };
};
