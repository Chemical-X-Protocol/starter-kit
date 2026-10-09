// Member refinement of a script group whose LGG is rejected (engine doc sections 6-7). Some rejections
// belong to a few members, not to the shape: a JSON reader whose catch hands its error back (B8,
// workspace.js and ratchet.js) puts a catch binder in a hole (R3) that the plain readers (A7) never
// have. Those members are evicted with the code as their reason and the LGG is computed again over the
// rest, for at most REFINE_ROUNDS rounds:
//   R3, R4, R5  the members whose side of a failing hole carries the local, the exit or the anchor
//   R1, R2      the member with the largest share of hole nodes in its own mass
// Every other code (R6 facet, R7 convention, R8 captures) is about the whole group and is final.
// The caller decides whether the kept members still form a group (gates and instance rules).
import { antiUnify } from './lgg.js';

export const REFINE_ROUNDS = 3;

const SIDE_FACT_OF_CODE = { R3: 'localSides', R4: 'exitSides', R5: 'anchoredSides' };
const SHAPE_CODES = new Set(['R1', 'R2']);

const holeOffenders = (lgg, code) => {
  const fact = SIDE_FACT_OF_CODE[code];
  const isSwallowRule = code === 'R5';
  const failing = lgg.holes.filter((hole) => hole[fact].length > 0 && !(isSwallowRule && hole.kind === 'transform'));
  return new Set(failing.flatMap((hole) => hole[fact]));
};

const heaviestHoleShare = (lgg) => {
  const shares = lgg.holeNodes.map((count, index) => count / Math.max(1, lgg.mass[index]));
  return new Set([shares.indexOf(Math.max(...shares))]);
};

/** Member indexes (into the LGG's members) to evict for a verdict, empty when the code is final. */
export const offendersOf = (lgg, verdict) => {
  const code = verdict.reason;
  const isSideCode = code in SIDE_FACT_OF_CODE;
  if (isSideCode) return holeOffenders(lgg, code);
  return SHAPE_CODES.has(code) ? heaviestHoleShare(lgg) : new Set();
};

/**
 * Refines members ({ instance, tree } in group order). judge(lgg, members) => { ok, reason, codes }.
 * options.ubiquitous feeds the LGG. Returns { members, evicted: [{ instance, reason }], lgg, verdict }:
 * members are the ones kept; verdict is the last judgement (ok when refinement reached an accepted LGG).
 */
export const refineMembers = (members, judge, { ubiquitous = new Set() } = {}) => {
  let kept = members;
  const evicted = [];
  let lgg = antiUnify(kept.map((member) => member.tree), { ubiquitous });
  let verdict = judge(lgg, kept);
  for (let round = 0; round < REFINE_ROUNDS; round += 1) {
    const isDone = verdict.ok || lgg === null;
    if (isDone) break;
    const offenders = offendersOf(lgg, verdict);
    const remaining = kept.filter((_, index) => !offenders.has(index));
    const canEvict = offenders.size > 0 && remaining.length >= 2;
    if (!canEvict) break;
    kept.filter((_, index) => offenders.has(index)).forEach((member) => evicted.push({ instance: member.instance, reason: verdict.reason }));
    kept = remaining;
    lgg = antiUnify(kept.map((member) => member.tree), { ubiquitous });
    verdict = judge(lgg, kept);
  }
  return { members: kept, evicted, lgg, verdict };
};
