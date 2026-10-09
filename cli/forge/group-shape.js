// Shared shape of Forge groups (engine doc sections 4-5; design doc, Data model: pattern_groups).
// An instance is one occurrence of a repeated piece: a unit row, or a window of consecutive (or, for W,
// sibling) statement rows of one block. A group is a set of instances that one grouping path matched:
//   { id, path, kind, facetKey, level, status, needsLgg, memberCount, fileCount, mass, anchorWeight,
//     evidence, instances }
// path is N1-fp1, N1-fp2, N1-fp3, N2, N3, W or T. The id is the sha1 of the sorted member keys
// (content_hash:start:end), so it is content-derived and never depends on time or input order.
import crypto from 'node:crypto';
import { anchorWeight, evidence } from './anchors.js';

/** Code-point comparison (never localeCompare). */
export const byCodePoint = (a, b) => Number(a > b) - Number(a < b);

/** Appends value to the list under key. */
export const pushTo = (map, key, value) => {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
};

/** True when ledger rows come from at least 2 files (every cross-file path needs it). */
export const spansFiles = (rows) => rows.some((row) => row.file_path !== rows[0].file_path);

// A member is a ledger row (file_path) or an instance (file).
const fileOf = (member) => member.file ?? member.file_path;

/** Instance order everywhere: file path, then start line, then start offset. */
export const byLocation = (a, b) => byCodePoint(a.file, b.file) || a.startLine - b.startLine || (a.start ?? 0) - (b.start ?? 0);

const spanKeyOf = (instance) => {
  const hasOffsets = instance.start !== null && instance.start !== undefined;
  return hasOffsets ? `${instance.start}:${instance.end}` : `L${instance.startLine}:L${instance.endLine}:${instance.nodeId ?? ''}`;
};

/** pattern_group_members key of one instance: content_hash:start:end. */
export const memberKeyOf = (instance, contentHashes) => `${contentHashes.get(instance.file) ?? instance.file}:${spanKeyOf(instance)}`;

export const groupIdOf = (instances, contentHashes) => {
  const keys = instances.map((instance) => memberKeyOf(instance, contentHashes)).sort(byCodePoint);
  return crypto.createHash('sha1').update(keys.join('\n')).digest('hex').slice(0, 16);
};

const parseAnchors = (anchors) => (Array.isArray(anchors) ? anchors : JSON.parse(anchors || '[]'));

/** One instance from one ledger row (snake_case columns, as pattern_units stores them). */
export const instanceOfRow = (row) => ({
  file: row.file_path,
  unitIds: [row.id],
  kind: row.kind,
  start: row.start,
  end: row.end,
  startLine: row.start_line,
  endLine: row.end_line,
  nodeId: row.nodeId ?? null,
  mass: row.mass,
  anchors: parseAnchors(row.anchors)
});

/** One instance spanning consecutive or sibling rows of one block (rows in source order). */
export const instanceOfRows = (rows) => {
  const first = rows[0];
  const last = rows.at(-1);
  return {
    file: first.file_path,
    unitIds: rows.map((row) => row.id),
    kind: 'window',
    blockId: first.block_id,
    start: first.start,
    end: last.end,
    startLine: first.start_line,
    endLine: last.end_line,
    nodeId: null,
    mass: rows.reduce((total, row) => total + row.mass, 0),
    anchors: [...new Set(rows.flatMap((row) => parseAnchors(row.anchors)))]
  };
};

/** Anchors every member (row or instance) carries: the evidence the whole group shares. */
export const sharedAnchors = (instances) => {
  const [first, ...rest] = instances;
  const restSets = rest.map((instance) => new Set(instance.anchors));
  return [...new Set(first?.anchors ?? [])].filter((anchor) => restSets.every((set) => set.has(anchor))).sort(byCodePoint);
};

/** mass (smallest member), anchorWeight of the shared anchors (facet-ubiquitous ones weigh 0) and E. */
export const metricsOf = (instances, ubiquitous) => {
  const mass = Math.min(...instances.map((instance) => instance.mass));
  const weight = anchorWeight(sharedAnchors(instances), ubiquitous);
  return { mass, anchorWeight: weight, evidence: evidence(mass, weight) };
};

export const fileCountOf = (members) => new Set(members.map(fileOf)).size;

/**
 * The gate-relevant part of a group, before its instances are built: spec ({ path, kind, facetKey,
 * level, needsLgg }) plus member and file counts and metrics. members are rows or instances;
 * context.ubiquitousOf(facetKey) gives the facet's ubiquitous anchors.
 */
export const draftGroup = (spec, members, context) => ({
  path: spec.path,
  kind: spec.kind,
  facetKey: spec.facetKey,
  level: spec.level ?? null,
  status: 'candidate',
  needsLgg: Boolean(spec.needsLgg),
  memberCount: members.length,
  fileCount: fileCountOf(members),
  ...metricsOf(members, context.ubiquitousOf(spec.facetKey))
});

/** Completes a draft with its instances (sorted by location) and its content-derived id. */
export const finishGroup = (draft, instances, context) => {
  const sorted = [...instances].sort(byLocation);
  return { id: groupIdOf(sorted, context.contentHashes), ...draft, instances: sorted };
};

/** draftGroup then finishGroup: a whole group from its instances. */
export const makeGroup = (spec, instances, context) => finishGroup(draftGroup(spec, instances, context), instances, context);

/**
 * Groups in the shape the ground-truth scorer reads (cli/patterns/gt-score.js: id, path, occurrences),
 * plus their metrics and reject reason for reports.
 */
export const toScorerGroups = (groups) => groups.map((group) => ({
  id: group.id,
  path: group.path,
  kind: group.kind,
  status: group.status,
  ...(group.rejectReason ? { rejectReason: group.rejectReason } : {}),
  needsLgg: group.needsLgg,
  memberCount: group.memberCount,
  fileCount: group.fileCount,
  mass: group.mass,
  anchorWeight: group.anchorWeight,
  evidence: group.evidence,
  occurrences: group.instances.map((instance) => ({ file: instance.file, startLine: instance.startLine, endLine: instance.endLine }))
}));
