// T: cross-file template groups (engine doc sections 5 and 7). tmpl units are bucketed by (facet, fp3)
// across at least 2 files, then refined by structural role: ROLE tokens of `variant`, `as`, `type` and
// slot names below the root are never holes, so members whose role keys differ have different structure.
// A bucket is partitioned by its members' role keys (template-roles.js); this is the partition the
// earliest-preorder-first recursive split reaches, because no structural role can become a hole.
// Partitions that pass G4 and the rule of 3 (in at least 2 files) survive. A bucket that refinement split
// reports its failing partitions with a `refine.` reason, so B2 (three different child-role orders) is
// rejected by refinement rather than silently dropped.
// context: as group.js, plus roleKeyOf(row) (createRoleReader).
import { admitted } from './group.js';
import { byCodePoint, instanceOfRow, pushTo, spansFiles } from './group-shape.js';
import { INSTANCE_RULES } from './gates.js';

const T_SPEC = Object.freeze({ path: 'T', level: 3, kind: 'tmpl', needsLgg: true });
const MIN_TEMPLATE_INSTANCES = INSTANCE_RULES.minTemplateInstances;

/** Partitions of one bucket by structural role key, in code-point order of the keys. */
export const partitionByRoles = (rows, roleKeyOf) => {
  const partitions = new Map();
  for (const row of rows) pushTo(partitions, roleKeyOf(row), row);
  return [...partitions.keys()].sort(byCodePoint).map((key) => ({ roleKey: key, rows: partitions.get(key) }));
};

// Refinement re-parses member files, so a bucket too small for the rule of 3 is gated as it is.
const bucketGroups = (rows, context) => {
  const isTooSmall = rows.length < MIN_TEMPLATE_INSTANCES;
  if (isTooSmall) return [admitted({ ...T_SPEC, facetKey: rows[0].facet_key }, rows, context, { toInstance: instanceOfRow })].filter(Boolean);
  const partitions = partitionByRoles(rows, context.roleKeyOf);
  const reasonPrefix = partitions.length > 1 ? 'refine.' : '';
  const spec = { ...T_SPEC, facetKey: rows[0].facet_key };
  return partitions.map((partition) => admitted(spec, partition.rows, context, { reasonPrefix, toInstance: instanceOfRow })).filter(Boolean);
};

/** T: cross-file tmpl buckets at fp3, refined by structural role. */
export const groupTemplates = (rows, context) => {
  const buckets = new Map();
  for (const row of rows) {
    const isTemplate = row.kind === 'tmpl';
    if (isTemplate) pushTo(buckets, `${row.facet_key}|${row.fp3}`, row);
  }
  return [...buckets.values()].filter(spansFiles).flatMap((rows) => bucketGroups(rows, context));
};
