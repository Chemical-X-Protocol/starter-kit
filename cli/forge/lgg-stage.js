// The LGG stage of a Forge run (engine doc sections 6-8), after grouping: every admitted group gets its
// n-ary LGG over its members' unit trees, is judged by R1-R8 (rejects.js), refined by member eviction
// when the code belongs to some members (refine.js), gated again on what is kept, searched for drift
// (drift.js) and handed to ranking (rank.js). The stage also builds W's unify step (unify-step.js).
//   N1 fp1 groups are L1-equal, so their LGG can only hold capture-name refs: they are judged on facet
//   and convention without parsing. Template groups have no script tree: they are judged on facet and
//   convention too (structural refinement already ran in templates.js and siblings.js).
// A member whose file changed since the ledger was written has no tree; it is evicted as `stale`.
// options.cache: { verdicts, unify, shapes } from group-store.js; a verdict hit skips the trees and the
// LGG, since a group id is content-derived (content_hash:start:end of every member). Drift is always
// searched again (it reads other files), over cached row shapes.
import { createTreeReader } from './unit-trees.js';
import { emptyLgg, judgeLgg } from './rejects.js';
import { conventionOf } from './conventions.js';
import { refineMembers } from './refine.js';
import { admitGroup, labelIdiom } from './gates.js';
import { makeGroup, memberKeyOf } from './group-shape.js';
import { passesWFloor } from './siblings.js';
import { createDriftIndex, findDrift } from './drift.js';
import { createShapeReader } from './root-shapes.js';
import { createUnifyStep } from './unify-step.js';
import { suppressionKeyOf } from './group-store.js';

const UNPARSED_PATHS = new Set(['N1-fp1']);

const EMPTY_CACHE = Object.freeze({ verdicts: new Map(), unify: new Map(), shapes: new Map() });

const specOf = (group) => ({ path: group.path, kind: group.kind, facetKey: group.facetKey, level: group.level, needsLgg: group.needsLgg });

const spanOf = (instance) => ({ file: instance.file, startLine: instance.startLine, endLine: instance.endLine, unitIds: instance.unitIds });

// W keeps its floor; every cross-file path its gate and instance rules.
const readmit = (group) => (group.path === 'W' ? { ok: passesWFloor(group.instances), reason: 'W.floor' } : admitGroup(group));

/**
 * Stage over one ledger. context: { rows, readFile, ubiquitousOf, contentHashes, cache }. Returns
 * { unify(instanceA, instanceB), unifyDecisions, shapeDecisions, judgeGroups(groups) => { accepted, rejected } }.
 */
export const createLggStage = ({ rows, readFile, ubiquitousOf, contentHashes, cache = EMPTY_CACHE }) => {
  const reader = createTreeReader(readFile, rows);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const shapes = createShapeReader(reader, rowsById, { contentHashes, cache: cache.shapes ?? new Map() });
  const driftIndex = createDriftIndex(rows);
  const groupContext = { contentHashes, ubiquitousOf };
  const unifyStep = createUnifyStep({ reader, rowsById, ubiquitousOf, contentHashes, cache: cache.unify ?? new Map() });

  const facetsOf = (instances) => new Set(instances.flatMap((instance) => instance.unitIds.map((id) => rowsById.get(id)?.facet_key)));
  const tagsOf = (instances) => instances.map((instance) => JSON.parse(rowsById.get(instance.unitIds[0])?.meta ?? 'null')?.tag ?? null);

  const contextFor = (group, members) => {
    const instances = members.map((member) => member.instance);
    const trees = members.map((member) => member.tree).filter(Boolean);
    const convention = conventionOf({ kind: group.kind, files: instances.map((instance) => instance.file), trees, tags: group.kind === 'tmpl' ? tagsOf(instances) : [] });
    return { isHomogeneous: facetsOf(instances).size === 1, convention };
  };

  const judgeOf = (group) => (lgg, members) => judgeLgg(lgg ?? emptyLgg(members.length), group, contextFor(group, members));

  const judgeUnparsed = (group) => {
    const members = group.instances.map((instance) => ({ instance, tree: null }));
    return { members, evicted: [], lgg: null, verdict: judgeOf(group)(null, members) };
  };

  const judgeParsed = (group) => {
    const resolved = group.instances.map((instance) => ({ instance, tree: reader.treeOf(instance) }));
    const stale = resolved.filter((member) => !member.tree).map((member) => ({ instance: member.instance, reason: 'stale' }));
    const classOf = (member) => member.instance.unitIds.map((id) => rowsById.get(id)?.fp2).join(',');
    const refined = refineMembers(resolved.filter((member) => member.tree), judgeOf(group), { ubiquitous: ubiquitousOf(group.facetKey), classOf });
    return { ...refined, evicted: [...stale, ...refined.evicted] };
  };

  const fromCache = (group, cached) => {
    const evictedKeys = new Map(cached.evicted.map((entry) => [entry.key, entry.reason]));
    const keyOf = (instance) => memberKeyOf(instance, contentHashes);
    const members = group.instances.filter((instance) => !evictedKeys.has(keyOf(instance))).map((instance) => ({ instance, tree: null }));
    const evicted = group.instances.filter((instance) => evictedKeys.has(keyOf(instance))).map((instance) => ({ instance, reason: evictedKeys.get(keyOf(instance)) }));
    return { members, evicted, lgg: cached.lgg, verdict: cached.verdict };
  };

  const verdictOf = (group) => {
    const cached = cache.verdicts?.get(group.id);
    if (cached) return fromCache(group, cached);
    const isUnparsed = UNPARSED_PATHS.has(group.path) || group.kind === 'tmpl';
    return isUnparsed ? judgeUnparsed(group) : judgeParsed(group);
  };

  // The judged group: rebuilt on its kept members when any were evicted, then gated again. Fewer than 2
  // kept members leave the group as it was, rejected.
  const settle = (group, outcome) => {
    const isRefined = outcome.evicted.length > 0;
    const canRebuild = outcome.members.length >= 2;
    const rebuilt = isRefined && canRebuild ? labelIdiom(makeGroup(specOf(group), outcome.members.map((member) => member.instance), groupContext)) : group;
    const admission = isRefined && canRebuild ? readmit(rebuilt) : { ok: !isRefined, reason: 'instances.tooFew' };
    const isAccepted = outcome.verdict.ok && admission.ok;
    const rejectReason = outcome.verdict.ok ? `refine.${admission.reason}` : outcome.verdict.reason;
    return {
      ...rebuilt,
      status: isAccepted ? rebuilt.status : 'rejected',
      ...(isAccepted ? {} : { rejectReason }),
      rejectCodes: outcome.verdict.codes,
      verdict: outcome.verdict,
      lgg: outcome.lgg,
      sourceId: group.id,
      suppressionKey: suppressionKeyOf(rebuilt, rowsById),
      evicted: outcome.evicted.map((entry) => ({ ...spanOf(entry.instance), key: memberKeyOf(entry.instance, contentHashes), reason: entry.reason })),
      drift: []
    };
  };

  const withDrift = (group) => {
    const driftContext = { index: driftIndex, ubiquitous: ubiquitousOf(group.facetKey), groupShapes: () => shapes.groupShapes(group), shapeOf: shapes.spanShape };
    const drift = findDrift(group, driftContext).map((spanRows) => ({ file: spanRows[0].file_path, startLine: spanRows[0].start_line, endLine: spanRows.at(-1).end_line, unitIds: spanRows.map((row) => row.id) }));
    return { ...group, drift };
  };

  const judgeGroups = (groups) => {
    const settled = groups.map((group) => settle(group, verdictOf(group)));
    const accepted = settled.filter((group) => group.status !== 'rejected').map(withDrift);
    const rejected = settled.filter((group) => group.status === 'rejected');
    return { accepted, rejected };
  };

  return { unify: unifyStep.unify, unifyDecisions: unifyStep.decisions, shapeDecisions: shapes.decisions, judgeGroups };
};
